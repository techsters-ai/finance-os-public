import { describe, expect, it } from 'vitest';
import { accountBalance, capitalSummary, computeBalances, runwayMonths } from './balances';
import { buildTransaction } from './transactions';
import { buildAdjustment, reconcileDelta } from './reconcile';
import { convert } from './fx';
import { NOW, RATES, account, tx } from './fixtures.test-utils';

const usd = account({ id: 'usd', currency: 'USD', opening_balance: 1000 });
const rub = account({ id: 'rub', currency: 'RUB', opening_balance: 50000 });
const gold = account({ id: 'gold', currency: 'XAU', group: 'investment', type: 'commodity', opening_balance: 2 });
const card = account({ id: 'cc', currency: 'USD', group: 'credit', type: 'credit', opening_balance: -300 });

describe('account balance', () => {
  it('after an expense', () => {
    const t = buildTransaction(
      { type: 'expense', date: '2026-10-18', account: rub, amount: 1250.5, category_id: 'exp_food' },
      { id: 't1', now: NOW, rates: RATES },
    );
    expect(t.amount).toBe(-1250.5);
    expect(t.usd_rate).toBe(0.0125);
    expect(t.amount_usd).toBe(-15.63);
    expect(accountBalance(rub, [t])).toBe(48749.5);
  });

  it('after income', () => {
    const t = buildTransaction(
      { type: 'income', date: '2026-10-18', account: usd, amount: 2500, category_id: 'inc_work' },
      { id: 't2', now: NOW, rates: RATES },
    );
    expect(t.amount).toBe(2500);
    expect(t.amount_usd).toBe(2500);
    expect(accountBalance(usd, [t])).toBe(3500);
  });

  it('after a RUB → USD transfer', () => {
    const toAmount = convert(16000, 'RUB', 'USD', RATES)!;
    expect(toAmount).toBe(200);
    const t = buildTransaction(
      { type: 'transfer', date: '2026-10-18', account: rub, amount: 16000, toAccount: usd, toAmount },
      { id: 't3', now: NOW, rates: RATES },
    );
    expect(t.amount).toBe(-16000);
    expect(t.to_account_id).toBe('usd');
    expect(t.to_amount).toBe(200);
    expect(t.category_id).toBe('');
    const b = computeBalances([usd, rub], [t]);
    expect(b.get('rub')).toBe(34000);
    expect(b.get('usd')).toBe(1200);
  });

  it('after reconciliation', () => {
    const spent = tx({ id: 'a', account_id: 'rub', amount: -500 });
    const calc = accountBalance(rub, [spent]);
    expect(calc).toBe(49500);
    const delta = reconcileDelta(calc, 49320.4, 'RUB');
    expect(delta).toBe(-179.6);
    const adj = buildAdjustment(rub, delta, { id: 'adj', now: NOW, date: '2026-10-18', rates: RATES });
    expect(adj.type).toBe('adjustment');
    expect(adj.amount).toBe(-179.6);
    expect(adj.category_id).toBe('sys_correction');
    expect(accountBalance(rub, [spent, adj])).toBe(49320.4);
  });

  it('ignores deleted transactions', () => {
    const t = tx({ id: 'd', account_id: 'usd', amount: -100, deleted: true });
    expect(accountBalance(usd, [t])).toBe(1000);
  });

  it('skips transactions before the opening date, counts future ones', () => {
    const past = tx({ id: 'p', account_id: 'usd', amount: -10, date: '2020-01-01' });
    const opening = tx({ id: 'o', account_id: 'usd', amount: -1, date: usd.opening_date });
    const future = tx({ id: 'f', account_id: 'usd', amount: -5, date: '2030-01-01' });
    expect(accountBalance(usd, [past, opening, future])).toBe(994);
  });

  it('checks each side of a transfer against its own opening date', () => {
    const person = account({ id: 'p', currency: 'USD', group: 'debt', type: 'loan', opening_date: '2023-01-01' });
    const lent = tx({ id: 'l', type: 'transfer', account_id: 'usd', amount: -300, to_account_id: 'p', to_amount: 300, date: '2024-05-01' });
    const b = computeBalances([usd, person], [lent]);
    expect(b.get('usd')).toBe(1000);
    expect(b.get('p')).toBe(300);
  });
});

describe('net worth', () => {
  it('sums groups in USD, the credit card reduces it', () => {
    const biz = account({ id: 'biz', currency: 'KZT', group: 'business', opening_balance: 100000 });
    const accounts = [usd, rub, gold, card, biz];
    const b = computeBalances(accounts, []);
    const s = capitalSummary(accounts, b, RATES);
    expect(s.byGroup.liquid).toBe(1625); // 1000 + 50000 × 0.0125
    expect(s.byGroup.investment).toBe(8332); // 2 oz × 4166
    expect(s.byGroup.credit).toBe(-300);
    expect(s.byGroup.business).toBe(260); // 100,000 KZT × 0.0026
    expect(s.liquidNet).toBe(1325);
    expect(s.total).toBe(9917);
    expect(s.missingRates).toEqual([]);
  });

  it('leaves out archived accounts and accounts without a rate', () => {
    const brl = account({ id: 'brl', currency: 'BRL', opening_balance: 1000 });
    const old = account({ id: 'old', currency: 'USD', opening_balance: 50, archived: true });
    const accounts = [usd, brl, old];
    const s = capitalSummary(accounts, computeBalances(accounts, []), RATES);
    expect(s.total).toBe(1000);
    expect(s.missingRates).toEqual(['BRL']);
  });
});

describe('debts', () => {
  it('people who owe you add to net worth; what you owe also cuts liquid net', () => {
    const alex = account({ id: 'alex', currency: 'USD', group: 'debt', type: 'loan', opening_balance: 0 });
    const robin = account({ id: 'robin', currency: 'RUB', group: 'debt', type: 'loan', opening_balance: 0 });
    // Lend Alex $200 from the USD card; borrow 8,000 ₽ from Robin into the RUB card.
    const lend = buildTransaction(
      { type: 'transfer', date: '2026-10-18', account: usd, amount: 200, toAccount: alex, toAmount: 200 },
      { id: 'l', now: NOW, rates: RATES },
    );
    const borrow = buildTransaction(
      { type: 'transfer', date: '2026-10-18', account: robin, amount: 8000, toAccount: rub, toAmount: 8000 },
      { id: 'b', now: NOW, rates: RATES },
    );
    const accounts = [usd, rub, alex, robin];
    const b = computeBalances(accounts, [lend, borrow]);
    expect(b.get('alex')).toBe(200);
    expect(b.get('robin')).toBe(-8000);
    const s = capitalSummary(accounts, b, RATES);
    expect(s.receivable).toBe(200);
    expect(s.payable).toBe(-100); // 8,000 ₽ × 0.0125
    expect(s.byGroup.liquid).toBe(800 + 725); // 800 + 58,000 ₽ × 0.0125
    expect(s.liquidNet).toBe(1525 - 100);
    expect(s.total).toBe(1625); // lending and borrowing don't change net worth
  });
});

describe('runway', () => {
  it('months at the burn rate; unknown without a burn rate', () => {
    expect(runwayMonths(12000, 2000)).toBe(6);
    expect(runwayMonths(-500, 2000)).toBe(0);
    expect(runwayMonths(12000, undefined)).toBeUndefined();
    expect(runwayMonths(12000, 0)).toBeUndefined();
  });
});

describe('typing a balance by hand', () => {
  it('sets the opening balance while nothing counts yet', async () => {
    const { balanceEdit } = await import('./reconcile');
    const fresh = account({ id: 'f', currency: 'RUB', opening_balance: 0, opening_date: '2026-10-19' });
    const old = tx({ id: 'o', account_id: 'f', amount: -500, date: '2026-09-01' });
    expect(balanceEdit(fresh, 0, 72500, [old])).toEqual({ opening: 72500, adjustment: 0 });
  });
  it('records a correction once transactions count', async () => {
    const { balanceEdit } = await import('./reconcile');
    const used = account({ id: 'u', currency: 'USD', opening_balance: 100, opening_date: '2026-10-01' });
    const spent = tx({ id: 's', account_id: 'u', amount: -30, date: '2026-10-05' });
    expect(balanceEdit(used, 70, 65.5, [spent])).toEqual({ opening: 100, adjustment: -4.5 });
  });
});
