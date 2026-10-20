// Apps Script logic tests on Node: apps-script/*.js runs in a vm context
// with mocked SpreadsheetApp / Utilities / LockService / PropertiesService / ContentService.
// Run: node --test tests/apps-script.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, accHeaders, TS0 } from './gas-harness.mjs';

const tx = (over = {}) => ({
  id: 'tx1', date: '2026-10-18', type: 'expense', account_id: 'acc_rub', amount: -1000,
  to_account_id: '', to_amount: '', category_id: 'exp_food', orig_amount: '', orig_currency: '',
  note: 'coffee', usd_rate: 0.0125, amount_usd: -12.5, created_at: '2026-10-18T11:00:00.000Z',
  updated_at: '2026-10-18T11:00:00.000Z', deleted: false, ...over,
});

test('setup on an empty spreadsheet adds every sheet with headers and starter rows; a second run adds nothing', () => {
  const { ctx, sheets, post } = makeEnv();
  for (const name of Object.keys(sheets)) delete sheets[name];
  const added = ctx.ensureSheets_();
  assert.deepEqual([...added].sort(), ['Accounts', 'Automations', 'Categories', 'History', 'Locations', 'Rates', 'RatesHistory', 'Settings', 'Snapshots', 'TaxMarks', 'TaxRates', 'Transactions']);
  assert.deepEqual([...ctx.ensureSheets_()], []);
  assert.equal(sheets.Rates.data[1][0], 'USD');
  assert.ok(sheets.Categories.data.some(r => r[0] === 'inc_interest'));
  const res = post({ key: 'secret', action: 'sync', since: null, ops: [] });
  assert.equal(res.ok, true);
  assert.equal(res.changes.categories.length, 17);
  assert.equal(res.settings.base_currency, 'USD');
  assert.equal(res.rates.USD, 1);
});

test('no key → unauthorized', () => {
  const { post } = makeEnv();
  assert.equal(post({ key: 'wrong', action: 'ping' }).error, 'unauthorized');
});

test('the first sync returns everything, rates and settings', () => {
  const { post } = makeEnv();
  const res = post({ key: 'secret', action: 'sync', since: null, ops: [] });
  assert.equal(res.ok, true);
  assert.equal(res.changes.accounts.length, 2);
  assert.equal(res.changes.accounts[0].opening_date, '2026-09-01');
  assert.equal(res.changes.accounts[0].in_emergency_fund, false);
  assert.equal(res.changes.categories[0].essential, true);
  assert.deepEqual(res.rates, { USD: 1, RUB: 0.0125, XAU: 4000 });
  assert.equal(res.settings.second_currency, 'RUB');
  assert.deepEqual(res.metrics, { burn: 4180.46, essential: 2650 });
  assert.deepEqual(res.history, [
    { month: '2026-08', category_id: 'exp_food', amount_usd: -940 },
    { month: '2026-08', category_id: 'inc_work', amount_usd: 4800 },
  ]);
});

test('a new transaction is appended, the date is written as a Date, the server sets server_ts', () => {
  const { post, sheets } = makeEnv();
  const res = post({ key: 'secret', action: 'sync', since: null, ops: [{ entity: 'transactions', record: tx({ server_ts: 'client-junk' }) }] });
  assert.equal(res.applied, 1);
  const row = sheets.Transactions.data[1];
  assert.ok(row[1] instanceof Date);
  assert.equal(row[16], res.serverTs);
  assert.equal(res.changes.transactions[0].date, '2026-10-18');
  assert.equal(res.changes.transactions[0].amount, -1000);
});

test('resending the same id updates the row instead of duplicating it', () => {
  const { post, sheets, tick } = makeEnv();
  post({ key: 'secret', action: 'sync', since: null, ops: [{ entity: 'transactions', record: tx() }] });
  tick(60000);
  post({ key: 'secret', action: 'sync', since: null, ops: [{ entity: 'transactions', record: tx({ amount: -2000, amount_usd: -25, updated_at: '2026-10-18T11:05:00.000Z' }) }] });
  assert.equal(sheets.Transactions.getLastRow(), 2);
  assert.equal(sheets.Transactions.data[1][4], -2000);
});

test('last write wins: an older version does not overwrite a newer one', () => {
  const { post, sheets } = makeEnv();
  post({ key: 'secret', action: 'sync', since: null, ops: [{ entity: 'transactions', record: tx({ amount: -2000, updated_at: '2026-10-18T11:10:00.000Z' }) }] });
  const res = post({ key: 'secret', action: 'sync', since: null, ops: [{ entity: 'transactions', record: tx({ amount: -1, updated_at: '2026-10-18T11:00:00.000Z' }) }] });
  assert.equal(sheets.Transactions.data[1][4], -2000);
  assert.equal(res.applied, 0);
  assert.equal(res.changes.transactions.find(t => t.id === 'tx1').amount, -2000);
});

test('since: only changes after the cursor are returned (with a 2 min overlap)', () => {
  const { post, tick } = makeEnv();
  const first = post({ key: 'secret', action: 'sync', since: null, ops: [] });
  tick(10 * 60000);
  const res = post({ key: 'secret', action: 'sync', since: first.serverTs, ops: [{ entity: 'transactions', record: tx() }] });
  assert.equal(res.changes.accounts.length, 0);
  assert.equal(res.changes.transactions.length, 1);
});

test('since: rows changed in the middle of a long ledger come back whole, the rest stay out', () => {
  const { post, tick } = makeEnv();
  const ops = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ entity: 'transactions', record: tx({ id, amount: -(i + 1) }) }));
  post({ key: 'secret', action: 'sync', since: null, ops });
  tick(10 * 60000);
  const quiet = post({ key: 'secret', action: 'sync', since: null, ops: [] });
  tick(10 * 60000);
  const edit = (id, amount) => ({ entity: 'transactions', record: tx({ id, amount, updated_at: '2026-10-18T12:00:00.000Z' }) });
  const res = post({ key: 'secret', action: 'sync', since: quiet.serverTs, ops: [edit('b', -20), edit('d', -40)] });
  assert.deepEqual(res.changes.transactions.map(t => [t.id, t.amount]), [['b', -20], ['d', -40]]);
  tick(10 * 60000);
  assert.equal(post({ key: 'secret', action: 'sync', since: res.serverTs, ops: [] }).changes.transactions.length, 2);
  tick(10 * 60000);
  const later = new Date(Date.parse(res.serverTs) + 5 * 60000).toISOString();
  assert.equal(post({ key: 'secret', action: 'sync', since: later, ops: [] }).changes.transactions.length, 0);
});

test('sync carries the allocation inputs: currency trends, targets and limits', () => {
  const { post } = makeEnv();
  const res = post({ key: 'secret', action: 'sync', since: null, ops: [] });
  assert.deepEqual(res.allocation.trends, { USD: 0, RUB: -0.08, XAU: 0 });
  assert.deepEqual(res.allocation.targets, [{ class: 'Bonds & deposits', target: 0.3 }, { class: 'Stocks', target: 0.7 }]);
  assert.deepEqual(res.allocation.limits, [
    { dimension: 'country', value: '*', limit: 0.4 },
    { dimension: 'asset_class', value: 'Crypto', limit: 0.1 },
  ]);
});

test('fx windows: the rate on or before Jan 1 and a year ago, and the latest; pegs keep their value', () => {
  const { post, sheets } = makeEnv();
  sheets.RatesHistory.data.push(
    [new Date(2025, 9, 10), 'RUB', 1 / 81],
    [new Date(2025, 11, 31), 'RUB', 1 / 79],
    [new Date(2026, 0, 5), 'RUB', 1 / 78],
    [new Date(2026, 9, 17), 'RUB', 1 / 84],
  );
  const { fx } = post({ key: 'secret', action: 'sync', since: null, ops: [] }).allocation;
  assert.deepEqual(fx.ytd, { start: '2026-01-01', rates: { RUB: { date: '2025-12-31', usd: 1 / 79 }, USD: { date: '2026-01-01', usd: 1 } } });
  assert.deepEqual(fx.y1.rates.RUB, { date: '2025-10-10', usd: 1 / 81 });
  assert.equal(fx.y1.start, '2025-10-18');
  assert.deepEqual(fx.now.RUB, { date: '2026-10-17', usd: 1 / 84 });
  assert.equal(fx.now.XAU, undefined); // quoted, but no history yet
});

test('fx windows take the median of the days around, so a weekend spike does not move a return', () => {
  const { post, sheets } = makeEnv();
  // A spike on Dec 31, the last day before the window: the days around it (Dec 29 – Jan 2) outvote it.
  [[29, 381], [30, 382], [31, 388], [33, 382]].forEach(([d, v]) => sheets.RatesHistory.data.push([new Date(2025, 11, d), 'XAU', 1 / v]));
  const { fx } = post({ key: 'secret', action: 'sync', since: null, ops: [] }).allocation;
  assert.deepEqual(fx.ytd.rates.XAU, { date: '2025-12-31', usd: 1 / 382 });
});

test('fx backfill rewrites the quoted currencies for the days the source answered, other rows stay', () => {
  const { ctx, sheets, fxDays } = makeEnv();
  sheets.RatesHistory.data.push([new Date(2026, 9, 16), 'RUB', 0.5], [new Date(2026, 9, 16), 'USDT', 1]);
  fxDays['2026-10-15'] = { date: '2026-10-15', usd: { rub: 80, xau: 0.00025 } };
  fxDays['2026-10-16'] = { date: '2026-10-16', usd: { rub: 82 } };
  const res = ctx.backfillRatesHistory_('2026-10-15');
  assert.deepEqual(JSON.parse(JSON.stringify(res)), { days: 3, fetched: 2, missed: ['2026-10-17'], rows: 5 });
  const rows = sheets.RatesHistory.data.slice(1).filter(r => r[0] !== '').map(r => [ctx.formatDate_(r[0]), r[1], r[2]]);
  assert.deepEqual(rows, [
    ['2026-10-01', 'RUB', 0.012],
    ['2026-10-15', 'RUB', 1 / 80],
    ['2026-10-15', 'XAU', 4000],
    ['2026-10-16', 'RUB', 1 / 82],
    ['2026-10-16', 'USDT', 1],
  ]);
});

test('fx windows are cached for the day; the daily job drops the cache when it writes rates', () => {
  const { post, ctx, sheets, fxDays } = makeEnv();
  const sync = () => post({ key: 'secret', action: 'sync', since: null, ops: [] }).allocation.fx;
  assert.deepEqual(sync().now.RUB, { date: '2026-10-01', usd: 0.012 });
  sheets.RatesHistory.data.push([new Date(2026, 9, 17), 'RUB', 1 / 84]);
  assert.deepEqual(sync().now.RUB, { date: '2026-10-01', usd: 0.012 }); // cached
  fxDays.latest = { date: '2026-10-18', usd: { rub: 83 } };
  ctx.updateRatesHistory_();
  assert.equal(sync().now.RUB.date, '2026-10-18');
});

test('the daily job records the source\'s latest day; without the source, gold and Rates as before', () => {
  const { ctx, sheets, fxDays } = makeEnv();
  fxDays.latest = { date: '2026-10-18', usd: { rub: 83, xau: 0.00024 } };
  sheets.RatesHistory.data.push([new Date(2026, 9, 15), 'RUB', 0.5]); // a fallback value the source now has
  fxDays['2026-10-15'] = { date: '2026-10-15', usd: { rub: 82 } };
  ctx.updateRatesHistory_();
  ctx.updateRatesHistory_(); // twice a day: no duplicates
  const rows = () => sheets.RatesHistory.data.slice(1).map(r => [ctx.formatDate_(r[0]), r[1], r[2]]);
  assert.deepEqual(rows().slice(1), [['2026-10-15', 'RUB', 1 / 82], ['2026-10-18', 'RUB', 1 / 83], ['2026-10-18', 'XAU', 1 / 0.00024]]);
  delete fxDays.latest;
  delete fxDays['2026-10-15'];
  sheets.RatesHistory.data.splice(2);
  ctx.updateRatesHistory_();
  assert.deepEqual(rows().slice(1), [['2026-10-18', 'RUB', 0.0125], ['2026-10-18', 'XAU', 4100]]);
});

const taxCase = () => ({
  accounts: [
    { id: 'dep', group: 'liquid', country: 'TR', currency: 'TRY' },
    { id: 'biz', group: 'business', country: 'Estonia', currency: 'USD' },
    { id: 'wh', group: 'liquid', country: 'Spain', currency: 'USD' },
    { id: 'eu', group: 'liquid', country: 'Germany', currency: 'EUR' },
  ],
  categories: [
    { id: 'inc_interest', parent_id: '', scope: '' },
    { id: 'inc_work', parent_id: '', scope: '' },
    { id: 'exp_taxes', parent_id: '', scope: 'liquid, business, investment' },
  ],
  settings: {
    history_start: '2024-11-01', tax_accrual_start: '2025-01-01', tax_interest_country: 'tr', tax_interest_currency: 'TRY', tax_interest_rate: 0.15, tax_interest_allowance_2025: 100000,
    tax_business_rate: 0.01, tax_business_fixed: 10000, tax_business_fixed_currency: 'KZT', tax_business_since: '2025-02-01',
  },
  today: '2025-03-20',
  usdPer: cur => ({ TRY: 0.01, KZT: 0.0025, EUR: 1.1 })[cur] || 1,
  txs: [
    { id: 'old', date: '2024-12-10', type: 'expense', account_id: 'dep', amount: -5000, amount_usd: -50, category_id: 'exp_taxes' },
    { id: 'i1', date: '2025-01-15', type: 'income', account_id: 'dep', amount: 80000, amount_usd: 800, category_id: 'inc_interest' },
    { id: 'i2', date: '2025-02-15', type: 'income', account_id: 'dep', amount: 50000, amount_usd: 500, category_id: 'inc_interest' },
    { id: 'w1', date: '2025-02-20', type: 'income', account_id: 'biz', amount: 3000, amount_usd: 3000, category_id: 'inc_work' },
    { id: 'p1', date: '2025-03-05', type: 'expense', account_id: 'biz', amount: -40, amount_usd: -40, category_id: 'exp_taxes' },
    { id: 'k1', date: '2025-03-06', type: 'income', account_id: 'wh', amount: 100, amount_usd: 100, category_id: 'inc_interest' },
    { id: 'k1-tax', date: '2025-03-06', type: 'expense', account_id: 'wh', amount: -10, amount_usd: -10, category_id: 'exp_taxes' },
    { id: 'x1', date: '2025-03-07', type: 'expense', account_id: 'eu', amount: -7, amount_usd: -7, category_id: 'exp_taxes' },
  ],
});

test('taxes accrue by month: interest over the allowance in one country, the business share and fixed sum, withheld at once', () => {
  const { ctx } = makeEnv();
  const t = JSON.parse(JSON.stringify(ctx.computeTaxes_(taxCase())));
  assert.deepEqual(t.months, ['2024-11', '2024-12', '2025-01', '2025-02', '2025-03']);
  // Before the start a month shows what was paid; after it, what accrued.
  assert.deepEqual(t.accrued, { '2024-11': 0, '2024-12': 50, '2025-01': 0, '2025-02': 100, '2025-03': 35 });
  assert.deepEqual(t.paid, { '2024-11': 0, '2024-12': 50, '2025-01': 0, '2025-02': 0, '2025-03': 57 });
  const [ru, biz] = t.rules;
  assert.deepEqual([ru.id, ru.country], ['interest', 'TR']);
  // 130k of interest against a 100k allowance: 30k × 15% = 4,500 TRY = $45, in February when it crossed it.
  assert.equal(ru.accrued['2025-02'], 45);
  assert.deepEqual([ru.owedUsd, ru.owed], [45, { amount: 4500, currency: 'TRY' }]);
  // 1% of $3,000 + 10,000 KZT ($25) in Feb and Mar, minus the $40 paid from the business account.
  assert.equal(biz.owedUsd, 40);
  assert.deepEqual(biz.owed, { amount: 16000, currency: 'KZT' });
  assert.equal(t.withheld['2025-03'], 10);
  assert.equal(t.other['2025-03'], 7); // paid from an account no rule covers
  assert.equal(t.owedUsd, 85);
  // By period: interest a year; the business a quarter, the $40 paid settling the oldest (Q1 2025: 12,000 + 20,000 KZT).
  assert.deepEqual(ru.periods, [{ key: '2025', accrued: 4500, marked: 0, owed: 4500, owedUsd: 45 }]);
  assert.deepEqual(biz.periods, [{ key: '2025-Q1', accrued: 32000, marked: 0, owed: 16000, owedUsd: 40 }]);
});

test('tax marks from the app: paid already settles a period, deleted also takes it off the accrual', () => {
  const { ctx } = makeEnv();
  const t = JSON.parse(JSON.stringify(ctx.computeTaxes_({
    ...taxCase(),
    marks: [
      { id: 'interest_2025', rule: 'interest', period: '2025', action: 'deleted', amount: 4500, deleted: false },
      { id: 'business_2025-Q1', rule: 'business', period: '2025-Q1', action: 'paid', amount: 16000, deleted: false },
      { id: 'gone', rule: 'interest', period: '2025', action: 'paid', amount: 100, deleted: true },
    ],
  })));
  const [ru, biz] = t.rules;
  assert.deepEqual(ru.periods, [{ key: '2025', accrued: 4500, marked: 4500, owed: 0, owedUsd: 0 }]);
  assert.equal(ru.accrued['2025-02'], 0); // deleted: not a cost any more
  assert.equal(ru.owedUsd, 0);
  assert.deepEqual(biz.periods, [{ key: '2025-Q1', accrued: 32000, marked: 16000, owed: 0, owedUsd: 0 }]);
  assert.equal(biz.owedUsd, 0); // paid already: the accrual stays a cost
  assert.equal(t.accrued['2025-02'], 55);
  assert.deepEqual(t.marks, ['interest_2025', 'business_2025-Q1']);
});

test('a sync with changes schedules the tax recalculation; the summary rides along with sync', () => {
  const { post, ctx, triggers, sheets } = makeEnv();
  post({ key: 'secret', action: 'sync', since: null, ops: [{ entity: 'transactions', record: tx({ id: 'n1' }) }] });
  assert.deepEqual(triggers.map(t => t.getHandlerFunction()), ['backgroundJob']);
  post({ key: 'secret', action: 'sync', since: null, ops: [{ entity: 'transactions', record: tx({ id: 'n2' }) }] });
  assert.equal(triggers.length, 1); // one pending run is enough
  sheets.Categories.data.push(['exp_taxes', 'Taxes', 'expense', '', '', true, '🧾', '', false, 20, TS0, TS0, 'liquid, business, investment']);
  ctx.backgroundJob();
  assert.equal(triggers.length, 0);
  assert.ok(sheets.Taxes, 'the Taxes sheet is created');
  assert.equal(sheets.Taxes.data[1][0], 'Accrued, $');
  assert.equal(sheets.Taxes.data[2][0], 'Paid, $');
  const res = post({ key: 'secret', action: 'sync', since: null, ops: [] });
  assert.equal(typeof res.taxes.owedUsd, 'number');
  assert.deepEqual(res.taxes.rules, []); // no tax settings filled in: no rules
});

test('check-in: the place becomes a country on that day; a second country goes after the first, a repeat moves to the end', () => {
  const { post, sheets, triggers } = makeEnv();
  const a = post({ key: 'secret', action: 'checkin', lat: 38.7223, lon: -9.1393, date: '2026-09-25', source: 'shortcut' });
  assert.equal(a.ok, true);
  assert.equal(a.country, 'PT');
  assert.equal(a.day.id, 'loc_2026-09-25');
  assert.equal(a.day.countries, 'PT');
  // A comma-decimal phone sends text; the country code alone works too.
  const b = post({ key: 'secret', action: 'checkin', lat: '13,7563', lon: '100,5018', date: '2026-09-25', source: 'app' });
  assert.equal(b.day.countries, 'PT TH');
  assert.equal(b.day.city, 'Bangkok');
  assert.equal(post({ key: 'secret', action: 'checkin', country: 'pt', date: '2026-09-25' }).day.countries, 'TH PT');
  const rows = sheets.Locations.data.slice(1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][2], 'TH PT');
  assert.ok(rows[0][1] instanceof Date, 'the date is written as a Date');
  assert.equal(triggers.length, 0, 'a check-in does not recalculate taxes');
  // The app gets the day with the next sync.
  const res = post({ key: 'secret', action: 'sync', since: null, ops: [] });
  assert.deepEqual(res.changes.locations.map(d => [d.id, d.date, d.countries, d.source]), [['loc_2026-09-25', '2026-09-25', 'TH PT', 'shortcut']]);
});

test('check-in: at sea, without a place or with the wrong key nothing is written', () => {
  const { post, sheets } = makeEnv();
  assert.equal(post({ key: 'secret', action: 'checkin', lat: 0, lon: 0 }).error, 'bad_request');
  assert.equal(post({ key: 'secret', action: 'checkin' }).error, 'bad_request');
  assert.equal(post({ key: 'wrong', action: 'checkin', country: 'TH' }).error, 'unauthorized');
  assert.equal(sheets.Locations.data.length, 1);
});

test('days from the app sync like accounts and leave the taxes alone; a deleted day is checked in anew', () => {
  const { post, sheets, triggers } = makeEnv();
  const day = { id: 'loc_2026-10-12', date: '2026-10-12', countries: 'MN TH', city: '', source: 'manual', note: 'UBN→HKG→BKK', deleted: false, created_at: TS0, updated_at: TS0 };
  assert.equal(post({ key: 'secret', action: 'sync', since: null, ops: [{ entity: 'locations', record: day }] }).applied, 1);
  assert.equal(triggers.length, 0);
  post({ key: 'secret', action: 'sync', since: null, ops: [{ entity: 'locations', record: { ...day, deleted: true, updated_at: '2026-10-18T10:30:00.000Z' } }] });
  const res = post({ key: 'secret', action: 'checkin', country: 'TH', date: '2026-10-12' });
  assert.equal(res.day.countries, 'TH');
  assert.equal(res.day.deleted, false);
  assert.equal(sheets.Locations.data.length, 2);
});

test('tax residency: the app sets the country in Settings; sync carries the TaxRates rows', () => {
  const { post, sheets } = makeEnv();
  const set = post({ key: 'secret', action: 'set_setting', setting: 'tax_residency', value: 'th' }).settings;
  assert.equal(set.tax_residency, 'TH');
  assert.equal(set.tax_residency_set, 'manual 2026-10-18');
  post({ key: 'secret', action: 'set_setting', setting: 'tax_residency', value: 'AM' });
  assert.equal(sheets.Settings.data.filter(r => r[0] === 'tax_residency').length, 1, 'the row is updated, not added again');
  assert.equal(post({ key: 'secret', action: 'set_setting', setting: 'tax_residency', value: 'none' }).settings.tax_residency, 'NONE');
  assert.equal(post({ key: 'secret', action: 'set_setting', setting: 'tax_residency', value: 'Estonia' }).error, 'bad_request');
  assert.equal(post({ key: 'secret', action: 'set_setting', setting: 'base_currency', value: 'EUR' }).error, 'bad_request');
  const env2 = makeEnv();
  env2.ctx.SpreadsheetApp.getActive().insertSheet('TaxRates');
  env2.sheets.TaxRates.data.push(
    ['country', 'domestic_income', 'foreign_income', 'capital_gains', 'residency_rule', 'threshold_days', 'window', 'foreign_rate', 'note', 'as_of'],
    ['th', '0–35% progressive', 'Only if remitted', 'As income', '180 days in a calendar year', 180, 'year', 0.2, 'LTR visa: foreign income exempt', 2026],
    ['', 'a row without a country', '', '', '', '', '', '', '', ''],
  );
  const res = env2.post({ key: 'secret', action: 'sync', since: null, ops: [] });
  assert.equal(typeof res.taxRatesHash, 'string');
  // The app has them: the next sync carries only the hash.
  assert.equal(env2.post({ key: 'secret', action: 'sync', since: null, ops: [], taxRatesHash: res.taxRatesHash }).taxRates, undefined);
  assert.deepEqual(res.taxRates, [{ country: 'TH', domestic_income: '0–35% progressive', foreign_income: 'Only if remitted', capital_gains: 'As income', residency_rule: '180 days in a calendar year', threshold_days: 180, window: 'year', foreign_rate: 0.2, residency_tests: '', note: 'LTR visa: foreign income exempt', as_of: '2026', source: '', confidence: '' }]);
  assert.deepEqual(post({ key: 'secret', action: 'sync', since: null, ops: [] }).taxRates, [], 'no sheet, no rates');
});

test('residency rules: a warning 14 days before, then the residency set by itself; each once, out with the next check-in', () => {
  const { post, sheets, ctx } = makeEnv();
  ctx.SpreadsheetApp.getActive().insertSheet('TaxRates');
  sheets.TaxRates.data.push(
    ['country', 'threshold_days', 'window'],
    ['TH', 180, 'year'],
    ['PT', 183, '12m'],
  );
  // In Thailand since Jan 1 (Portugal the months before: a 12-month rule counts back past Jan 1).
  sheets.Locations.data.push(
    ['loc_2025-09-01', new Date(2025, 8, 1), 'PT', '', 'manual', '', false, TS0, TS0, TS0],
    ['loc_2026-01-01', new Date(2026, 0, 1), 'PT TH', '', 'manual', '', false, TS0, TS0, TS0],
  );
  const checkin = date => post({ key: 'secret', action: 'checkin', country: 'TH', date });
  assert.equal(checkin('2026-06-01').notify, '', '152 of 180: no warning yet');
  assert.equal(checkin('2026-06-15').notify, 'Tax residency risk: 14 more days in Thailand make you a tax resident there (166 of 180 this year).');
  assert.equal(checkin('2026-06-16').notify, '', 'warned once');
  const crossed = checkin('2026-06-29');
  assert.equal(crossed.notify, 'You are now a tax resident of Thailand: 180 days this year (180 make you one).');
  const settings = post({ key: 'secret', action: 'sync', since: null, ops: [] }).settings;
  assert.equal(settings.tax_residency, 'TH');
  assert.equal(settings.tax_residency_set, 'auto 2026-06-29: 180 days this year, the rule is 180');
  // Changed by hand afterwards: it stays.
  post({ key: 'secret', action: 'set_setting', setting: 'tax_residency', value: 'NONE' });
  assert.equal(checkin('2026-06-30').notify, '');
  assert.equal(post({ key: 'secret', action: 'sync', since: null, ops: [] }).settings.tax_residency, 'NONE');
  // Portugal's rule looks back 12 months, past Jan 1: Sep 1 – Jan 1 is 123 days on Jan 10 (1 since Jan 1).
  const check = ctx.residencyCheck_(ctx.readRecords_('locations'), ctx.readTaxRates_(), '2026-01-10');
  assert.deepEqual(check.status.map(s => [s.country, s.days, s.window]), [['PT', 123, '12m'], ['TH', 10, 'year']]);
  assert.equal(check.current, 'TH');
});

const autoCase = (autos, txs = []) => ({
  autos,
  accounts: [
    { id: 'hy', name: 'Savings USD', currency: 'USD', opening_balance: 100000, opening_date: '2026-10-01', apr_gross: 0.365, archived: false },
    { id: 'dep', name: 'Term deposit', currency: 'RUB', opening_balance: 1000000, opening_date: '2026-09-01', apr_gross: 0.12, interest_to: 'sav', archived: false },
    { id: 'sav', name: 'Savings account', currency: 'RUB', opening_balance: 0, opening_date: '2026-09-01', archived: false },
    { id: 'pb', name: 'Partner bank', currency: 'USD', opening_balance: 36500, opening_date: '2026-10-01', apr_gross: 0.2, tax_rate: 0.1, auto_tax: 'net', archived: false },
  ],
  categories: [{ id: 'exp_taxes', name: 'Taxes', kind: 'expense', parent_id: '', scope: 'liquid, business, investment', archived: false }],
  txs,
  today: '2026-10-28',
  now: '2026-10-28T06:00:00.000Z',
});
const daily = { id: 'a1', name: 'Savings interest', kind: 'interest', account_id: 'hy', frequency: 'daily', start_date: '2026-10-26', active: true, deleted: false };
const monthly = { id: 'a2', name: 'Term deposit', kind: 'interest', account_id: 'dep', frequency: 'monthly', day: 28, start_date: '2026-09-15', active: true, deleted: false };

test('automations: daily interest on the balance at the start of each day, compounding', () => {
  const { ctx } = makeEnv();
  const plan = JSON.parse(JSON.stringify(ctx.planAutomations_(autoCase([daily]))));
  assert.deepEqual(plan.txs.map(t => [t.id, t.date, t.account_id, t.amount, t.category_id, t.tags]), [
    ['auto_a1_2026-10-26', '2026-10-26', 'hy', 100, 'inc_interest', 'auto'],
    ['auto_a1_2026-10-27', '2026-10-27', 'hy', 100.1, 'inc_interest', 'auto'],
    ['auto_a1_2026-10-28', '2026-10-28', 'hy', 100.2, 'inc_interest', 'auto'],
  ]);
  assert.equal(plan.autos[0].last_run, '2026-10-28');
});

test('automations: monthly on its day for the days since the previous one, paid where the account pays interest', () => {
  const { ctx } = makeEnv();
  const plan = JSON.parse(JSON.stringify(ctx.planAutomations_(autoCase([monthly]))));
  // 1,000,000 ₽ × 12% × 31 / 365 (Aug 28 → Sep 28) and × 30 / 365 (Sep 28 → Oct 28), into the savings account.
  assert.deepEqual(plan.txs.map(t => [t.date, t.account_id, t.amount]), [['2026-09-28', 'sav', 10191.78], ['2026-10-28', 'sav', 9863.01]]);
});

test('automations: automatic tax goes with the accrual; nothing repeats, deleted or paused rules and accruals stay so', () => {
  const { ctx } = makeEnv();
  const pbRule = { id: 'a3', name: 'Partner bank interest', kind: 'interest', account_id: 'pb', frequency: 'daily', start_date: '2026-10-28', active: true };
  const tax = JSON.parse(JSON.stringify(ctx.planAutomations_(autoCase([pbRule])))).txs;
  assert.deepEqual(tax.map(t => [t.id, t.type, t.amount, t.category_id]), [['auto_a3_2026-10-28', 'income', 20, 'inc_interest'], ['auto_a3_2026-10-28-tax', 'expense', -2, 'exp_taxes']]);
  const done = [{ id: 'auto_a1_2026-10-27', date: '2026-10-27', type: 'income', account_id: 'hy', amount: 100.1, deleted: true }];
  const again = JSON.parse(JSON.stringify(ctx.planAutomations_(autoCase([daily, { ...monthly, active: false }], done)))).txs;
  assert.deepEqual(again.map(t => t.id), ['auto_a1_2026-10-26', 'auto_a1_2026-10-28']);
});

test('automations: interest paid into an account in another currency is converted, the original kept', () => {
  const { ctx } = makeEnv();
  const c = autoCase([{ id: 'x', name: 'EUR deposit', kind: 'interest', account_id: 'eur', frequency: 'monthly', day: 28, start_date: '2026-10-28', active: true }]);
  c.accounts.push({ id: 'eur', name: 'EUR deposit', currency: 'EUR', opening_balance: 36500, opening_date: '2026-09-01', apr_gross: 0.1, interest_to: 'hy', archived: false });
  const [t] = JSON.parse(JSON.stringify(ctx.planAutomations_({ ...c, rates: { USD: 1, EUR: 1.1 } }))).txs;
  // €36,500 × 10% × 30 / 365 = €300 → $330 on the dollar account.
  assert.deepEqual([t.account_id, t.amount, t.orig_amount, t.orig_currency], ['hy', 330, 300, 'EUR']);
  assert.equal(ctx.planAutomations_({ ...c, rates: { USD: 1 } }).txs.length, 0); // no rate: nothing rather than a wrong sum
});

test('automations: a fixed expense weekly, monthly on its day and yearly on the start day', () => {
  const { ctx } = makeEnv();
  const exp = (over) => ({ kind: 'expense', account_id: 'hy', category_id: 'exp_soft', amount: 12.99, active: true, ...over });
  const plan = JSON.parse(JSON.stringify(ctx.planAutomations_(autoCase([
    exp({ id: 'w', name: 'Gym', frequency: 'weekly', start_date: '2026-10-14' }),
    // Day 31 in September is the 30th (the deposit is in the app since September 1).
    exp({ id: 'm', name: 'Netflix', account_id: 'dep', frequency: 'monthly', day: 31, start_date: '2026-09-01' }),
    // A year ago is before the account's first day in the app: only this year's.
    exp({ id: 'y', name: 'Domain', frequency: 'yearly', start_date: '2025-10-28', amount: -20 }),
    exp({ id: 'none', name: 'No category', frequency: 'monthly', day: 1, start_date: '2026-10-01', category_id: '' }),
  ]))));
  assert.deepEqual(plan.txs.map(t => [t.id, t.type, t.account_id, t.amount, t.category_id, t.note]), [
    ['auto_w_2026-10-14', 'expense', 'hy', -12.99, 'exp_soft', 'Gym'],
    ['auto_w_2026-10-21', 'expense', 'hy', -12.99, 'exp_soft', 'Gym'],
    ['auto_w_2026-10-28', 'expense', 'hy', -12.99, 'exp_soft', 'Gym'],
    ['auto_m_2026-09-30', 'expense', 'dep', -12.99, 'exp_soft', 'Netflix'],
    ['auto_y_2026-10-28', 'expense', 'hy', -20, 'exp_soft', 'Domain'],
  ]);
});

test("automations run from the sheet: transactions written, the rule's last run moved on", () => {
  const { ctx, sheets } = makeEnv();
  sheets.Accounts.data.push(['acc_sav', 'Savings', 'liquid', 'flexible', 'USD', '', '', '', 36500, new Date(2026, 8, 1), 0.1]);
  sheets.Automations.data.push(['au1', 'Savings interest', 'interest', 'acc_sav', 'daily', '', '', new Date(2026, 9, 17), '', true, '', false, TS0, TS0, TS0]);
  const res = ctx.runAutomations_();
  assert.equal(res.created, 2); // Oct 17 and 18: $10 a day
  const rows = sheets.Transactions.data.slice(1).filter(r => String(r[0]).startsWith('auto_au1_'));
  assert.deepEqual(rows.map(r => [r[0], r[4]]), [['auto_au1_2026-10-17', 10], ['auto_au1_2026-10-18', 10]]);
  assert.equal(ctx.formatDate_(sheets.Automations.data[1][8]), '2026-10-18');
  assert.equal(ctx.runAutomations_().created, 0);
});

test('income by the month earned: the lagging accounts move back a month, the rest stays', () => {
  const { ctx } = makeEnv();
  const r = JSON.parse(JSON.stringify(ctx.computeIncomeShift_({
    settings: { history_start: '2026-05-01', income_lag_accounts: 'biz, biz2', income_lag_months: 1 },
    today: '2026-10-19',
    txs: [
      { id: 'a', date: '2026-06-06', type: 'income', account_id: 'biz', amount_usd: 3000 },
      { id: 'b', date: '2026-07-06', type: 'income', account_id: 'biz', amount_usd: 6400 },
      { id: 'c', date: '2026-07-10', type: 'income', account_id: 'card', amount_usd: 100 }, // not lagging
      { id: 'd', date: '2026-10-06', type: 'income', account_id: 'biz2', amount_usd: 6400 },
      { id: 'e', date: '2026-08-06', type: 'income', account_id: 'biz', amount_usd: 999, deleted: true },
    ],
  })));
  assert.deepEqual(r.earned, { '2026-05': 3000, '2026-06': 6400, '2026-07': 0, '2026-08': 0, '2026-09': 6400, '2026-10': 0 });
  assert.deepEqual(r.shift, { '2026-05': 3000, '2026-06': 3400, '2026-07': -6400, '2026-08': 0, '2026-09': 6400, '2026-10': -6400 });
});

test('a month close: results from Monthly, capital from the snapshot of the 1st, runway on liquid money', () => {
  const { ctx } = makeEnv();
  const row = JSON.parse(JSON.stringify(ctx.buildClose_({
    month: '2026-09', final: false, updated: '2026-10-03',
    monthly: { income: 6200, expenses: 4300, essential: 2900, savings: 1800, business: 0, investment: 12, taxes: 120 },
    shift: 4000, taxesPaid: 40, taxesOwed: 900, burn: 5000,
    snapshot: [
      { group: 'liquid', usd: 20000 }, { group: 'credit', usd: -1000 }, { group: 'investment', usd: 80000 },
      { group: 'business', usd: 3000 }, { group: 'debt', usd: 500 }, { group: 'debt', usd: -200 },
    ],
  })));
  assert.deepEqual(row, {
    month: '2026-09', status: 'open', updated: '2026-10-03', income_earned: 6200, income_received: 2200, expenses: 4300,
    essential: 2900, business_costs: 0, investment_costs: 12, taxes_accrued: 120, taxes_paid: 40, savings: 1800,
    savings_rate: 0.29, burn: 5000, net_worth: 102300, liquid: 19000, investments: 80000, business: 3000,
    owed_to_you: 500, you_owe: 200, taxes_owed: 900, runway_months: 3.8,
  });
});

test('the daily job closes last month until the freeze day: snapshot of the 1st and a Closes row', () => {
  const { ctx, sheets, tick, post } = makeEnv();
  const months = [new Date(2026, 8, 1), new Date(2026, 9, 1)];
  const r = (label, vals) => [label, '', '', '', '', ''].concat(vals);
  sheets.Monthly = new (sheets.Snapshots.constructor)('Monthly', [
    r('Line', months), r('Income', [7000, 6000]), r('Expenses', [5000, 4000]), r('Essential', [3000, 2500]),
    r('Savings', [2000, 1900]), r('Savings rate', ['', '']), r('Revaluation', ['', '']), r('Business', [0, 0]),
    r('Investment', [0, 0]), r('Taxes', [100, 100]), r('Essential part', [0, 0]),
  ]);
  post({ key: 'secret', action: 'sync', since: null, ops: [{ entity: 'transactions', record: tx({ id: 'oct', date: '2026-10-10', amount: -1000 }) }] });
  assert.equal(ctx.monthClose_(), ''); // Oct 18: past the freeze day
  tick(16 * 86400000); // Nov 3
  assert.equal(ctx.monthClose_(), '2026-10');
  const snap = sheets.Snapshots.data.slice(1).filter(x => ctx.formatDate_(x[0]) === '2026-11-01');
  assert.equal(snap.find(x => x[1] === 'acc_rub')[3], 99000);
  const closes = sheets.Closes.data;
  assert.deepEqual(closes[0].slice(0, 6), ['month', 'status', 'updated', 'income_earned', 'income_received', 'expenses']);
  assert.deepEqual(closes[1].slice(0, 6), ['2026-10', 'open', '2026-11-03', 6000, 6000, 4000]);
  ctx.monthClose_(); // the same day again: one snapshot, one row
  assert.equal(sheets.Snapshots.data.slice(1).filter(x => ctx.formatDate_(x[0]) === '2026-11-01' && x[1] === 'acc_rub').length, 1);
  assert.equal(sheets.Closes.data.filter(x => x[0] === '2026-10').length, 1);
});

test('the server fills in usd_rate and amount_usd when the client left them out', () => {
  const { post, sheets } = makeEnv();
  post({ key: 'secret', action: 'sync', since: null, ops: [{ entity: 'transactions', record: tx({ usd_rate: '', amount_usd: '' }) }] });
  const row = sheets.Transactions.data[1];
  assert.equal(row[11], 0.0125);
  assert.equal(row[12], -12.5);
});

test('tags are stored as text in their column and come back', () => {
  const { post, sheets } = makeEnv();
  const res = post({ key: 'secret', action: 'sync', since: null, ops: [{ entity: 'transactions', record: tx({ tags: 'groceries, bali' }) }] });
  assert.equal(sheets.Transactions.data[1][17], 'groceries, bali');
  assert.equal(res.changes.transactions[0].tags, 'groceries, bali');
});

test('text that looks like a formula is stored as text', () => {
  const { post, sheets } = makeEnv();
  post({ key: 'secret', action: 'sync', since: null, ops: [{ entity: 'transactions', record: tx({ note: '=IMPORTDATA("x")' }) }] });
  assert.equal(sheets.Transactions.data[1][10], '=IMPORTDATA("x")');
});

test('a new account and its transaction in one batch; the transaction gets the account rate', () => {
  const { post, sheets } = makeEnv();
  const account = { id: 'acc_new', name: 'Cash', group: 'liquid', type: 'cash', currency: 'RUB', opening_balance: 5000, opening_date: '2026-10-18', in_emergency_fund: false, archived: false, sort: 30, updated_at: '2026-10-18T11:00:00.000Z' };
  post({ key: 'secret', action: 'sync', since: null, ops: [
    { entity: 'accounts', record: account },
    { entity: 'transactions', record: tx({ id: 'tx2', account_id: 'acc_new', usd_rate: '', amount_usd: '' }) },
  ] });
  assert.equal(sheets.Accounts.getLastRow(), 4);
  assert.equal(sheets.Transactions.data[1][11], 0.0125);
});

test('an unknown entity and a record without id → bad_request', () => {
  const { post } = makeEnv();
  assert.equal(post({ key: 'secret', action: 'sync', ops: [{ entity: 'goals', record: { id: 'g' } }] }).error, 'bad_request');
  assert.equal(post({ key: 'secret', action: 'sync', ops: [{ entity: 'transactions', record: {} }] }).error, 'bad_request');
});

test('a snapshot sums transactions from the opening date to the date and takes the rate from RatesHistory', () => {
  const { post, ctx, sheets } = makeEnv();
  post({ key: 'secret', action: 'sync', since: null, ops: [
    { entity: 'transactions', record: tx({ id: 'a', date: '2026-09-15', amount: -10000 }) },
    { entity: 'transactions', record: tx({ id: 'b', date: '2026-10-05', amount: -500 }) },
    { entity: 'transactions', record: tx({ id: 'c', date: '2026-09-20', type: 'transfer', account_id: 'acc_rub', amount: -8000, to_account_id: 'acc_usd', to_amount: 100, category_id: '' }) },
    // Imported history from before the opening date: already part of the opening balance.
    { entity: 'transactions', record: tx({ id: 'old', date: '2024-03-01', amount: -777 }) },
  ] });
  const txs = ctx.readRecords_('transactions');
  ctx.createSnapshot_('2026-10-01', txs, 'auto');
  const rows = sheets.Snapshots.data.slice(1);
  const rub = rows.find(r => r[1] === 'acc_rub');
  const usd = rows.find(r => r[1] === 'acc_usd');
  assert.equal(rub[3], 100000 - 10000 - 8000);
  assert.equal(rub[4], 0.012);
  assert.equal(usd[3], 1100);
});

test('onEditStamp: a manual edit gets updated_at/server_ts, an empty id is generated', () => {
  const { ctx, sheets } = makeEnv();
  const row = accHeaders.map(() => '');
  row[1] = 'New card'; row[4] = 'USD';
  sheets.Accounts.data.push(row);
  ctx.onEditStamp({ range: { getSheet: () => sheets.Accounts, getRow: () => 4, getNumRows: () => 1 } });
  const r = sheets.Accounts.data[3];
  assert.match(r[0], /^acc_[0-9a-f]{8}$/);
  assert.ok(r[26] > TS0);
  assert.equal(r[26], r[27]);
});

test('selfTest_ runs a sync with the real key and writes nothing', () => {
  const { ctx, sheets } = makeEnv();
  assert.equal(ctx.selfTest_(), 'ok: accounts 2, categories 1, transactions 0, rates 3');
  assert.equal(sheets.Transactions.getLastRow(), 1);
});

test('admin is off until turned on from the menu', () => {
  const { post, props } = makeEnv();
  delete props.ADMIN_ENABLED;
  assert.equal(post({ key: 'secret', action: 'admin', op: 'sheets' }).error, 'forbidden');
  assert.equal(post({ key: 'secret', action: 'sync', since: null, ops: [] }).ok, true);
});

test('admin without a key → unauthorized, unknown op → bad_request', () => {
  const { post } = makeEnv();
  assert.equal(post({ key: 'wrong', action: 'admin', op: 'sheets' }).error, 'unauthorized');
  assert.equal(post({ key: 'secret', action: 'admin', op: 'drop' }).error, 'bad_request');
});

test('admin sheets lists sheets with their sizes', () => {
  const { post } = makeEnv();
  const res = post({ key: 'secret', action: 'admin', op: 'sheets' });
  assert.deepEqual(res.sheets.find(s => s.name === 'Rates'), {
    name: 'Rates', lastRow: 4, lastColumn: 5, maxRows: 50, maxColumns: 26, frozenRows: 1, hidden: false, charts: 0,
  });
});

test('admin write writes from the range corner, read returns values and formulas', () => {
  const { post, sheets } = makeEnv();
  const w = post({ key: 'secret', action: 'admin', op: 'write', range: 'Settings!A5', values: [['swr', 0.04], ['fi', '=1/B5']] });
  assert.equal(w.range, 'Settings!A5:B6');
  assert.equal(sheets.Settings.data[5][1], '=1/B5');
  const r = post({ key: 'secret', action: 'admin', op: 'read', sheet: 'Settings', range: 'A5:B6', raw: true });
  assert.deepEqual(r.values, [['swr', 0.04], ['fi', '=1/B5']]);
  assert.deepEqual(r.formulas, { B6: '=1/B5' });
  assert.equal(post({ key: 'secret', action: 'admin', op: 'write', range: 'Settings!A5', values: [['a'], ['b', 1]] }).error, 'bad_request');
});

test('admin exec: result and logs; a code error comes back as exec_error with logs', () => {
  const { post } = makeEnv();
  const ok = post({ key: 'secret', action: 'admin', op: 'exec', code: 'log("n", 2); return readRates_().RUB;' });
  assert.deepEqual([ok.ok, ok.result, ok.logs], [true, 0.0125, ['n 2']]);
  const bad = post({ key: 'secret', action: 'admin', op: 'exec', code: 'log("before"); throw new Error("boom");' });
  assert.deepEqual([bad.ok, bad.error, bad.message, bad.logs], [false, 'exec_error', 'boom', ['before']]);
});
