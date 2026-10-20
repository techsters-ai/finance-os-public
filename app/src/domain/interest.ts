// Deposit interest: a deposit may pay its interest out to another account (Account.interest_to), where it is
// booked as Interest income, in that account's currency. That income still belongs to the deposit: it is split
// among the deposits paying there by what each is expected to earn, and compared with that expectation.
import type { Account, Rates, Transaction } from './types';
import { netApr } from './allocation';
import { toUsd } from './fx';
import { txUsd } from './metrics';
import { taxIdOf } from './tax';

/** Accounts whose interest this tracks: savings and term deposits, accounts with a rate, any paying interest out elsewhere. */
export function earnsInterest(a: Account): boolean {
  const rate = typeof a.apr_gross === 'number' && a.apr_gross > 0;
  return !a.archived && (a.type === 'deposit' || a.type === 'flexible' || rate || !!a.interest_to);
}

/** Interest a month in USD at today's balance and rate after tax. */
export function expectedMonthlyUsd(a: Account, balance: number, rates: Rates): number {
  const usd = toUsd(balance, a.currency, rates) ?? 0;
  return usd > 0 ? (usd * netApr(a)) / 12 : 0;
}

export interface DepositInterest {
  deposit: Account;
  /** The account its interest is paid to; undefined = into the deposit itself. */
  payout?: Account;
  expectedUsd: number;
  receivedUsd: number;
}

/**
 * Interest each deposit received in [from, to]: Interest income booked on an account goes to the deposits it
 * belongs to (the account itself, if it earns interest, and the deposits paying into it), split by their expected
 * interest (equally when none is expected). A reconciliation booked as Interest counts only on a deposit that keeps
 * its interest and has no automation recording it (`recorded`: see reconcile.ts interestRecorded) — elsewhere it's a
 * balance catch-up, not interest. Income on an account no deposit claims is left out. An income's automatic tax comes
 * off it: what the deposit received is net, like the expectation.
 */
export function depositInterest(p: {
  accounts: Account[];
  balances: Map<string, number>;
  txs: Transaction[];
  rates: Rates;
  currencyOf: (accountId: string) => string | undefined;
  isInterest: (categoryId: string) => boolean;
  /** Accounts whose interest is recorded otherwise than by reconciling (reconcile.ts interestRecorded). */
  recorded?: (account: Account) => boolean;
  from: string;
  to: string;
}): DepositInterest[] {
  const byId = new Map(p.accounts.map((a) => [a.id, a]));
  const rows = new Map<string, DepositInterest>();
  for (const a of p.accounts) {
    if (!earnsInterest(a)) continue;
    rows.set(a.id, {
      deposit: a,
      payout: a.interest_to ? byId.get(a.interest_to) : undefined,
      expectedUsd: expectedMonthlyUsd(a, p.balances.get(a.id) ?? 0, p.rates),
      receivedUsd: 0,
    });
  }
  /** Who an income on this account belongs to. */
  const claimants = (accountId: string): DepositInterest[] => {
    const out = [...rows.values()].filter((r) => r.deposit.interest_to === accountId);
    const self = rows.get(accountId);
    if (self) out.push(self);
    return out;
  };
  const taxes = new Map(p.txs.filter((t) => !t.deleted && t.id.endsWith('-tax')).map((t) => [t.id, t]));
  for (const t of p.txs) {
    if (t.deleted || (t.type !== 'income' && t.type !== 'adjustment') || t.date < p.from || t.date > p.to || !p.isInterest(t.category_id)) continue;
    if (t.type === 'adjustment') {
      const own = byId.get(t.account_id);
      if (!own || p.recorded?.(own)) continue;
    }
    const who = claimants(t.account_id);
    if (!who.length) continue;
    const tax = taxes.get(taxIdOf(t.id));
    const usd = txUsd(t, p.rates, p.currencyOf) + (tax ? txUsd(tax, p.rates, p.currencyOf) : 0);
    const weight = who.reduce((s, r) => s + r.expectedUsd, 0);
    for (const r of who) r.receivedUsd += weight > 0 ? (usd * r.expectedUsd) / weight : usd / who.length;
  }
  return [...rows.values()].filter((r) => r.expectedUsd > 0 || r.receivedUsd !== 0);
}
