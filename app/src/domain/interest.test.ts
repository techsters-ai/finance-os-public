import { describe, expect, it } from 'vitest';
import { depositInterest, earnsInterest, expectedMonthlyUsd } from './interest';
import { account, tx } from './fixtures.test-utils';

const rates = { USD: 1, TRY: 0.0001, RUB: 0.01 };
const card = account({ id: 'card', currency: 'USD' });
// Two lira deposits paying into the dollar card: $12,000 at 20% and $12,000 at 10%, tax 0.
const d20 = account({ id: 'd20', currency: 'TRY', type: 'deposit', group: 'investment', apr_gross: 0.2, interest_to: 'card' });
const d10 = account({ id: 'd10', currency: 'TRY', type: 'deposit', group: 'investment', apr_gross: 0.1, interest_to: 'card' });
// A ruble savings account that keeps its interest.
const sav = account({ id: 'sav', currency: 'RUB', type: 'flexible', apr_gross: 0.12, tax_rate: 0 });
const balances = new Map([
  ['card', 500],
  ['d20', 120_000_000],
  ['d10', 120_000_000],
  ['sav', 100_000],
]);
const run = (txs: ReturnType<typeof tx>[]) =>
  depositInterest({
    accounts: [card, d20, d10, sav],
    balances,
    txs,
    rates,
    currencyOf: (id) => ({ card: 'USD', d20: 'TRY', d10: 'TRY', sav: 'RUB' })[id],
    isInterest: (c) => c === 'inc_interest',
    from: '2026-10-01',
    to: '2026-10-31',
  });

describe('deposit interest', () => {
  it('expects balance × rate after tax / 12 in USD', () => {
    expect(expectedMonthlyUsd(d20, 120_000_000, rates)).toBeCloseTo(200, 6);
    expect(expectedMonthlyUsd(account({ id: 'x', currency: 'RUB', apr_gross: 0.12, tax_rate: 0.5 }), 100_000, rates)).toBeCloseTo(5, 6);
  });
  it('interest paid to the card is split among the deposits paying there by expected interest', () => {
    const rows = run([tx({ id: 'i', type: 'income', account_id: 'card', amount: 270, amount_usd: 270, category_id: 'inc_interest', date: '2026-10-05' })]);
    const by = Object.fromEntries(rows.map((r) => [r.deposit.id, r]));
    expect(by.d20.receivedUsd).toBeCloseTo(180, 6);
    expect(by.d10.receivedUsd).toBeCloseTo(90, 6);
    expect(by.d20.payout?.id).toBe('card');
    expect(by.d20.expectedUsd).toBeCloseTo(200, 6);
    expect(by.sav.receivedUsd).toBe(0);
  });
  it("an income's automatic tax comes off what the deposit received", () => {
    const rows = run([
      tx({ id: 'i', type: 'income', account_id: 'card', amount: 300, amount_usd: 300, category_id: 'inc_interest', date: '2026-10-05' }),
      tx({ id: 'i-tax', type: 'expense', account_id: 'card', amount: -30, amount_usd: -30, category_id: 'exp_taxes', date: '2026-10-05' }),
    ]);
    expect(rows.reduce((s, r) => s + r.receivedUsd, 0)).toBeCloseTo(270, 6);
  });
  it('interest booked on the deposit itself is its own; other income and other months are left out', () => {
    const rows = run([
      tx({ id: 'a', type: 'income', account_id: 'sav', amount: 1000, amount_usd: 10, category_id: 'inc_interest', date: '2026-10-31' }),
      tx({ id: 'b', type: 'income', account_id: 'card', amount: 3000, amount_usd: 3000, category_id: 'inc_work', date: '2026-10-05' }),
      tx({ id: 'c', type: 'income', account_id: 'card', amount: 99, amount_usd: 99, category_id: 'inc_interest', date: '2026-09-30' }),
      // a reconciliation of the savings account, booked as Interest
      tx({ id: 'r', type: 'adjustment', account_id: 'sav', amount: 500, amount_usd: 5, category_id: 'inc_interest', date: '2026-10-20' }),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.deposit.id, r.receivedUsd]));
    expect(by).toEqual({ d20: 0, d10: 0, sav: 15 });
  });
  it("a reconciliation booked as Interest isn't interest where it's recorded otherwise (an automation, or paid elsewhere)", () => {
    // A catch-up reconciliation booked as Interest while an automation records the interest daily.
    const rows = depositInterest({
      accounts: [card, d20, sav],
      balances,
      txs: [
        tx({ id: 'a', type: 'income', account_id: 'sav', amount: 2300, amount_usd: 23, category_id: 'inc_interest', date: '2026-10-01' }),
        tx({ id: 'r', type: 'adjustment', account_id: 'sav', amount: 84500, amount_usd: 845, category_id: 'inc_interest', date: '2026-10-14' }),
        tx({ id: 'b', type: 'adjustment', account_id: 'd20', amount: -1000, amount_usd: -61, category_id: 'inc_interest', date: '2026-10-19' }),
      ],
      rates,
      currencyOf: (id) => ({ card: 'USD', d20: 'TRY', sav: 'RUB' })[id],
      isInterest: (c) => c === 'inc_interest',
      recorded: (a) => a.id === 'sav' || !!a.interest_to,
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(Object.fromEntries(rows.map((r) => [r.deposit.id, r.receivedUsd]))).toEqual({ d20: 0, sav: 23 });
  });

  it('an account with a rate is tracked whatever its type (a card, crypto)', () => {
    const cashback = account({ id: 'y', currency: 'RUB', type: 'card', apr_gross: 0.13 });
    expect(earnsInterest(cashback)).toBe(true);
    expect(earnsInterest(card)).toBe(false);
  });
});
