// Mock server core: the exact sync protocol, data kept in memory.
// Used by the HTTP server (dev/mock-server.mjs) and the sync tests.

export const ENTITIES = ['accounts', 'categories', 'transactions', 'automations', 'tax_marks', 'locations'];

export const DEFAULT_RATES = {
  USD: 1,
  EUR: 1.084,
  GBP: 1.27,
  USDT: 1,
  XAU: 4166,
};

function ms(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * @param {{ seed?: boolean, key?: string, now?: () => number, state?: any }} [opts]
 */
export function createMockStore(opts = {}) {
  const key = opts.key ?? 'dev';
  const now = opts.now ?? (() => Date.now());
  const db = { accounts: new Map(), categories: new Map(), transactions: new Map(), automations: new Map(), tax_marks: new Map(), locations: new Map() };
  const rates = { ...DEFAULT_RATES };
  const settings = { base_currency: 'USD', second_currency: 'EUR', tax_residency: 'NONE', tax_residency_set: '' };
  let lastTs = 0;

  /** Strictly increasing timestamp: every record gets a unique server_ts. */
  function stamp() {
    let t = now();
    if (t <= lastTs) t = lastTs + 1;
    lastTs = t;
    return new Date(t).toISOString();
  }

  /** Response serverTs: never less than any server_ts handed out. */
  function currentTs() {
    lastTs = Math.max(lastTs, now());
    return new Date(lastTs).toISOString();
  }

  function put(entity, record) {
    const rec = { ...record, server_ts: stamp() };
    db[entity].set(String(rec.id), rec);
    return rec;
  }

  if (opts.state) {
    for (const e of ENTITIES) for (const r of opts.state[e] ?? []) db[e].set(String(r.id), r);
    lastTs = Math.max(0, ...ENTITIES.flatMap((e) => [...db[e].values()].map((r) => ms(r.server_ts))));
  } else if (opts.seed !== false) {
    for (const [entity, list] of Object.entries(seedData(new Date(now())))) for (const r of list) put(entity, r);
  }

  function handle(req) {
    if (!req || typeof req !== 'object') return { ok: false, error: 'bad_request', message: 'Request body is not a JSON object' };
    if (req.key !== key) return { ok: false, error: 'unauthorized', message: 'Invalid key' };
    if (req.action === 'ping') return { ok: true, serverTs: currentTs() };
    // The demo has no geocoder: a check-in lands in the country sent, or in Portugal.
    if (req.action === 'checkin') {
      const date = typeof req.date === 'string' ? req.date : ymd(new Date(now()));
      const country = /^[A-Za-z]{2}$/.test(String(req.country ?? '')) ? String(req.country).toUpperCase() : 'PT';
      const id = `loc_${date}`;
      const prev = db.locations.get(id);
      const list = String(prev && !prev.deleted ? prev.countries : '').split(' ').filter((c) => c && c !== country);
      const at = new Date(now()).toISOString();
      const day = put('locations', { id, date, countries: [...list, country].join(' '), city: '', source: req.source ?? 'shortcut', note: '', deleted: false, created_at: prev?.created_at ?? at, updated_at: at });
      return { ok: true, country, city: '', day, notify: '' };
    }
    if (req.action === 'set_setting') {
      if (req.setting !== 'tax_residency') return { ok: false, error: 'bad_request', message: `Not settable: ${req.setting}` };
      settings.tax_residency = String(req.value ?? '').toUpperCase();
      settings.tax_residency_set = `manual ${ymd(new Date(now()))}`;
      return { ok: true, settings: { ...settings } };
    }
    if (req.action !== 'sync') return { ok: false, error: 'bad_request', message: `Unknown action: ${req.action}` };
    if (req.since != null && typeof req.since !== 'string') {
      return { ok: false, error: 'bad_request', message: 'since must be a string or null' };
    }
    const ops = req.ops ?? [];
    if (!Array.isArray(ops)) return { ok: false, error: 'bad_request', message: 'ops must be an array' };
    for (const op of ops) {
      if (!op || !ENTITIES.includes(op.entity) || !op.record || !op.record.id) {
        return { ok: false, error: 'bad_request', message: 'op: entity and record.id are required' };
      }
    }
    let applied = 0;
    for (const op of ops) {
      const existing = db[op.entity].get(String(op.record.id));
      // last-write-wins by updated_at: an older edit doesn't overwrite a newer one
      if (existing && ms(existing.updated_at) > ms(op.record.updated_at)) continue;
      put(op.entity, op.record);
      applied++;
    }
    const since = req.since == null ? null : ms(req.since);
    const changes = {};
    for (const e of ENTITIES) {
      changes[e] = [...db[e].values()].filter((r) => since == null || ms(r.server_ts) > since);
    }
    const out = { ok: true, serverTs: currentTs(), applied, changes, rates: { ...rates }, settings: { ...settings }, metrics: { ...METRICS }, history: seedHistory(), allocation: { ...ALLOCATION, fx: fxWindows(rates, new Date(now())) }, taxes: taxSummary(new Date(now())), taxRatesHash: TAX_RATES_HASH };
    if (req.taxRatesHash !== TAX_RATES_HASH) out.taxRates = TAX_RATES;
    return out;
  }

  /** An edit "from the sheet": as if the record was changed on another device. */
  function serverEdit(entity, record) {
    return put(entity, { ...record, updated_at: new Date(now()).toISOString() });
  }

  function dump() {
    const out = { rates, settings };
    for (const e of ENTITIES) out[e] = [...db[e].values()];
    return out;
  }

  return { handle, serverEdit, dump, db, rates, settings, key };
}

// ── Seed ────────────────────────────────────────────────────

function pad(n) {
  return String(n).padStart(2, '0');
}

function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function account(p) {
  return {
    institution: '',
    country: '',
    kyc_country: '',
    opening_balance: 0,
    opening_date: '2026-01-01',
    apr_gross: '',
    tax_rate: '',
    maturity_date: '',
    insured_limit: '',
    risk_price: '',
    risk_country: '',
    risk_legal: '',
    risk_custody: '',
    risk_credit: '',
    risk_currency: '',
    risk_liquidity: '',
    in_emergency_fund: false,
    archived: false,
    visibility: '',
    color: '',
    note: '',
    ...p,
  };
}

function category(id, name, kind, icon, color, sort, extra = {}) {
  return { id, name, kind, parent_id: '', budget_usd: '', essential: false, icon, color, archived: false, scope: '', sort, ...extra };
}

/** Burn rate and friends, as the real sheet returns them from its named ranges. */
const METRICS = { burn: 2450, essential: 1800, passive: 210, work_income: 3500, savings: 1050 };

/** Six months of monthly P&L before the current month, like the History sheet. */
export function seedHistory(today = new Date()) {
  const rows = [];
  const spend = { exp_food: 520, exp_housing: 1100, exp_transport: 160, exp_health: 140, exp_travel: 300, exp_other: 230 };
  for (let back = 6; back >= 1; back--) {
    const d = new Date(today.getFullYear(), today.getMonth() - back, 1);
    const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const k = 0.8 + ((back * 37) % 9) / 20;
    rows.push({ month, category_id: 'inc_work', amount_usd: 3500 });
    rows.push({ month, category_id: 'inc_interest', amount_usd: Math.round(180 * k) });
    for (const [id, v] of Object.entries(spend)) rows.push({ month, category_id: id, amount_usd: -Math.round(v * k) });
  }
  return rows;
}

// How each currency moved against USD, as RatesHistory would show it: since Jan 1 and over 12 months.
const FX_MOVES = {
  EUR: [0.031, 0.044],
  GBP: [0.012, 0.027],
  XAU: [0.1, 0.25],
};

/** The server's fx windows (Fx.js readFxWindows_) from the current rates and FX_MOVES. */
function fxWindows(rates, date) {
  const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = day(date);
  const out = { ytd: { start: `${today.slice(0, 4)}-01-01`, rates: {} }, y1: { start: `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`, rates: {} }, now: {} };
  for (const [cur, usd] of Object.entries(rates)) {
    const [ytd, y1] = FX_MOVES[cur] ?? [0, 0];
    out.now[cur] = { date: today, usd };
    out.ytd.rates[cur] = { date: out.ytd.start, usd: usd / (1 + ytd) };
    out.y1.rates[cur] = { date: out.y1.start, usd: usd / (1 + y1) };
  }
  return out;
}

/** The server's tax summary (Taxes.js): a business tax by quarter, $240 owed now. */
function taxSummary(date) {
  const accrued = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(date.getFullYear(), date.getMonth() - i, 1);
    accrued[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = 80;
  }
  const q = Math.floor(date.getMonth() / 3) + 1;
  return {
    owedUsd: 240,
    rules: [
      { id: 'business', label: 'Business · 3% of income', owedUsd: 240, owed: { amount: 221.4, currency: 'EUR' },
        periods: [{ key: `${date.getFullYear()}-Q${q}`, accrued: 221.4, marked: 0, owed: 221.4, owedUsd: 240 }] },
    ],
    marks: [],
    accrued,
    at: date.toISOString(),
  };
}

/** A few sample TaxRates rows for the demo (headline figures; check them before relying on them). */
const TAX_RATES = [
  { country: 'PT', domestic_income: '12.5–48% progressive', foreign_income: 'Worldwide, same rates', capital_gains: '28% flat', residency_rule: 'More than 183 days in any 12 months, or a home', threshold_days: 184, window: '12m', foreign_rate: 0.3, residency_tests: 'More than 183 days in any 12-month period\nA home kept as your habitual residence', note: 'Sample row for the demo', as_of: '2026', source: '', confidence: 'medium' },
  { country: 'ES', domestic_income: '19–47% progressive', foreign_income: 'Worldwide, same rates', capital_gains: '19–30% savings scale', residency_rule: 'More than 183 days in the calendar year', threshold_days: 184, window: 'year', foreign_rate: 0.28, residency_tests: 'More than 183 days in the calendar year\nMain base of economic interests in Spain', note: 'Sample row for the demo', as_of: '2026', source: '', confidence: 'medium' },
  { country: 'GE', domestic_income: '20% flat', foreign_income: 'Exempt (territorial)', capital_gains: '20% on local gains', residency_rule: '183 days in any 12 months', threshold_days: 183, window: '12m', foreign_rate: 0, residency_tests: '183 days in any continuous 12 months', note: 'Sample row for the demo', as_of: '2026', source: '', confidence: 'medium' },
  { country: 'TH', domestic_income: '0–35% progressive', foreign_income: 'Only if brought into the country', capital_gains: 'As income', residency_rule: '180 days in a calendar year', threshold_days: 180, window: 'year', foreign_rate: 0.2, residency_tests: '180 days or more in a calendar year', note: 'Sample row for the demo', as_of: '2026', source: '', confidence: 'medium' },
];
const TAX_RATES_HASH = 'demo-1';

// Capital allocation inputs, as the Rates and Risk sheets give them (trends: for app versions before fx).
const ALLOCATION = {
  trends: { USD: 0, EUR: 0, GBP: 0, XAU: 0 },
  targets: [
    { class: 'Bonds & deposits', target: 0.3 },
    { class: 'Commodities', target: 0.2 },
    { class: 'Stocks', target: 0.4 },
    { class: 'Crypto', target: 0.1 },
  ],
  limits: [
    { dimension: 'country', value: '*', limit: 0.4 },
    { dimension: 'institution', value: '*', limit: 0.3 },
    { dimension: 'currency', value: '*', limit: 0.35 },
    { dimension: 'asset_class', value: 'Crypto', limit: 0.1 },
    { dimension: 'high_risk', value: '*', limit: 0.2 },
    { dimension: 'country', value: 'US', limit: 0.5 },
  ],
};

// A made-up person for the demo: net worth $32,670 on Home (Liquid $10,952, Investments $18,119, Business $3,599
// after the $240 business tax), spread over a salary card, savings, cash, a credit card, a broker, a bond ETF, a euro
// deposit, gold, USDT and a business account.
export function seedData(today = new Date()) {
  const at = new Date(today).toISOString();
  const accounts = [
    account({ id: 'acc_card', name: 'Everyday Card', group: 'liquid', type: 'card', currency: 'USD', institution: 'City Bank', country: 'US', opening_balance: 2169, sort: 1, color: '#0A84FF', risk_credit: 2, risk_liquidity: 1 }),
    account({ id: 'acc_savings', name: 'Savings', group: 'liquid', type: 'flexible', currency: 'USD', institution: 'City Bank', country: 'US', opening_balance: 6000, apr_gross: 0.042, tax_rate: 0.1, in_emergency_fund: true, sort: 2, color: '#30D158' }),
    account({ id: 'acc_cash_eur', name: 'Cash €', group: 'liquid', type: 'cash', currency: 'EUR', opening_balance: 374, sort: 3, color: '#64D2FF', risk_custody: 4 }),
    // Zero balance: hidden until "Show hidden".
    account({ id: 'acc_travel', name: 'Travel Card', group: 'liquid', type: 'card', currency: 'EUR', institution: 'Online Bank', opening_balance: 0, sort: 4, color: '#BF5AF2' }),
    account({ id: 'acc_credit', name: 'Credit Card', group: 'credit', type: 'credit', currency: 'USD', institution: 'City Bank', opening_balance: -460, sort: 20, color: '#8E8E93' }),
    account({ id: 'acc_broker', name: 'Brokerage', group: 'investment', type: 'stocks', currency: 'USD', institution: 'Broker Co', country: 'US', opening_balance: 7500, sort: 10, color: '#FF453A', risk_price: 5, risk_custody: 2 }),
    account({ id: 'acc_bonds', name: 'Bond ETF', group: 'investment', type: 'bonds', currency: 'USD', institution: 'Broker Co', country: 'US', opening_balance: 3000, apr_gross: 0.039, sort: 11, color: '#5E5CE6', risk_price: 2, risk_custody: 2 }),
    account({ id: 'acc_deposit', name: 'Euro Deposit', group: 'investment', type: 'deposit', currency: 'EUR', institution: 'Euro Bank', country: 'DE', opening_balance: 4000, apr_gross: 0.032, tax_rate: 0.25, maturity_date: '2027-06-30', interest_to: 'acc_card', sort: 12, color: '#FFD60A' }),
    account({ id: 'acc_gold', name: 'Gold', group: 'investment', type: 'commodity', currency: 'XAU', opening_balance: 0.5, sort: 13, color: '#FF9F0A', risk_price: 4 }),
    account({ id: 'acc_usdt', name: 'USDT Wallet', group: 'investment', type: 'crypto', currency: 'USDT', opening_balance: 1200, sort: 14, color: '#26A17B', risk_custody: 6, risk_legal: 4 }),
    account({ id: 'acc_business', name: 'Business Account', group: 'business', type: 'business', currency: 'USD', institution: 'City Bank', country: 'US', opening_balance: 1488, sort: 30, color: '#FF375F' }),
  ].map((a) => ({ ...a, updated_at: at }));

  const categories = [
    category('exp_food', 'Food', 'expense', '🍔', '#FF9F0A', 1, { budget_usd: 600, essential: true }),
    category('exp_housing', 'Housing', 'expense', '🏠', '#0A84FF', 2, { budget_usd: 1200, essential: true }),
    category('exp_transport', 'Transport', 'expense', '🚕', '#FFD60A', 3, { budget_usd: 200, essential: true }),
    category('exp_health', 'Sport & Health', 'expense', '💊', '#FF375F', 4, { budget_usd: 150, essential: true }),
    category('exp_travel', 'Travel', 'expense', '✈️', '#64D2FF', 5, { budget_usd: 500 }),
    category('exp_other', 'Other', 'expense', '📦', '#8E8E93', 6, { budget_usd: 300 }),
    category('exp_taxes', 'Taxes', 'expense', '🧾', '#AC8E68', 12, { essential: true, scope: 'liquid, business, investment' }),
    category('exp_software', 'Software', 'expense', '💻', '#5E5CE6', 8, { scope: 'business' }),
    category('exp_ads', 'Ads', 'expense', '📣', '#FF9F0A', 9, { scope: 'business' }),
    category('exp_accounting', 'Accounting', 'expense', '🧮', '#8E8E93', 10, { scope: 'business' }),
    category('exp_fees', 'Fees', 'expense', '💸', '#AC8E68', 11, { scope: 'investment' }),
    category('inc_work', 'Work', 'income', '💼', '#30D158', 1),
    category('inc_interest', 'Interest', 'income', '🏦', '#32D74B', 2),
    category('inc_dividends', 'Dividends', 'income', '📈', '#66D4CF', 3),
    category('inc_other', 'Other income', 'income', '💰', '#A2845E', 4),
    category('sys_revaluation', 'Revaluation', 'system', '⚖️', '#8E8E93', 1),
    category('sys_correction', 'Correction', 'system', '🔧', '#8E8E93', 2),
  ].map((c) => ({ ...c, updated_at: at }));

  // Seed transactions stay in this month (the board shows the month); back(n) is a plain n days ago.
  const d = (offset) => {
    const x = new Date(today);
    x.setDate(Math.max(1, x.getDate() - offset));
    return ymd(x);
  };
  const back = (n) => {
    const x = new Date(today);
    x.setDate(x.getDate() - n);
    return ymd(x);
  };
  const tx = (id, p) => ({
    id,
    to_account_id: '',
    to_amount: '',
    category_id: '',
    orig_amount: '',
    orig_currency: '',
    note: '',
    deleted: false,
    created_at: at,
    updated_at: at,
    ...p,
  });
  const r = DEFAULT_RATES;
  const transactions = [
    tx('seed-0001', { date: d(9), type: 'income', account_id: 'acc_card', amount: 4200, category_id: 'inc_work', note: 'Salary', usd_rate: 1, amount_usd: 4200 }),
    tx('seed-0002', { date: d(8), type: 'expense', account_id: 'acc_card', amount: -1250, category_id: 'exp_housing', note: 'Rent', usd_rate: 1, amount_usd: -1250 }),
    tx('seed-0003', { date: d(6), type: 'expense', account_id: 'acc_card', amount: -86.4, category_id: 'exp_food', note: 'Groceries', tags: 'groceries', usd_rate: 1, amount_usd: -86.4 }),
    tx('seed-0004', { date: d(4), type: 'expense', account_id: 'acc_cash_eur', amount: -24, category_id: 'exp_transport', note: 'Taxi', tags: 'trip', usd_rate: r.EUR, amount_usd: -26.02 }),
    tx('seed-0005', { date: d(3), type: 'transfer', account_id: 'acc_card', amount: -500, to_account_id: 'acc_savings', to_amount: 500, usd_rate: 1, amount_usd: -500 }),
    tx('seed-0006', { date: d(2), type: 'income', account_id: 'acc_business', amount: 2400, category_id: 'inc_work', note: 'Client invoice', usd_rate: 1, amount_usd: 2400 }),
    tx('seed-0007', { date: d(1), type: 'expense', account_id: 'acc_business', amount: -49, category_id: 'exp_software', note: 'Design tool', usd_rate: 1, amount_usd: -49 }),
  ];

  // Made-up automations: interest on the savings and the deposit, rent, a subscription, a yearly business bill.
  const auto = (id, p) => ({ id, day: '', category_id: '', amount: '', last_run: '', active: true, note: '', deleted: false, created_at: at, updated_at: at, ...p });
  const automations = [
    auto('auto_savings', { name: 'Interest · Savings', kind: 'interest', account_id: 'acc_savings', frequency: 'daily', start_date: back(30) }),
    auto('auto_deposit', { name: 'Interest · Euro Deposit', kind: 'interest', account_id: 'acc_deposit', frequency: 'monthly', day: 15, start_date: back(30) }),
    auto('auto_rent', { name: 'Rent', kind: 'expense', account_id: 'acc_card', frequency: 'monthly', day: 1, category_id: 'exp_housing', amount: 1250, start_date: back(30) }),
    auto('auto_stream', { name: 'Streaming', kind: 'expense', account_id: 'acc_card', frequency: 'monthly', day: 12, category_id: 'exp_other', amount: 15.99, start_date: back(30) }),
    auto('auto_hosting', { name: 'Domain & hosting', kind: 'expense', account_id: 'acc_business', frequency: 'yearly', category_id: 'exp_software', amount: 120, start_date: back(30) }),
  ];

  // Made-up travel for Tax residency: a nomad between Thailand, Portugal, Spain and Georgia, under every day rule.
  const day = (n, countries) => ({ id: `loc_${back(n)}`, date: back(n), countries, city: '', source: 'manual', note: '', deleted: false, created_at: at, updated_at: at });
  const locations = [day(400, 'TH'), day(330, 'TH PT'), day(230, 'PT ES'), day(170, 'ES GE'), day(110, 'GE TH'), day(40, 'TH PT')];

  return { accounts, categories, transactions, automations, locations };
}
