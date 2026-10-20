// Coerces records coming from the server (Google Sheets) to model types.
// The sheet may return "TRUE", numbers as strings, and dates as Date objects (ISO with time).
import type { Account, Automation, Category, Entity, EntityMap, LocationDay, TaxMark, Transaction } from './types';
import { joinTags, parseTags } from './tags';
import { joinScopes, parseScopes } from './scope';
import { emptyTransaction } from './transactions';

export function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['true', '1', 'yes'].includes(v.trim().toLowerCase());
  return false;
}

export function toNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

export function toNumOrEmpty(v: unknown): number | '' {
  if (v === '' || v == null) return '';
  const n = toNum(v, NaN);
  return Number.isFinite(n) ? n : '';
}

export function toStr(v: unknown): string {
  if (v == null) return '';
  return String(v);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' as is; ISO with time → the device's local date. */
export function toDate(v: unknown): string {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : localDate(d);
}

function str(r: Record<string, unknown>, k: string): string {
  return toStr(r[k]);
}

function toAutoTax(v: unknown): Account['auto_tax'] {
  const s = toStr(v).trim().toLowerCase();
  return s === 'gross' || s === 'net' ? s : '';
}

function toVisibility(v: unknown): Account['visibility'] {
  const s = toStr(v).trim().toLowerCase();
  return s === 'show' || s === 'hide' ? s : 'auto';
}

export function normalizeAccount(r: Record<string, unknown>): Account {
  return {
    id: str(r, 'id'),
    name: str(r, 'name'),
    group: (str(r, 'group') || 'liquid') as Account['group'],
    type: (str(r, 'type') || 'card') as Account['type'],
    currency: str(r, 'currency').toUpperCase() || 'USD',
    institution: str(r, 'institution'),
    country: str(r, 'country'),
    kyc_country: str(r, 'kyc_country'),
    opening_balance: toNum(r.opening_balance),
    opening_date: toDate(r.opening_date),
    apr_gross: toNumOrEmpty(r.apr_gross),
    tax_rate: toNumOrEmpty(r.tax_rate),
    maturity_date: toDate(r.maturity_date),
    insured_limit: toNumOrEmpty(r.insured_limit),
    risk_price: toNumOrEmpty(r.risk_price),
    risk_country: toNumOrEmpty(r.risk_country),
    risk_legal: toNumOrEmpty(r.risk_legal),
    risk_custody: toNumOrEmpty(r.risk_custody),
    risk_credit: toNumOrEmpty(r.risk_credit),
    risk_currency: toNumOrEmpty(r.risk_currency),
    risk_liquidity: toNumOrEmpty(r.risk_liquidity),
    in_emergency_fund: toBool(r.in_emergency_fund),
    archived: toBool(r.archived),
    visibility: toVisibility(r.visibility),
    interest_to: str(r, 'interest_to'),
    auto_tax: toAutoTax(r.auto_tax),
    sort: toNum(r.sort),
    color: str(r, 'color'),
    note: str(r, 'note'),
    updated_at: str(r, 'updated_at'),
    server_ts: str(r, 'server_ts'),
  };
}

export function normalizeCategory(r: Record<string, unknown>): Category {
  return {
    id: str(r, 'id'),
    name: str(r, 'name'),
    kind: (str(r, 'kind') || 'expense') as Category['kind'],
    parent_id: str(r, 'parent_id'),
    budget_usd: toNumOrEmpty(r.budget_usd),
    essential: toBool(r.essential),
    icon: str(r, 'icon'),
    color: str(r, 'color'),
    archived: toBool(r.archived),
    scope: joinScopes(parseScopes(str(r, 'scope'))),
    sort: toNum(r.sort),
    updated_at: str(r, 'updated_at'),
    server_ts: str(r, 'server_ts'),
  };
}

export function normalizeTransaction(r: Record<string, unknown>): Transaction {
  return {
    ...emptyTransaction(),
    id: str(r, 'id'),
    date: toDate(r.date),
    type: (str(r, 'type') || 'expense') as Transaction['type'],
    account_id: str(r, 'account_id'),
    amount: toNum(r.amount),
    to_account_id: str(r, 'to_account_id'),
    to_amount: toNumOrEmpty(r.to_amount),
    category_id: str(r, 'category_id'),
    orig_amount: toNumOrEmpty(r.orig_amount),
    orig_currency: str(r, 'orig_currency').toUpperCase(),
    note: str(r, 'note'),
    tags: joinTags(parseTags(str(r, 'tags'))),
    usd_rate: toNumOrEmpty(r.usd_rate),
    amount_usd: toNumOrEmpty(r.amount_usd),
    created_at: str(r, 'created_at'),
    updated_at: str(r, 'updated_at'),
    deleted: toBool(r.deleted),
    server_ts: str(r, 'server_ts'),
  };
}

export function normalizeAutomation(r: Record<string, unknown>): Automation {
  return {
    id: str(r, 'id'),
    name: str(r, 'name'),
    kind: str(r, 'kind') === 'expense' ? 'expense' : 'interest',
    account_id: str(r, 'account_id'),
    frequency: (['weekly', 'monthly', 'yearly'] as const).find((f) => f === str(r, 'frequency')) ?? 'daily',
    amount: toNumOrEmpty(r.amount),
    day: toNumOrEmpty(r.day),
    category_id: str(r, 'category_id'),
    start_date: toDate(r.start_date),
    last_run: toDate(r.last_run),
    active: r.active === undefined || r.active === '' ? true : toBool(r.active),
    note: str(r, 'note'),
    deleted: toBool(r.deleted),
    created_at: str(r, 'created_at'),
    updated_at: str(r, 'updated_at'),
    server_ts: str(r, 'server_ts'),
  };
}

export function normalizeTaxMark(r: Record<string, unknown>): TaxMark {
  return {
    id: str(r, 'id'),
    rule: str(r, 'rule'),
    period: str(r, 'period'),
    action: str(r, 'action') === 'deleted' ? 'deleted' : 'paid',
    amount: toNum(r.amount),
    currency: str(r, 'currency'),
    date: toDate(r.date),
    note: str(r, 'note'),
    deleted: toBool(r.deleted),
    created_at: str(r, 'created_at'),
    updated_at: str(r, 'updated_at'),
    server_ts: str(r, 'server_ts'),
  };
}

/** Country codes upper-cased, once each, in their order: 'ru, th ru' → 'TH RU' keeps the last place last. */
export function cleanCountries(v: unknown): string {
  const list = toStr(v).toUpperCase().split(/[\s,]+/).filter((c) => /^[A-Z]{2}$/.test(c));
  return list.filter((c, i) => list.lastIndexOf(c) === i).join(' ');
}

export function normalizeLocation(r: Record<string, unknown>): LocationDay {
  return {
    id: str(r, 'id'),
    date: toDate(r.date),
    countries: cleanCountries(r.countries),
    city: str(r, 'city'),
    source: str(r, 'source'),
    note: str(r, 'note'),
    deleted: toBool(r.deleted),
    created_at: str(r, 'created_at'),
    updated_at: str(r, 'updated_at'),
    server_ts: str(r, 'server_ts'),
  };
}

export function normalize<E extends Entity>(entity: E, r: Record<string, unknown>): EntityMap[E] {
  switch (entity) {
    case 'accounts':
      return normalizeAccount(r) as EntityMap[E];
    case 'categories':
      return normalizeCategory(r) as EntityMap[E];
    case 'automations':
      return normalizeAutomation(r) as EntityMap[E];
    case 'tax_marks':
      return normalizeTaxMark(r) as EntityMap[E];
    case 'locations':
      return normalizeLocation(r) as EntityMap[E];
    default:
      return normalizeTransaction(r) as EntityMap[E];
  }
}

/** Compares ISO timestamps: true if a is strictly newer than b. An empty timestamp is the oldest. */
export function isNewer(a: string, b: string): boolean {
  if (!a) return false;
  if (!b) return true;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta > tb;
  return a > b;
}
