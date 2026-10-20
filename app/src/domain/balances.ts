// Account balances and net worth.
import type { Account, AccountGroup, Rates, Transaction } from './types';
import { roundMoney, roundTo } from './money';
import { toUsd } from './fx';

/**
 * Balance = opening_balance + Σ amount (account_id = account) + Σ to_amount (to_account_id = account),
 * non-deleted transactions dated on or after the account's opening_date. Older ones (imported history)
 * are already part of the opening balance; future-dated ones count.
 */
export function computeBalances(accounts: Account[], txs: Transaction[]): Map<string, number> {
  const sums = new Map<string, number>();
  const since = new Map<string, string>();
  for (const a of accounts) {
    sums.set(a.id, Number(a.opening_balance) || 0);
    since.set(a.id, a.opening_date || '');
  }
  const counts = (id: string, date: string) => sums.has(id) && date >= since.get(id)!;
  for (const t of txs) {
    if (t.deleted) continue;
    if (counts(t.account_id, t.date)) sums.set(t.account_id, sums.get(t.account_id)! + (Number(t.amount) || 0));
    if (t.type === 'transfer' && t.to_account_id && counts(t.to_account_id, t.date)) {
      sums.set(t.to_account_id, sums.get(t.to_account_id)! + (Number(t.to_amount) || 0));
    }
  }
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const [id, v] of sums) sums.set(id, roundMoney(v, byId.get(id)!.currency));
  return sums;
}

export function accountBalance(account: Account, txs: Transaction[]): number {
  return computeBalances([account], txs).get(account.id) ?? 0;
}

export interface CapitalSummary {
  total: number;
  byGroup: Record<AccountGroup, number>;
  /** Liquid accounts minus credit card debt and money you owe people. */
  liquidNet: number;
  /** Debt group: what people owe you (positive balances) and what you owe them (negative). */
  receivable: number;
  payable: number;
  /** Currencies without a rate: those accounts are left out of the totals. */
  missingRates: string[];
}

/**
 * Net worth in USD across non-archived accounts. Credit cards and money you owe reduce it (their balance
 * is negative); money people owe you adds to it.
 */
export function capitalSummary(accounts: Account[], balances: Map<string, number>, rates: Rates): CapitalSummary {
  const byGroup: Record<AccountGroup, number> = { liquid: 0, investment: 0, credit: 0, business: 0, debt: 0 };
  let receivable = 0;
  let payable = 0;
  const missing = new Set<string>();
  for (const a of accounts) {
    if (a.archived) continue;
    const bal = balances.get(a.id) ?? 0;
    const usd = toUsd(bal, a.currency, rates);
    if (usd === undefined) {
      if (bal !== 0) missing.add(a.currency);
      continue;
    }
    const g: AccountGroup = byGroup[a.group] !== undefined ? a.group : 'liquid';
    byGroup[g] += usd;
    if (g === 'debt') {
      if (usd > 0) receivable += usd;
      else payable += usd;
    }
  }
  for (const g of Object.keys(byGroup) as AccountGroup[]) byGroup[g] = roundTo(byGroup[g], 2);
  return {
    total: roundTo(byGroup.liquid + byGroup.investment + byGroup.credit + byGroup.business + byGroup.debt, 2),
    byGroup,
    liquidNet: roundTo(byGroup.liquid + byGroup.credit + payable, 2),
    receivable: roundTo(receivable, 2),
    payable: roundTo(payable, 2),
    missingRates: [...missing],
  };
}

/** Months of runway: how long `amount` lasts at `burn` per month. Undefined when burn is unknown. */
export function runwayMonths(amount: number, burn: number | undefined): number | undefined {
  if (burn === undefined || !Number.isFinite(burn) || burn <= 0) return undefined;
  return Math.max(0, amount) / burn;
}
