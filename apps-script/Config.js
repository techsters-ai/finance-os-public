// Schema of the synced sheets. Columns are found by first-row headers,
// so the column order in the spreadsheet can change.

const SHEETS = {
  accounts: 'Accounts',
  categories: 'Categories',
  transactions: 'Transactions',
  automations: 'Automations',
  tax_marks: 'TaxMarks',
  locations: 'Locations',
};

const FIELD_TYPES = {
  accounts: {
    date: ['opening_date', 'maturity_date'],
    bool: ['in_emergency_fund', 'archived'],
    num: [
      'opening_balance', 'apr_gross', 'tax_rate', 'insured_limit',
      'risk_price', 'risk_country', 'risk_legal', 'risk_custody',
      'risk_credit', 'risk_currency', 'risk_liquidity', 'sort',
    ],
  },
  categories: {
    date: [],
    bool: ['essential', 'archived'],
    num: ['budget_usd', 'sort'],
  },
  transactions: {
    date: ['date'],
    bool: ['deleted'],
    num: ['amount', 'to_amount', 'orig_amount', 'usd_rate', 'amount_usd'],
  },
  automations: {
    date: ['start_date', 'last_run'],
    bool: ['active', 'deleted'],
    num: ['day', 'amount'],
  },
  tax_marks: {
    date: ['date'],
    bool: ['deleted'],
    num: ['amount'],
  },
  locations: {
    date: ['date'],
    bool: ['deleted'],
    num: [],
  },
};

const MAX_OPS_PER_REQUEST = 500;
const MAX_TEXT_LENGTH = 1000;
// Re-send records from the 2 minutes before `since` so edits stamped by the onEdit trigger
// during a sync aren't lost. The client handles duplicates idempotently.
const SINCE_OVERLAP_MS = 2 * 60 * 1000;

// Cached for the request: a sync formats thousands of dates and each lookup is a service call.
let tzCache_ = null;
function tz_() {
  if (!tzCache_) tzCache_ = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  return tzCache_;
}
