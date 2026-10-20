// Automatic tax: some banks withhold tax on income (say 10% of deposit interest), so what arrives is already net. An
// account with automatic tax (Account.auto_tax) gets, with each income recorded on it, a Taxes expense on the same
// account and day (id = the income's id + '-tax'), so the tax shows although the bank kept it. The amount typed is
// before tax ('gross': the tax comes off it) or after tax ('net', what arrived: the income is grossed up so that
// income − tax = it). Interest paid out to another account (Account.interest_to) follows the deposit's setting.
import type { Account, Category } from './types';
import { roundMoney } from './money';
import { isShared } from './scope';

export type AutoTaxMode = 'gross' | 'net';

export const taxIdOf = (incomeId: string) => `${incomeId}-tax`;

export interface TaxRule {
  rate: number;
  mode: AutoTaxMode;
  /** The account whose setting it is: the income's own, or the deposit paying interest into it. */
  from: Account;
}

const rateOf = (a: Account) => (typeof a.tax_rate === 'number' && a.tax_rate > 0 && a.tax_rate < 1 ? a.tax_rate : 0);

/**
 * The rule for an income on this account: its own automatic tax, or — for interest — that of the deposits paying
 * into it (the one with the largest weight, e.g. expected interest, when several do).
 */
export function taxRuleFor(
  account: Account,
  interest: boolean,
  accounts: Account[],
  weight: (a: Account) => number = () => 1,
): TaxRule | undefined {
  if (account.auto_tax && rateOf(account)) return { rate: rateOf(account), mode: account.auto_tax, from: account };
  if (!interest) return undefined;
  const payers = accounts
    .filter((a) => !a.archived && a.interest_to === account.id && a.auto_tax && rateOf(a))
    .sort((a, b) => weight(b) - weight(a));
  const top = payers[0];
  return top && top.auto_tax ? { rate: rateOf(top), mode: top.auto_tax, from: top } : undefined;
}

/** The income and its tax from the amount typed, in the account's currency. */
export function splitTax(typed: number, rule: TaxRule, currency: string): { income: number; tax: number } {
  if (rule.mode === 'gross') {
    const tax = roundMoney(typed * rule.rate, currency);
    return { income: roundMoney(typed, currency), tax };
  }
  const income = roundMoney(typed / (1 - rule.rate), currency);
  return { income, tax: roundMoney(income - typed, currency) };
}

/** Where automatic taxes go: the category on every board named like Taxes, or any expense category named so. */
export function taxCategory(categories: Category[]): Category | undefined {
  const live = categories.filter((c) => c.kind === 'expense' && !c.archived && !c.parent_id && /tax/i.test(c.name));
  return live.find((c) => isShared(c)) ?? live[0];
}
