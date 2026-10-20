// First-time setup of an empty spreadsheet: every sheet the app and the scripts read, with its header row and
// starter values (Settings, Rates, a basic set of categories). setup() (Menu.js) runs it; it only adds what is
// missing, so running it again on a working spreadsheet changes nothing.
// Columns are found by their header (Config.js FIELD_TYPES), so more columns can be added later.

const SETUP_HEADERS_ = {
  Accounts: ['id', 'name', 'group', 'type', 'currency', 'institution', 'country', 'kyc_country', 'opening_balance', 'opening_date',
    'apr_gross', 'tax_rate', 'maturity_date', 'insured_limit', 'risk_price', 'risk_country', 'risk_legal', 'risk_custody',
    'risk_credit', 'risk_currency', 'risk_liquidity', 'in_emergency_fund', 'archived', 'sort', 'color', 'note', 'updated_at',
    'server_ts', 'visibility', 'interest_to', 'auto_tax'],
  Categories: ['id', 'name', 'kind', 'parent_id', 'budget_usd', 'essential', 'icon', 'color', 'archived', 'sort', 'updated_at',
    'server_ts', 'scope'],
  Transactions: ['id', 'date', 'type', 'account_id', 'amount', 'to_account_id', 'to_amount', 'category_id', 'orig_amount',
    'orig_currency', 'note', 'usd_rate', 'amount_usd', 'created_at', 'updated_at', 'deleted', 'server_ts', 'tags'],
  Automations: ['id', 'name', 'kind', 'account_id', 'frequency', 'day', 'category_id', 'start_date', 'last_run', 'active', 'note',
    'deleted', 'created_at', 'updated_at', 'server_ts', 'amount'],
  TaxMarks: ['id', 'rule', 'period', 'action', 'amount', 'currency', 'date', 'note', 'deleted', 'created_at', 'updated_at', 'server_ts'],
  Locations: ['id', 'date', 'countries', 'city', 'source', 'note', 'deleted', 'created_at', 'updated_at', 'server_ts'],
  TaxRates: ['country', 'domestic_income', 'foreign_income', 'capital_gains', 'residency_rule', 'residency_tests', 'threshold_days',
    'window', 'foreign_rate', 'note', 'as_of', 'source', 'confidence'],
  Rates: ['currency', 'pair', 'usd_per_unit', 'units_per_usd', 'exp_change_yoy'],
  Settings: ['key', 'value', 'note'],
  Snapshots: ['date', 'account_id', 'account_name', 'balance', 'usd_per_unit', 'balance_usd', 'source'],
  History: ['month', 'category_id', 'amount_usd', 'note'],
  RatesHistory: ['date', 'currency', 'usd_per_unit'],
};

/** Rates: USD per unit. Quoted currencies take a GOOGLEFINANCE formula (the daily job also reads them); gold comes
 *  from RatesHistory, where the daily job writes its price; USDT is pegged at 1. Add a row for every currency you use. */
function setupRates_() {
  const quoted = cur => [cur, 'CURRENCY:' + cur + 'USD', '=GOOGLEFINANCE("CURRENCY:' + cur + 'USD")', '', 0];
  const rows = [
    ['USD', 'USD:USD', 1, '', 0],
    quoted('EUR'),
    quoted('GBP'),
    ['USDT', 'pegged', 1, '', 0],
    ['XAU', 'gold, USD per troy ounce', '=IFERROR(XLOOKUP("XAU",RatesHistory!B:B,RatesHistory!C:C,"",0,-1),"")', '', 0],
  ];
  return rows.map((r, i) => { r[3] = '=IF(N(C' + (i + 2) + ')=0,"",1/C' + (i + 2) + ')'; return r; });
}

function setupSettings_() {
  const year = Utilities.formatDate(new Date(), tz_(), 'yyyy');
  return [
    ['base_currency', 'USD', 'Every total is in USD; the app can show it in another currency'],
    ['second_currency', 'EUR', 'Shown next to USD in the app Settings'],
    ['history_start', year + '-01-01', 'First month of the generated Taxes and Income sheets'],
    ['burn_window_months', 6, 'Burn rate = average personal spending over this many whole months'],
    ['close_freeze_day', 7, "Last month's Closes row and snapshot are redone daily until this day"],
    ['high_risk_threshold', 3.5, 'Capital allocation: accounts with an average risk (1–7) above this count as high risk'],
    ['webapp_url', '', 'The web app /exec URL, shown by the menu "App connection"'],
    ['tax_residency', '', 'Set from the app: a two-letter country code, NONE for nowhere, empty = not set'],
    ['tax_accrual_start', year + '-01-01', 'Taxes accrue from this day; before it a month shows what was paid'],
    ['tax_interest_country', '', "Interest tax: the country (as the accounts' country column is typed, e.g. DE); empty = off"],
    ['tax_interest_rate', '', 'Interest tax rate, e.g. 0.15'],
    ['tax_interest_currency', '', 'Currency of the allowance and of what is owed, e.g. EUR'],
    ['tax_interest_allowance_' + year, '', 'Tax-free interest a year, in that currency; add a row per year'],
    ['tax_business_rate', '', 'Business tax: share of income on business accounts, e.g. 0.03; empty = off'],
    ['tax_business_fixed', '', 'Business tax: a fixed sum every month (optional)'],
    ['tax_business_fixed_currency', '', 'Currency of the fixed sum, e.g. EUR'],
    ['tax_business_since', '', 'Business tax starts on this day (optional)'],
    ['income_lag_accounts', '', 'Account ids (comma-separated) paid a month late: income counts in the month earned'],
    ['income_lag_months', '', 'How many months late, 1 by default'],
  ];
}

/** A basic set of categories; rename, add or archive them in the app. The ids starting with sys_ and inc_interest
 *  are used by the code (reconciliations and interest), keep them. */
function setupCategories_() {
  const now = new Date().toISOString();
  const c = (id, name, kind, icon, color, sort, extra) => Object.assign({
    id, name, kind, parent_id: '', budget_usd: '', essential: false, icon, color, archived: false, sort, scope: '',
    updated_at: now, server_ts: now,
  }, extra || {});
  const list = [
    c('exp_food', 'Food', 'expense', '🍔', '#FF9F0A', 1, { essential: true }),
    c('exp_housing', 'Housing', 'expense', '🏠', '#0A84FF', 2, { essential: true }),
    c('exp_transport', 'Transport', 'expense', '🚕', '#FFD60A', 3, { essential: true }),
    c('exp_health', 'Health', 'expense', '💊', '#FF375F', 4, { essential: true }),
    c('exp_shopping', 'Shopping', 'expense', '🛍️', '#BF5AF2', 5),
    c('exp_fun', 'Leisure', 'expense', '🎬', '#64D2FF', 6),
    c('exp_travel', 'Travel', 'expense', '✈️', '#5AC8FA', 7),
    c('exp_other', 'Other', 'expense', '📦', '#8E8E93', 8),
    c('exp_taxes', 'Taxes', 'expense', '🧾', '#AC8E68', 20, { essential: true, scope: 'liquid, business, investment' }),
    c('exp_software', 'Software', 'expense', '💻', '#5E5CE6', 30, { scope: 'business' }),
    c('exp_fees', 'Fees', 'expense', '💸', '#AC8E68', 40, { scope: 'investment' }),
    c('inc_work', 'Work', 'income', '💼', '#30D158', 1),
    c('inc_interest', 'Interest', 'income', '🏦', '#32D74B', 2),
    c('inc_dividends', 'Dividends', 'income', '📈', '#66D4CF', 3),
    c('inc_other', 'Other income', 'income', '💰', '#A2845E', 4),
    c('sys_revaluation', 'Revaluation', 'system', '⚖️', '#8E8E93', 1),
    c('sys_correction', 'Correction', 'system', '🔧', '#8E8E93', 2),
  ];
  return list.map(cat => SETUP_HEADERS_.Categories.map(h => (cat[h] === undefined ? '' : cat[h])));
}

const SETUP_ROWS_ = { Rates: setupRates_, Settings: setupSettings_, Categories: setupCategories_ };

/** Adds the sheets that are missing (with headers and starter rows). Returns the names it added. */
function ensureSheets_() {
  const ss = SpreadsheetApp.getActive();
  const added = [];
  Object.keys(SETUP_HEADERS_).forEach(name => {
    if (ss.getSheetByName(name)) return;
    const sh = ss.insertSheet(name);
    const head = SETUP_HEADERS_[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    const rows = SETUP_ROWS_[name] ? SETUP_ROWS_[name]() : [];
    if (rows.length) sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    added.push(name);
  });
  // A new spreadsheet comes with one empty sheet ("Sheet1", in the account's language): drop it once ours exist.
  if (added.length && typeof ss.deleteSheet === 'function') {
    ss.getSheets()
      .filter(sh => !SETUP_HEADERS_[sh.getName()] && sh.getLastRow() === 0 && /^\D+\s?1$/.test(sh.getName()))
      .forEach(sh => ss.deleteSheet(sh));
  }
  SpreadsheetApp.flush();
  return added;
}
