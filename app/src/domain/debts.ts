// Debts: one account per person in the 'debt' group. Lending and borrowing are transfers:
// money to the person's account = you gave it, money from it = you got it. Balance > 0: they owe you.
import type { Account, Transaction } from './types';

export function isDebt(a: Pick<Account, 'group'> | undefined): boolean {
  return a?.group === 'debt';
}

/** 'owes you $50' / 'you owe $50' / 'settled'; amount formatting is the caller's. */
export function debtStatus(balance: number): 'owes you' | 'you owe' | 'settled' {
  if (balance > 0) return 'owes you';
  if (balance < 0) return 'you owe';
  return 'settled';
}

/** Title of a transfer that involves a person, or undefined for a plain transfer. */
export function debtTransferTitle(from: Account | undefined, to: Account | undefined): string | undefined {
  if (isDebt(to) && !isDebt(from)) return `Gave to ${to!.name}`;
  if (isDebt(from) && !isDebt(to)) return `Got from ${from!.name}`;
  return undefined;
}

/** A new person to lend to or borrow from: a debt account with a zero balance from `date`. */
export function personAccount(p: { id: string; name: string; currency: string; date: string }): Account {
  return {
    id: p.id,
    name: p.name,
    group: 'debt',
    type: 'loan',
    currency: p.currency,
    institution: '',
    country: '',
    kyc_country: '',
    opening_balance: 0,
    opening_date: p.date,
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
    sort: 100,
    color: '#FF9F0A',
    note: '',
    updated_at: '',
    server_ts: '',
  };
}

/**
 * The board each person belongs to: the group of the account used in the latest transfer with them (business,
 * investment, otherwise liquid). People with no such transfer are left out (they count as liquid). `txs` newest first.
 */
export function debtBoards(
  txs: Pick<Transaction, 'type' | 'account_id' | 'to_account_id' | 'deleted'>[],
  accountsById: Map<string, Pick<Account, 'group'>>,
): Map<string, 'liquid' | 'business' | 'investment'> {
  const out = new Map<string, 'liquid' | 'business' | 'investment'>();
  for (const t of txs) {
    if (t.deleted || t.type !== 'transfer') continue;
    for (const [person, other] of [
      [t.account_id, t.to_account_id],
      [t.to_account_id, t.account_id],
    ]) {
      if (!person || out.has(person) || accountsById.get(person)?.group !== 'debt') continue;
      const g = accountsById.get(other)?.group;
      if (!g || g === 'debt') continue;
      out.set(person, g === 'business' ? 'business' : g === 'investment' ? 'investment' : 'liquid');
    }
  }
  return out;
}
