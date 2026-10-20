// Data model: snake_case fields match the sheet column headers.

export type NumOrEmpty = number | '';
export type Risk = number | '';

/** debt: one account per person; positive balance = they owe you, negative = you owe them. */
export type AccountGroup = 'liquid' | 'investment' | 'credit' | 'business' | 'debt';
export type AccountType =
  | 'card'
  /** A personal current account (no card of its own in the app). */
  | 'current'
  /** A sole-proprietor / company account. */
  | 'business'
  | 'cash'
  | 'flexible'
  | 'deposit'
  /** Bonds, notes, bond funds: priced by the market, unlike a deposit. */
  | 'bonds'
  | 'stocks'
  | 'crypto'
  | 'commodity'
  | 'credit'
  | 'loan';

/** auto: hidden while the balance is 0 (credit cards stay); show / hide: set by hand. Archived is separate. */
export type AccountVisibility = 'auto' | 'show' | 'hide';

export interface Account {
  id: string;
  name: string;
  group: AccountGroup;
  type: AccountType;
  currency: string;
  institution: string;
  country: string;
  kyc_country: string;
  opening_balance: number;
  opening_date: string;
  apr_gross: NumOrEmpty;
  tax_rate: NumOrEmpty;
  maturity_date: string;
  insured_limit: NumOrEmpty;
  risk_price: Risk;
  risk_country: Risk;
  risk_legal: Risk;
  risk_custody: Risk;
  risk_credit: Risk;
  risk_currency: Risk;
  risk_liquidity: Risk;
  in_emergency_fund: boolean;
  archived: boolean;
  visibility: AccountVisibility;
  /** The account a deposit pays its interest out to (its id); '' = into the deposit itself. */
  interest_to: string;
  /**
   * Tax the bank withholds (domain/tax.ts): '' = off; 'gross' = the income typed is before tax; 'net' = it's what
   * arrived, after tax. The rate is tax_rate.
   */
  auto_tax: '' | 'gross' | 'net';
  sort: number;
  color: string;
  note: string;
  updated_at: string;
  server_ts: string;
}

export type CategoryKind = 'expense' | 'income' | 'system';

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  parent_id: string;
  budget_usd: NumOrEmpty;
  essential: boolean;
  icon: string;
  color: string;
  archived: boolean;
  /**
   * Which boards show the category's coin: comma-separated 'liquid', 'business', 'investment'; empty = liquid.
   * Any category can still be used anywhere (the More coin, the entry screen).
   */
  scope: string;
  sort: number;
  updated_at: string;
  server_ts: string;
}

export type TxType = 'expense' | 'income' | 'transfer' | 'adjustment';

export interface Transaction {
  id: string;
  date: string;
  type: TxType;
  account_id: string;
  amount: number;
  to_account_id: string;
  to_amount: NumOrEmpty;
  category_id: string;
  orig_amount: NumOrEmpty;
  orig_currency: string;
  note: string;
  /** Global tags, lowercase, comma-separated: 'groceries, trip to bali'. */
  tags: string;
  usd_rate: NumOrEmpty;
  amount_usd: NumOrEmpty;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  server_ts: string;
}

/** USD per 1 unit of currency. */
export type Rates = Record<string, number>;

export type Entity = 'accounts' | 'categories' | 'transactions' | 'automations' | 'tax_marks' | 'locations';

/** Headline personal tax rates of a country of residence, as text (the TaxRates sheet, typed in by hand). */
export interface TaxRate {
  country: string;
  domestic_income: string;
  foreign_income: string;
  capital_gains: string;
  residency_rule: string;
  /** Days in the period that make you a resident there ('' = 183). */
  threshold_days: number | '';
  /** The period the days count in: the calendar year or any 12 months in a row. */
  window: 'year' | '12m';
  /** Share of foreign income to set aside as a resident there (an estimate typed in), '' = none given. */
  foreign_rate: number | '';
  /** Every way to become a resident there, one a line (the day count first). */
  residency_tests: string;
  note: string;
  as_of: string;
  /** Where the figures come from (a URL). */
  source: string;
  /** How sure the figures are: 'high' (official sources), 'medium' (other guides), 'low' (secondary or partial), '' unknown. */
  confidence: string;
}

/**
 * Where you were on a day, for tax residency (apps-script/Locations.js, domain/residency.ts). One per day:
 * id = loc_<date>. Check-ins (the iPhone Shortcut, the app) add the country on the server.
 */
export interface LocationDay {
  id: string;
  date: string;
  /** ISO 3166 codes in the order you were there, space-separated: 'RU TH'. The last is where the day ended. */
  countries: string;
  /** The latest check-in's city. */
  city: string;
  /** Who wrote it last: 'shortcut' | 'app' | 'manual' | 'import'. */
  source: string;
  note: string;
  deleted: boolean;
  created_at: string;
  updated_at: string;
  server_ts: string;
}

/**
 * A tax period settled from the app without a payment (apps-script/Taxes.js): 'paid' = paid already, it's in the
 * balances; 'deleted' = not owed (it also comes off the accrual). One per rule and period: id = rule_period.
 */
export interface TaxMark {
  id: string;
  rule: string;
  period: string;
  action: 'paid' | 'deleted';
  /** What was owed for the period when marked, in the rule's currency. */
  amount: number;
  currency: string;
  date: string;
  note: string;
  deleted: boolean;
  created_at: string;
  updated_at: string;
  server_ts: string;
}

/**
 * A rule that records transactions by itself; the server runs it daily (apps-script/Automations.js).
 * Kind 'interest': income on the account's balance at the rate on its card, for the days since the previous
 * accrual (balance × rate × days / 365); it goes where the account pays interest.
 * Kind 'expense': a fixed amount off the account into the category.
 */
export interface Automation {
  id: string;
  name: string;
  kind: 'interest' | 'expense';
  account_id: string;
  /** weekly: every 7 days from the start; yearly: on the start's day. */
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** Day of the month for monthly ones (the month's last day when shorter). */
  day: NumOrEmpty;
  /** Interest: the income category ('' = Interest); expense: the expense category. */
  category_id: string;
  /** Expense: the amount in the account's currency. */
  amount: NumOrEmpty;
  /** First accrual date: due dates before it are skipped. */
  start_date: string;
  /** The latest date it recorded (set by the server). */
  last_run: string;
  active: boolean;
  note: string;
  deleted: boolean;
  created_at: string;
  updated_at: string;
  server_ts: string;
}

export interface EntityMap {
  accounts: Account;
  categories: Category;
  transactions: Transaction;
  automations: Automation;
  tax_marks: TaxMark;
  locations: LocationDay;
}

export const RISK_KEYS = [
  'risk_price',
  'risk_country',
  'risk_legal',
  'risk_custody',
  'risk_credit',
  'risk_currency',
  'risk_liquidity',
] as const;
export type RiskKey = (typeof RISK_KEYS)[number];

/** A row of the History sheet: monthly P&L from the old spreadsheet, used for months without transactions. */
export interface HistoryRow {
  /** 'YYYY-MM' */
  month: string;
  category_id: string;
  /** Signed: expenses negative, income positive. */
  amount_usd: number;
}

/**
 * Taxes by accrual from the server (the Taxes sheet, apps-script/Taxes.js): what is owed now under each rule (accrued
 * minus paid from that rule's accounts) and the accrued taxes per month (USD) from the accrual start on.
 */
export interface TaxSummary {
  owedUsd: number;
  rules: {
    id: string;
    label: string;
    /** Where the rule's tax is due (the interest rule: Settings tax_interest_country); empty for the business. */
    country?: string;
    owedUsd: number;
    owed: { amount: number; currency: string };
    /** A year (the interest rule) or a quarter ('2026-Q3', the business): accrued, settled by marks, still owed (rule's currency). */
    periods: { key: string; accrued: number; marked: number; owed: number; owedUsd: number }[];
  }[];
  /** Ids of the tax marks this summary already counts. */
  marks: string[];
  accrued: Record<string, number>;
  at: string;
}

/** A rate on a day, USD per unit. */
export interface FxPoint {
  date: string;
  usd: number;
}

/** Rates at the start of a return window, per currency (the day may be later when the history begins later). */
export interface FxWindow {
  start: string;
  rates: Record<string, FxPoint>;
}

/** Rates for the realized returns, all from one daily source (RatesHistory): window starts and the latest. */
export interface FxWindows {
  ytd: FxWindow;
  y1: FxWindow;
  now: Record<string, FxPoint>;
}

/** Inputs of Capital allocation from the spreadsheet (RatesHistory and the Risk sheet). */
export interface AllocationConfig {
  /** Missing until the first sync with a server that sends it. */
  fx?: FxWindows;
  /** Target share of each asset class (Bonds & deposits, Stocks…), of assets except cash and the emergency fund. */
  targets: { class: string; target: number }[];
  /** Concentration limits, share of gross assets: dimension country / institution / currency / asset_class /
   * high_risk; value '*' = any single value, otherwise that one. */
  limits: { dimension: string; value: string; limit: number }[];
}

/** Values of the spreadsheet's named ranges (Calc sheet), in USD per month where it applies. */
export interface ServerMetrics {
  burn?: number;
  essential?: number;
  passive?: number;
  work_income?: number;
  savings?: number;
}
