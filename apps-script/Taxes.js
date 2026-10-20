// Taxes by accrual: what each month's income owes, against what was paid, and what is owed now.
// The ledger records a tax when it is paid (say, a deposit tax once a year, a business tax every quarter);
// the Taxes sheet spreads it over the months it belongs to, by the rules in Settings:
//   - interest: interest on accounts in one country (tax_interest_country, as the accounts' `country` is typed),
//     pooled per calendar year, over the year's tax-free allowance (tax_interest_allowance_<year>, in
//     tax_interest_currency) at tax_interest_rate — for a country that taxes deposit interest once a year;
//   - business: tax_business_rate of the income on business accounts, plus tax_business_fixed (in
//     tax_business_fixed_currency) a month, from tax_business_since;
//   - withheld at source (an income's '<id>-tax', Account.auto_tax in the app): accrued and paid at once.
// A rule is on once its settings are filled in. A payment in a Taxes category settles the rule of the account it is
// paid from: a business account → business, an account in the interest country → interest; any other is listed as
// paid without a rule. Before tax_accrual_start a month's taxes are what was paid. A Monthly sheet of your own can
// read "Accrued" (row 2) and "Paid" (row 3) from here by position.

const TAX_SHEET_ = 'Taxes';
const TAX_ROWS_ = { months: 1, accrued: 2, paid: 3 }; // fixed rows: Monthly reads them by position

function isSharedScope_(scope) {
  const s = String(scope || '').toLowerCase();
  return s.indexOf('liquid') >= 0 && s.indexOf('business') >= 0 && s.indexOf('investment') >= 0;
}

function monthsBetween_(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const end = to.slice(0, 7);
  for (let k = 0; k < 600; k++) {
    const key = y + '-' + (m < 10 ? '0' : '') + m;
    if (key > end) break;
    out.push(key);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * p: { accounts, txs, categories, settings, today: 'YYYY-MM-DD', usdPer(cur, date) → USD per unit }.
 * Returns months, total accrued / paid per month (USD), the rules with their owed now, and the owed total.
 */
function computeTaxes_(p) {
  const s = p.settings || {};
  const num = (k, d) => (s[k] === '' || s[k] === undefined || !isFinite(Number(s[k])) ? d : Number(s[k]));
  const start = String(s.tax_accrual_start || p.today.slice(0, 4) + '-01-01').slice(0, 10);
  const startMonth = start.slice(0, 7);
  const months = monthsBetween_(String(s.history_start || start).slice(0, 10), p.today);
  const intCountry = String(s.tax_interest_country || '').trim().toUpperCase();
  const intRate = num('tax_interest_rate', 0);
  const intCur = String(s.tax_interest_currency || 'USD').trim().toUpperCase();
  const bizRate = num('tax_business_rate', 0);
  const bizFixed = num('tax_business_fixed', 0);
  const bizCur = String(s.tax_business_fixed_currency || 'USD').trim().toUpperCase();
  const bizSince = String(s.tax_business_since || start).slice(0, 10);

  const accs = {};
  p.accounts.forEach(a => { accs[a.id] = a; });
  const cats = {};
  p.categories.forEach(c => { cats[c.id] = c; });
  const top = id => (cats[id] && cats[id].parent_id ? cats[id].parent_id : id);
  const isTax = id => cats[top(id)] && isSharedScope_(cats[top(id)].scope);
  const isInterest = id => top(id) === 'inc_interest';
  const inIntCountry = a => !!a && !!intCountry && String(a.country || '').trim().toUpperCase() === intCountry;
  const usdOf = t => Math.abs(Number(t.amount_usd) || 0);

  const zero = () => { const o = {}; months.forEach(m => { o[m] = 0; }); return o; };
  const paid = zero();
  const withheld = zero();
  const other = zero();
  // events / pays: what accrued and what was paid, in the rule's currency, for the breakdown by period.
  const rules = {
    interest: { id: 'interest', label: 'Interest · ' + intCountry, country: intCountry, currency: intCur, period: 'year', on: !!intCountry && intRate > 0, accrued: zero(), paid: zero(), native: 0, events: [], pays: [] },
    business: { id: 'business', label: 'Business · ' + (bizRate * 100) + '% of income + fixed', country: '', currency: bizCur, period: 'quarter', on: bizRate > 0 || bizFixed > 0, accrued: zero(), paid: zero(), native: 0, events: [], pays: [] },
  };
  const active = [rules.interest, rules.business].filter(r => r.on);
  const add = (map, m, v) => { if (map[m] !== undefined) map[m] += v; };
  const toNative = (cur, usd, date) => {
    if (cur === 'USD') return usd;
    const r = p.usdPer(cur, date);
    return r > 0 ? usd / r : 0;
  };

  const live = p.txs.filter(t => !t.deleted && t.date);
  const taxIds = {};
  live.forEach(t => { if (/-tax$/.test(t.id)) taxIds[t.id] = true; });

  // Payments: every Taxes expense counts as paid in its month; from the start on, a rule's own settle it.
  live.forEach(t => {
    if (t.type !== 'expense' || !isTax(t.category_id)) return;
    const m = t.date.slice(0, 7);
    const usd = usdOf(t);
    add(paid, m, usd);
    if (t.date < start) return;
    const a = accs[t.account_id];
    if (taxIds[t.id]) { add(withheld, m, usd); return; }
    const rule = a && a.group === 'business' ? rules.business : inIntCountry(a) ? rules.interest : null;
    if (!rule || !rule.on) { add(other, m, usd); return; }
    add(rule.paid, m, usd);
    const native = a && a.currency === rule.currency ? Math.abs(Number(t.amount) || 0) : toNative(rule.currency, usd, t.date);
    rule.native -= native;
    rule.pays.push({ date: t.date, native, usd });
  });

  // Interest: the year's interest over its allowance, income by income in date order.
  const cum = {};
  live
    .filter(t => rules.interest.on && t.type === 'income' && t.date >= start && isInterest(t.category_id) && inIntCountry(accs[t.account_id]) && !taxIds[t.id + '-tax'])
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))
    .forEach(t => {
      const a = accs[t.account_id];
      const usd = usdOf(t);
      const native = a.currency === intCur ? Math.abs(Number(t.amount) || 0) : toNative(intCur, usd, t.date);
      if (!native) return;
      const year = t.date.slice(0, 4);
      const allowance = num('tax_interest_allowance_' + year, 0);
      const before = cum[year] || 0;
      cum[year] = before + native;
      const taxable = Math.max(0, cum[year] - allowance) - Math.max(0, before - allowance);
      if (!taxable) return;
      const tax = taxable * intRate;
      add(rules.interest.accrued, t.date.slice(0, 7), (tax * usd) / native);
      rules.interest.native += tax;
      rules.interest.events.push({ date: t.date, native: tax, usd: (tax * usd) / native });
    });

  // Business: a share of each income on a business account, and the fixed sum every month.
  const from = bizSince > start ? bizSince : start;
  if (bizRate > 0) {
    live.forEach(t => {
      const a = accs[t.account_id];
      if (t.type !== 'income' || !a || a.group !== 'business' || t.date < from) return;
      const usd = usdOf(t) * bizRate;
      add(rules.business.accrued, t.date.slice(0, 7), usd);
      rules.business.native += toNative(bizCur, usd, t.date);
      rules.business.events.push({ date: t.date, native: toNative(bizCur, usd, t.date), usd });
    });
  }
  if (bizFixed > 0) {
    months.forEach(m => {
      if (m < from.slice(0, 7)) return;
      const day = m + '-15' < p.today ? m + '-15' : p.today;
      const r = bizCur === 'USD' ? 1 : p.usdPer(bizCur, day);
      add(rules.business.accrued, m, bizFixed * r);
      rules.business.native += bizFixed;
      rules.business.events.push({ date: day, native: bizFixed, usd: bizFixed * r });
    });
  }

  // Marks from the app (tax_marks): a period marked paid (paid already, in the balances: no transaction) or deleted
  // (not owed) is settled by the mark's amount; a deleted one also comes off the accrual of its months.
  const applied = [];
  active.forEach(r => {
    r.marked = {};
    r.markedUsd = 0;
    const per = {};
    r.events.forEach(e => {
      const x = (per[taxPeriodOf_(r.period, e.date)] = per[taxPeriodOf_(r.period, e.date)] || { accrued: 0, usd: 0 });
      x.accrued += e.native;
      x.usd += e.usd;
    });
    const deleted = {};
    (p.marks || []).forEach(mk => {
      if (mk.deleted || mk.rule !== r.id || !per[mk.period]) return;
      const x = per[mk.period];
      const amt = Math.min(Math.abs(Number(mk.amount) || 0), x.accrued - (r.marked[mk.period] || 0));
      if (!(amt > 0)) return;
      r.marked[mk.period] = (r.marked[mk.period] || 0) + amt;
      r.native -= amt;
      applied.push(mk.id);
      if (mk.action === 'deleted') deleted[mk.period] = (deleted[mk.period] || 0) + amt;
      else r.markedUsd += x.accrued > 0 ? (amt * x.usd) / x.accrued : 0;
    });
    Object.keys(deleted).forEach(k => {
      const f = per[k].accrued > 0 ? Math.max(0, per[k].accrued - deleted[k]) / per[k].accrued : 0;
      months.forEach(m => { if (taxPeriodOf_(r.period, m + '-01') === k) r.accrued[m] *= f; });
    });
  });

  const accrued = zero();
  months.forEach(m => {
    accrued[m] = m < startMonth ? paid[m] : active.reduce((x, r) => x + r.accrued[m], withheld[m]);
  });
  const list = active.map(r => {
    const sum = map => months.reduce((x, m) => x + map[m], 0);
    return {
      id: r.id, label: r.label, country: r.country, accrued: r.accrued, paid: r.paid, owedUsd: sum(r.accrued) - sum(r.paid) - r.markedUsd,
      owed: { amount: r.native, currency: r.currency }, periods: taxPeriods_(r.events, r.pays, r.period, r.marked),
    };
  });
  return { start, months, accrued, paid, withheld, other, rules: list, marks: applied, owedUsd: list.reduce((x, r) => x + r.owedUsd, 0) };
}

/** A year ('2026') or a quarter ('2026-Q3') of a day. */
function taxPeriodOf_(kind, d) {
  return kind === 'quarter' ? d.slice(0, 4) + '-Q' + Math.ceil(Number(d.slice(5, 7)) / 3) : d.slice(0, 4);
}

/**
 * What accrued per period (a year for interest, a quarter for the business) and what of it is still owed: payments
 * settle the oldest periods first. Amounts in the rule's currency; owedUsd at the period's own rates.
 */
function taxPeriods_(events, pays, kind, marked) {
  const by = {};
  events.forEach(e => {
    const k = taxPeriodOf_(kind, e.date);
    const p = (by[k] = by[k] || { key: k, accrued: 0, usd: 0 });
    p.accrued += e.native;
    p.usd += e.usd;
  });
  let left = pays.reduce((x, p) => x + p.native, 0);
  return Object.keys(by).sort().map(k => {
    const p = by[k];
    const mark = (marked && marked[k]) || 0;
    const open = Math.max(0, p.accrued - mark);
    const settled = Math.min(open, Math.max(0, left));
    left -= settled;
    const owed = open - settled;
    return {
      key: k, accrued: Math.round(p.accrued), marked: Math.round(mark), owed: Math.round(owed),
      owedUsd: p.accrued > 0 ? Math.round((owed * p.usd) / p.accrued * 100) / 100 : 0,
    };
  });
}

/** USD per unit on a day from RatesHistory (the last value on or before it), else today's rate. */
function usdPerLookup_() {
  const series = {};
  const sh = SpreadsheetApp.getActive().getSheetByName('RatesHistory');
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(r => {
      const d = formatDate_(r[0]);
      const v = Number(r[2]);
      if (d && r[1] && v > 0) (series[r[1]] = series[r[1]] || []).push([d, v]);
    });
  }
  Object.keys(series).forEach(c => series[c].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  const now = readRates_();
  return (cur, date) => {
    if (cur === 'USD') return 1;
    let best = 0;
    (series[cur] || []).forEach(x => { if (x[0] <= date) best = x[1]; });
    return best || now[cur] || 0;
  };
}

function writeTaxesSheet_(t) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(TAX_SHEET_) || ss.insertSheet(TAX_SHEET_);
  const cols = 2 + t.months.length;
  // A formula, not a Date: the spreadsheet's own midnight, so Monthly finds the month by MATCH whatever the time zones.
  const monthDate = m => '=DATE(' + Number(m.slice(0, 4)) + ',' + Number(m.slice(5, 7)) + ',1)';
  const row = (label, now, map) => [label, now].concat(t.months.map(m => (map ? Math.round(map[m] * 100) / 100 : '')));
  const running = (acc, pay) => {
    let x = 0;
    const out = {};
    t.months.forEach(m => { if (m >= t.start.slice(0, 7)) x += acc[m] - pay[m]; out[m] = m >= t.start.slice(0, 7) ? x : 0; });
    return out;
  };
  const owedAll = {};
  t.months.forEach(m => { owedAll[m] = 0; });
  t.rules.forEach(r => { const run = running(r.accrued, r.paid); t.months.forEach(m => { owedAll[m] += run[m]; }); });
  const rows = [
    ['Line', 'Owed now'].concat(t.months.map(monthDate)),
    row('Accrued, $', '', t.accrued),
    row('Paid, $', '', t.paid),
    row('Owed (rules below), $', Math.round(t.owedUsd * 100) / 100, owedAll),
    row('', '', null),
  ];
  t.rules.forEach(r => {
    rows.push(row(r.label + ' · accrued, $', '', r.accrued));
    rows.push(row(r.label + ' · paid, $', '', r.paid));
    rows.push(row(r.label + ' · owed, $', Math.round(r.owedUsd * 100) / 100, running(r.accrued, r.paid)));
    rows.push(row('   owed in ' + r.owed.currency, Math.round(r.owed.amount), null));
    rows.push(row('', '', null));
  });
  rows.push(row('Withheld at source (accrued = paid), $', '', t.withheld));
  rows.push(row('Paid without a rule, $', '', t.other));
  rows.push(row('', '', null));
  [
    'Generated by the script (Taxes.js) after changes; rules in Settings: tax_accrual_start, tax_interest_country, tax_interest_rate,',
    'tax_interest_currency, tax_interest_allowance_<year>, tax_business_rate, tax_business_fixed, tax_business_fixed_currency, tax_business_since.',
    'A payment in Taxes settles the rule of the account paid from (business account → business, account in the interest country → interest).',
  ].forEach(text => rows.push(row(text, '', null)));
  sh.clearContents();
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
  if (sh.getMaxRows() < rows.length) sh.insertRowsAfter(sh.getMaxRows(), rows.length - sh.getMaxRows());
  sh.getRange(1, 1, rows.length, cols).setValues(rows);
  sh.getRange(1, 3, 1, cols - 2).setNumberFormat('mmm yy');
  sh.getRange(2, 2, rows.length - 1, cols - 1).setNumberFormat('$#,##0;-$#,##0;–');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
}

/** Recomputes the Taxes sheet and the summary sync hands to the app. */
function refreshTaxes_(ledger) {
  const l = ledger || loadLedger_();
  const t = computeTaxes_({
    accounts: l.accounts,
    txs: l.txs,
    categories: l.categories,
    settings: l.settings,
    marks: l.marks,
    today: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'),
    usdPer: usdPerLookup_(),
  });
  writeTaxesSheet_(t);
  const months = {};
  t.months.forEach(m => { if (m >= t.start.slice(0, 7)) months[m] = Math.round(t.accrued[m] * 100) / 100; });
  const summary = {
    owedUsd: Math.round(t.owedUsd * 100) / 100,
    rules: t.rules.map(r => ({ id: r.id, label: r.label, country: r.country, owedUsd: Math.round(r.owedUsd * 100) / 100, owed: { amount: Math.round(r.owed.amount), currency: r.owed.currency }, periods: r.periods })),
    marks: t.marks,
    accrued: months,
    at: new Date().toISOString(),
  };
  const props = PropertiesService.getScriptProperties();
  props.setProperty('taxes_summary', JSON.stringify(summary));
  props.deleteProperty('taxes_dirty');
  return summary;
}

function readTaxesSummary_() {
  const raw = PropertiesService.getScriptProperties().getProperty('taxes_summary');
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

/**
 * After a change: in about a minute, outside the request (both read the whole ledger), run the automations that
 * became due (a new rule, a moved start) and recompute the taxes.
 */
function markTaxesDirty_() {
  PropertiesService.getScriptProperties().setProperty('taxes_dirty', '1');
  const pending = ScriptApp.getProjectTriggers().some(tr => tr.getHandlerFunction() === 'backgroundJob');
  if (!pending) ScriptApp.newTrigger('backgroundJob').timeBased().after(60 * 1000).create();
}

function backgroundJob() {
  ScriptApp.getProjectTriggers().forEach(tr => {
    if (tr.getHandlerFunction() === 'backgroundJob' || tr.getHandlerFunction() === 'refreshTaxesJob') ScriptApp.deleteTrigger(tr);
  });
  withLock_(() => {
    const ledger = loadLedger_();
    runAutomations_(ledger);
    refreshTaxes_(ledger);
    refreshIncome_(ledger);
  });
}

/** The menu's "Recalculate taxes" (and runs scheduled before automations existed). */
function refreshTaxesJob() {
  backgroundJob();
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
