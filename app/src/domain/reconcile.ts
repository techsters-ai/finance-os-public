// Balance reconciliation: actual vs. calculated → an adjustment transaction.
import type { Account, AccountType, Rates, Transaction } from './types';
import { roundMoney } from './money';
import { buildTransaction } from './transactions';

export const SYS_REVALUATION = 'sys_revaluation';
export const SYS_CORRECTION = 'sys_correction';
export const INC_INTEREST = 'inc_interest';

/**
 * stocks/bonds/crypto/commodity → revaluation; deposit/flexible → interest; card/current/business/cash/credit →
 * correction. A deposit whose interest is recorded otherwise (`interestRecorded`: an automation books it, or it's paid
 * to another account) gets no category: the difference is a balance correction, out of income and expenses — booked
 * as Interest it would count the interest twice, or a catch-up as interest.
 */
export function adjustmentCategory(type: AccountType, interestRecorded = false): string {
  switch (type) {
    case 'stocks':
    case 'bonds':
    case 'crypto':
    case 'commodity':
      return SYS_REVALUATION;
    case 'deposit':
    case 'flexible':
      return interestRecorded ? '' : INC_INTEREST;
    default:
      return SYS_CORRECTION;
  }
}

/** Interest on the account is recorded otherwise than by reconciling it: paid to another account, or by an automation. */
export function interestRecorded(account: Account, automations: { kind: string; account_id: string; active: boolean; deleted: boolean }[]): boolean {
  return !!account.interest_to || automations.some((a) => a.kind === 'interest' && a.active && !a.deleted && a.account_id === account.id);
}

export function reconcileDelta(calculated: number, actual: number, currency: string): number {
  return roundMoney(actual - calculated, currency);
}

export interface AdjustmentContext {
  id: string;
  now: string;
  date: string;
  rates: Rates;
  note?: string;
  /** See interestRecorded: then a deposit's difference isn't interest. */
  interestRecorded?: boolean;
}

export const RECONCILE_NOTE = 'Reconciliation';

/**
 * A reconciliation transaction is always created, including when delta = 0:
 * the sheet uses it to track the account's last reconciliation date.
 */
export function buildAdjustment(account: Account, delta: number, ctx: AdjustmentContext): Transaction {
  return buildTransaction(
    {
      type: 'adjustment',
      date: ctx.date,
      account,
      amount: roundMoney(delta, account.currency),
      category_id: adjustmentCategory(account.type, ctx.interestRecorded),
      note: ctx.note ?? RECONCILE_NOTE,
    },
    { id: ctx.id, now: ctx.now, rates: ctx.rates },
  );
}

const GROUP_ORDER: Record<string, number> = { investment: 0, liquid: 1, business: 2, credit: 3, debt: 4 };

/**
 * "Monthly reconciliation" wizard: all unarchived accounts except those hidden by hand (zero-balance ones stay:
 * that is where a forgotten balance shows up), investment first, then liquid, business, credit, debts.
 */
export function reconcileCandidates(accounts: Account[]): Account[] {
  return accounts
    .filter((a) => !a.archived && a.visibility !== 'hide')
    .sort(
      (a, b) =>
        (GROUP_ORDER[a.group] ?? 9) - (GROUP_ORDER[b.group] ?? 9) ||
        (a.sort ?? 0) - (b.sort ?? 0) ||
        a.name.localeCompare(b.name),
    );
}

/** The reminder shows from the 1st to the 7th until this month is reconciled. */
export function reconcileReminderDue(today: string, reconciledMonths: string[]): boolean {
  const day = Number(today.slice(8, 10));
  return day >= 1 && day <= 7 && !reconciledMonths.includes(today.slice(0, 7));
}

/** Whether any transaction counts toward the balance yet (dated on or after the opening date). */
export function hasCountedTransactions(
  account: Pick<Account, 'opening_date' | 'id'>,
  txs: Pick<Transaction, 'account_id' | 'to_account_id' | 'date' | 'deleted'>[],
): boolean {
  return txs.some(
    (t) => !t.deleted && (t.account_id === account.id || t.to_account_id === account.id) && t.date >= account.opening_date,
  );
}

/**
 * A balance typed in by hand. While no transaction counts toward the account (none on or after its opening
 * date), the new balance becomes the opening balance; after that it's an adjustment for the difference.
 */
export function balanceEdit(
  account: Pick<Account, 'opening_balance' | 'opening_date' | 'currency' | 'id'>,
  current: number,
  target: number,
  txs: Pick<Transaction, 'account_id' | 'to_account_id' | 'date' | 'deleted'>[],
): { opening: number; adjustment: number } {
  const delta = reconcileDelta(current, target, account.currency);
  const fresh = !hasCountedTransactions(account, txs);
  if (delta === 0) return { opening: account.opening_balance, adjustment: 0 };
  return fresh
    ? { opening: roundMoney(account.opening_balance + delta, account.currency), adjustment: 0 }
    : { opening: account.opening_balance, adjustment: delta };
}
