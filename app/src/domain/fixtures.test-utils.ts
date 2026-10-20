// Test factories.
import type { Account, Category, Transaction } from './types';
import { emptyTransaction } from './transactions';

export function account(p: Partial<Account> & Pick<Account, 'id' | 'currency'>): Account {
  return {
    name: p.id,
    group: 'liquid',
    type: 'card',
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
    visibility: 'auto',
    interest_to: '',
    auto_tax: '',
    sort: 0,
    color: '',
    note: '',
    updated_at: '',
    server_ts: '',
    ...p,
  };
}

export function category(p: Partial<Category> & Pick<Category, 'id'>): Category {
  return {
    name: p.id,
    kind: 'expense',
    parent_id: '',
    budget_usd: '',
    essential: false,
    icon: '',
    color: '',
    archived: false,
    scope: '',
    sort: 0,
    updated_at: '',
    server_ts: '',
    ...p,
  };
}

export function tx(p: Partial<Transaction> & Pick<Transaction, 'id' | 'account_id' | 'amount'>): Transaction {
  return { ...emptyTransaction(), date: '2026-10-10', ...p };
}

export const RATES = { USD: 1, RUB: 0.0125, EUR: 1.08, XAU: 4166, TRY: 0.00008, GEL: 0.37, KZT: 0.0026 };
export const NOW = '2026-10-18T10:00:00.000Z';
