// Month close: on the 1st the daily job writes last month's results to the Closes sheet — income, spending, taxes,
// savings (from Monthly, the Taxes and Income sheets) and the capital at the month's end (the balance snapshot of the
// 1st) — one row a month. Until Settings close_freeze_day (7th by default) the row and the snapshot are redone each
// day, so transactions recorded a few days late still count; after it they stay as they were.

const CLOSES_SHEET_ = 'Closes';
const CLOSE_COLUMNS_ = [
  'month', 'status', 'updated', 'income_earned', 'income_received', 'expenses', 'essential', 'business_costs',
  'investment_costs', 'taxes_accrued', 'taxes_paid', 'savings', 'savings_rate', 'burn', 'net_worth', 'liquid',
  'investments', 'business', 'owed_to_you', 'you_owe', 'taxes_owed', 'runway_months',
];

const r2c_ = x => (typeof x === 'number' && isFinite(x) ? Math.round(x * 100) / 100 : '');

/**
 * One close row. p: { month, final, updated, monthly: { income, expenses, essential, savings, business, investment,
 * taxes } (USD, Monthly's rows), shift (the Income sheet's), taxesPaid, taxesOwed, burn, snapshot: [{ group, usd }] }.
 */
function buildClose_(p) {
  const m = p.monthly || {};
  const by = { liquid: 0, credit: 0, investment: 0, business: 0, owed: 0, owe: 0, any: false };
  (p.snapshot || []).forEach(s => {
    by.any = true;
    if (s.group === 'debt') {
      if (s.usd > 0) by.owed += s.usd;
      else by.owe -= s.usd;
    } else if (by[s.group] !== undefined) by[s.group] += s.usd;
  });
  const liquid = by.liquid + by.credit;
  const net = (p.snapshot || []).reduce((x, s) => x + s.usd, 0);
  const income = Number(m.income) || 0;
  const savings = Number(m.savings) || 0;
  return {
    month: p.month,
    status: p.final ? 'final' : 'open',
    updated: p.updated,
    income_earned: r2c_(income),
    income_received: r2c_(income - (Number(p.shift) || 0)),
    expenses: r2c_(Number(m.expenses) || 0),
    essential: r2c_(Number(m.essential) || 0),
    business_costs: r2c_(Number(m.business) || 0),
    investment_costs: r2c_(Number(m.investment) || 0),
    taxes_accrued: r2c_(Number(m.taxes) || 0),
    taxes_paid: r2c_(Number(p.taxesPaid) || 0),
    savings: r2c_(savings),
    savings_rate: income > 0 ? Math.round((savings / income) * 1000) / 1000 : '',
    burn: r2c_(p.burn),
    net_worth: by.any ? r2c_(net) : '',
    liquid: by.any ? r2c_(liquid) : '',
    investments: by.any ? r2c_(by.investment) : '',
    business: by.any ? r2c_(by.business) : '',
    owed_to_you: by.any ? r2c_(by.owed) : '',
    you_owe: by.any ? r2c_(by.owe) : '',
    taxes_owed: r2c_(p.taxesOwed),
    runway_months: by.any && p.burn > 0 ? Math.round(((liquid - by.owe) / p.burn) * 10) / 10 : '',
  };
}

/** A generated sheet's row by its label, as { 'YYYY-MM': value } from the DATE headers in row 1 (from column `from`). */
function rowByMonth_(sheetName, rowIndex, from) {
  const sh = SpreadsheetApp.getActive().getSheetByName(sheetName);
  const out = {};
  if (!sh || sh.getLastRow() < rowIndex) return out;
  const cols = sh.getLastColumn() - from + 1;
  if (cols < 1) return out;
  const head = sh.getRange(1, from, 1, cols).getValues()[0];
  const vals = sh.getRange(rowIndex, from, 1, cols).getValues()[0];
  head.forEach((d, i) => { if (isDate_(d)) out[formatDate_(d).slice(0, 7)] = Number(vals[i]) || 0; });
  return out;
}

/** Monthly's results rows (2–11) per month. */
function monthlyByMonth_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Monthly');
  const out = {};
  if (!sh) return out;
  const cols = sh.getLastColumn() - 6;
  const v = sh.getRange(1, 7, 11, cols).getValues();
  v[0].forEach((d, i) => {
    if (!isDate_(d)) return;
    const n = r => Number(v[r - 1][i]) || 0;
    out[formatDate_(d).slice(0, 7)] = {
      income: n(2), expenses: n(3), essential: n(4), savings: n(5), business: n(8), investment: n(9), taxes: n(10),
    };
  });
  return out;
}

/** Writes (or redoes) the close rows for the given months, oldest first; others stay. */
function writeCloses_(months, today, ledger) {
  const settings = ledger ? ledger.settings : readSettings_();
  const freeze = Number(settings.close_freeze_day) > 0 ? Number(settings.close_freeze_day) : 7;
  const window = Number(settings.burn_window_months) > 0 ? Number(settings.burn_window_months) : 6;
  const monthly = monthlyByMonth_();
  const shift = rowByMonth_('Income', 2, 2);
  const taxesPaid = rowByMonth_('Taxes', 3, 3);
  const taxesOwed = rowByMonth_('Taxes', 4, 3);
  const groups = {};
  (ledger ? ledger.accounts : readRecords_('accounts')).forEach(a => { groups[a.id] = a.group; });
  const snaps = {};
  const sn = SpreadsheetApp.getActive().getSheetByName('Snapshots');
  if (sn && sn.getLastRow() > 1) {
    sn.getRange(2, 1, sn.getLastRow() - 1, 6).getValues().forEach(r => {
      const d = formatDate_(r[0]);
      (snaps[d] = snaps[d] || []).push({ group: groups[r[1]] || 'liquid', usd: Number(r[5]) || 0 });
    });
  }
  const all = Object.keys(monthly).sort();
  const rows = months.map(m => {
    const next = shiftMonth_(m, 1) + '-01';
    const prior = all.filter(x => x <= m).slice(-window).map(x => monthly[x].expenses).filter(x => x > 0);
    const final = today > next.slice(0, 8) + String(freeze).padStart(2, '0');
    return buildClose_({
      month: m, final, updated: today, monthly: monthly[m], shift: shift[m], taxesPaid: taxesPaid[m], taxesOwed: taxesOwed[m],
      burn: prior.length ? prior.reduce((x, y) => x + y, 0) / prior.length : '', snapshot: snaps[next] || [],
    });
  });

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(CLOSES_SHEET_) || ss.insertSheet(CLOSES_SHEET_);
  const keep = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, CLOSE_COLUMNS_.length).getValues() : [];
  const byMonth = {};
  keep.forEach(r => { const k = isDate_(r[0]) ? formatDate_(r[0]).slice(0, 7) : String(r[0]); if (k) byMonth[k] = r; });
  rows.forEach(r => { byMonth[r.month] = CLOSE_COLUMNS_.map(c => r[c]); });
  const out = Object.keys(byMonth).sort().map(k => byMonth[k]);
  sh.clearContents();
  sh.getRange(1, 1, 1, CLOSE_COLUMNS_.length).setValues([CLOSE_COLUMNS_]);
  if (out.length) {
    sh.getRange(2, 1, out.length, CLOSE_COLUMNS_.length).setValues(out.map(r => ["'" + String(r[0])].concat(r.slice(1))));
    sh.getRange(2, 4, out.length, 9).setNumberFormat('$#,##0;-$#,##0;–');
    sh.getRange(2, 13, out.length, 1).setNumberFormat('0%');
    sh.getRange(2, 14, out.length, 8).setNumberFormat('$#,##0;-$#,##0;–');
  }
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  return rows;
}

/**
 * The daily part: on the 1st (and until the freeze day) redo the snapshot of the 1st and last month's close.
 * Returns the month closed, or '' when there's nothing to do.
 */
function monthClose_(ledger) {
  const today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  const settings = ledger ? ledger.settings : readSettings_();
  const freeze = Number(settings.close_freeze_day) > 0 ? Number(settings.close_freeze_day) : 7;
  if (Number(today.slice(8, 10)) > freeze) return '';
  const first = today.slice(0, 8) + '01';
  refreshSnapshot_(first, ledger);
  const month = shiftMonth_(today.slice(0, 7), -1);
  writeCloses_([month], today, ledger);
  return month;
}

/** The snapshot of a 1st, taken again: its automatic rows replaced (migrated ones are left alone). */
function refreshSnapshot_(dateStr, ledger) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Snapshots');
  const txs = (ledger ? ledger.txs : readRecords_('transactions')).filter(t => !t.deleted);
  if (!txs.some(t => t.date && t.date < dateStr)) return;
  if (sh.getLastRow() > 1) {
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    if (v.some(r => formatDate_(r[0]) === dateStr && r[6] !== 'auto')) return;
    const rest = v.filter(r => !(formatDate_(r[0]) === dateStr && r[6] === 'auto'));
    if (rest.length !== v.length) {
      sh.getRange(2, 1, v.length, v[0].length).clearContent();
      if (rest.length) sh.getRange(2, 1, rest.length, rest[0].length).setValues(rest);
    }
  }
  createSnapshot_(dateStr, txs, 'auto');
}
