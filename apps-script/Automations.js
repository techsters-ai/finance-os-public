// Automations: rules that record transactions by themselves (the Automations sheet, edited in the app).
// Kind 'interest': income on an account's balance at the rate on its card (apr_gross), for the days since the
// previous accrual (Actual/365): balance at the start of the day × rate × days / 365. It goes where the account
// pays interest (interest_to) or into the account itself, as Interest (or the rule's category), with a Taxes
// expense when the account has automatic tax.
// Kind 'expense': a fixed amount (in the account's currency) off the account into the rule's category.
// Schedules: daily, weekly (from the start date), monthly on a day, yearly on the start's day. Each transaction has
// a fixed id (auto_<rule>_<date>): a run never repeats one, and a deleted one stays deleted. The daily job and the
// background job after a change run every due date from the rule's start up to today.

const AUTO_MAX_DATES_ = 400;

function dayMsUtc_(d) {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
}

function isoUtc_(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The day `day` of a month, or its last day when shorter. */
function monthDay_(y, m, day) {
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + String(Math.min(day, last)).padStart(2, '0');
}

/** Due dates from the start to today: [date, days since the previous accrual]. */
function autoDueDates_(a, today) {
  const start = a.start_date || today;
  const out = [];
  if (a.frequency === 'weekly') {
    for (let ms = dayMsUtc_(start); isoUtc_(ms) <= today && out.length < AUTO_MAX_DATES_; ms += 7 * 86400000) out.push([isoUtc_(ms), 7]);
    return out;
  }
  if (a.frequency === 'yearly') {
    const y0 = Number(start.slice(0, 4));
    const m = Number(start.slice(5, 7));
    const day = Number(start.slice(8, 10));
    for (let y = y0; y < y0 + 100; y++) {
      const d = monthDay_(y, m, day);
      if (d > today) break;
      out.push([d, Math.round((dayMsUtc_(d) - dayMsUtc_(monthDay_(y - 1, m, day))) / 86400000)]);
    }
    return out;
  }
  if (a.frequency === 'monthly') {
    const day = Math.min(31, Math.max(1, Number(a.day) || Number(start.slice(8, 10))));
    let y = Number(start.slice(0, 4));
    let m = Number(start.slice(5, 7));
    for (let k = 0; k < AUTO_MAX_DATES_; k++, m++) {
      const d = monthDay_(y, m, day);
      if (d > today) break;
      if (d >= start) out.push([d, Math.round((dayMsUtc_(d) - dayMsUtc_(monthDay_(y, m - 1, day))) / 86400000)]);
    }
    return out;
  }
  for (let ms = dayMsUtc_(start); isoUtc_(ms) <= today && out.length < AUTO_MAX_DATES_; ms += 86400000) out.push([isoUtc_(ms), 1]);
  return out;
}

const round2_ = x => Math.round((x + (x >= 0 ? 1 : -1) * Number.EPSILON) * 100) / 100;

/**
 * What the active rules should add by today. p: { autos, accounts, txs (deleted ones too), categories, today, now,
 * rates (USD per unit: interest paid into an account in another currency is converted, the original kept) }.
 * Returns the transactions to write and the rules with their last_run moved on.
 */
function planAutomations_(p) {
  const accs = {};
  p.accounts.forEach(a => { accs[a.id] = a; });
  const known = {};
  p.txs.forEach(t => { known[t.id] = true; });
  const live = p.txs.filter(t => !t.deleted && t.date);
  const taxCat = p.categories.find(c => c.kind === 'expense' && !c.archived && !c.parent_id && /tax/i.test(c.name) && isSharedScope_(c.scope));
  const rateOf = a => (a && Number(a.tax_rate) > 0 && Number(a.tax_rate) < 1 ? Number(a.tax_rate) : 0);
  const out = [];
  const autos = [];

  p.autos.forEach(a => {
    if (a.deleted || !a.active) return;
    if (a.kind === 'expense') {
      const from = accs[a.account_id];
      const amount = round2_(Math.abs(Number(a.amount) || 0));
      if (!from || from.archived || !amount || !a.category_id) return;
      let lastPaid = a.last_run || '';
      autoDueDates_(a, p.today).forEach(([d]) => {
        const id = 'auto_' + a.id + '_' + d;
        if (known[id] || d < from.opening_date) return;
        out.push({
          id, date: d, type: 'expense', account_id: from.id, amount: -amount, to_account_id: '', to_amount: '',
          category_id: a.category_id, orig_amount: '', orig_currency: '', note: a.name || '', tags: 'auto',
          created_at: p.now, updated_at: p.now, deleted: false,
        });
        known[id] = true;
        if (d > lastPaid) lastPaid = d;
      });
      if (lastPaid && lastPaid !== a.last_run) autos.push(Object.assign({}, a, { last_run: lastPaid, updated_at: p.now }));
      return;
    }
    if ((a.kind || 'interest') !== 'interest') return;
    const acc = accs[a.account_id];
    const apr = acc ? Number(acc.apr_gross) : 0;
    if (!acc || acc.archived || !(apr > 0)) return;
    const target = acc.interest_to && accs[acc.interest_to] && !accs[acc.interest_to].archived ? accs[acc.interest_to] : acc;
    const taxFrom = acc.auto_tax && rateOf(acc) ? acc : target !== acc && target.auto_tax && rateOf(target) ? target : null;
    // The account's own moves, plus what this run adds to it (accruals compound day by day).
    const moves = [];
    const addMoves = list => list.forEach(t => {
      if (t.date < acc.opening_date) return;
      if (t.account_id === acc.id) moves.push([t.date, Number(t.amount) || 0]);
      if (t.to_account_id === acc.id) moves.push([t.date, Number(t.to_amount) || 0]);
    });
    addMoves(live);
    const balanceBefore = d => moves.reduce((s, x) => (x[0] < d ? s + x[1] : s), Number(acc.opening_balance) || 0);
    let last = a.last_run || '';
    autoDueDates_(a, p.today).forEach(([d, days]) => {
      const id = 'auto_' + a.id + '_' + d;
      if (known[id] || d < acc.opening_date) return;
      const earned = round2_((balanceBefore(d) * apr * days) / 365);
      if (!(earned > 0)) return;
      // Paid into an account in another currency: converted at today's rates, the original amount kept.
      const other = target.currency !== acc.currency;
      const rates = p.rates || {};
      if (other && !(rates[acc.currency] > 0 && rates[target.currency] > 0)) return;
      const amount = other ? round2_((earned * rates[acc.currency]) / rates[target.currency]) : earned;
      const income = {
        id, date: d, type: 'income', account_id: target.id, amount, to_account_id: '', to_amount: '',
        category_id: a.category_id || 'inc_interest', orig_amount: other ? earned : '', orig_currency: other ? acc.currency : '',
        note: a.name || 'Interest', tags: 'auto', created_at: p.now, updated_at: p.now, deleted: false,
      };
      out.push(income);
      known[id] = true;
      addMoves([income]);
      if (taxFrom && taxCat) {
        const tax = round2_(amount * rateOf(taxFrom));
        const t = {
          id: id + '-tax', date: d, type: 'expense', account_id: target.id, amount: -tax, to_account_id: '', to_amount: '',
          category_id: taxCat.id, orig_amount: '', orig_currency: '', note: 'Withheld ' + Math.round(rateOf(taxFrom) * 1000) / 10 + '% · ' + taxFrom.name,
          tags: 'auto', created_at: p.now, updated_at: p.now, deleted: false,
        };
        out.push(t);
        addMoves([t]);
      }
      if (d > last) last = d;
    });
    if (last && last !== a.last_run) autos.push(Object.assign({}, a, { last_run: last, updated_at: p.now }));
  });
  return { txs: out, autos };
}

/** Runs the due automations: writes their transactions (into the ledger too) and moves the rules' last_run on. */
function runAutomations_(ledger) {
  const l = ledger || loadLedger_();
  if (!l.autos.length) return { created: 0 };
  const now = new Date().toISOString();
  const rates = readRates_();
  const plan = planAutomations_({
    autos: l.autos, accounts: l.accounts, txs: l.txs, categories: l.categories,
    today: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'), now, rates,
  });
  if (plan.txs.length) {
    const txs = plan.txs.map(t => normalizeTransaction_(t, rates));
    applyRecords_('transactions', txs, now, {}, rates);
    txs.forEach(t => l.txs.push(t));
  }
  if (plan.autos.length) applyRecords_('automations', plan.autos, now, {}, {});
  return { created: plan.txs.length };
}
