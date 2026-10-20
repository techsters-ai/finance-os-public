import { describe, expect, it } from 'vitest';
import { budgetTotal, monthSpendingByCategory, monthTotals, periodStats, rollUpToParents } from './metrics';
import { RATES, category, tx } from './fixtures.test-utils';

const currencyOf = (id: string) => ({ usd: 'USD', rub: 'RUB' })[id];

const txs = [
  tx({ id: '1', type: 'expense', account_id: 'usd', amount: -20, amount_usd: -20, category_id: 'exp_food', date: '2026-10-01' }),
  tx({ id: '2', type: 'expense', account_id: 'rub', amount: -800, amount_usd: -10, category_id: 'exp_food', date: '2026-10-15' }),
  tx({ id: '3', type: 'expense', account_id: 'usd', amount: -45.5, amount_usd: -45.5, category_id: 'exp_transport', date: '2026-10-31' }),
  // no amount_usd → converted at the current RUB rate
  tx({ id: '4', type: 'expense', account_id: 'rub', amount: -400, category_id: 'exp_cafe', date: '2026-10-20' }),
  // another month
  tx({ id: '5', type: 'expense', account_id: 'usd', amount: -99, amount_usd: -99, category_id: 'exp_food', date: '2026-09-30' }),
  // deleted
  tx({ id: '6', type: 'expense', account_id: 'usd', amount: -500, amount_usd: -500, category_id: 'exp_food', date: '2026-10-02', deleted: true }),
  // transfers, adjustments and income are not spending
  tx({ id: '7', type: 'transfer', account_id: 'usd', amount: -300, amount_usd: -300, to_account_id: 'rub', to_amount: 24000, date: '2026-10-03' }),
  tx({ id: '8', type: 'adjustment', account_id: 'usd', amount: -7, amount_usd: -7, category_id: 'sys_correction', date: '2026-10-04' }),
  tx({ id: '9', type: 'income', account_id: 'usd', amount: 3000, amount_usd: 3000, category_id: 'inc_work', date: '2026-10-05' }),
];

describe('month spending', () => {
  it('by category in USD', () => {
    const m = monthSpendingByCategory(txs, '2026-10', RATES, currencyOf);
    expect(Object.fromEntries(m)).toEqual({ exp_food: 30, exp_transport: 45.5, exp_cafe: 5 });
  });

  it('subcategories roll up into the parent', () => {
    const cats = [category({ id: 'exp_food' }), category({ id: 'exp_cafe', parent_id: 'exp_food' })];
    const m = rollUpToParents(monthSpendingByCategory(txs, '2026-10', RATES, currencyOf), cats);
    expect(m.get('exp_food')).toBe(35);
    expect(m.has('exp_cafe')).toBe(false);
  });

  it('month totals without transfers and adjustments', () => {
    expect(monthTotals(txs, '2026-10', RATES, currencyOf)).toEqual({ expense: 80.5, income: 3000 });
  });

  it('budget total', () => {
    const cats = [
      category({ id: 'a', budget_usd: 400 }),
      category({ id: 'b', budget_usd: 150.5 }),
      category({ id: 'c', budget_usd: '' }),
      category({ id: 'd', budget_usd: 1000, archived: true }),
      category({ id: 'e', kind: 'income', budget_usd: 50 }),
    ];
    expect(budgetTotal(cats)).toBe(550.5);
  });
});

describe('period analytics', () => {
  const cats = [
    category({ id: 'exp_food' }),
    category({ id: 'exp_cafe', parent_id: 'exp_food' }),
    category({ id: 'exp_transport' }),
    category({ id: 'inc_work', kind: 'income' }),
    category({ id: 'sys_revaluation', kind: 'system' }),
  ];
  const history = [
    { month: '2026-08', category_id: 'exp_food', amount_usd: -1000 },
    { month: '2026-08', category_id: 'inc_work', amount_usd: 5000 },
    { month: '2026-08', category_id: 'sys_revaluation', amount_usd: 300 },
    { month: '2026-07', category_id: 'exp_food', amount_usd: -900 },
  ];
  const base = { txs, history, categories: cats, rates: RATES, currencyOf };

  it('combines History months with transactions and rolls categories up', () => {
    const s = periodStats({ ...base, from: '2026-08-01', to: '2026-10-31' });
    expect(s.expense).toBe(1000 + 99 + 80.5);
    expect(s.income).toBe(8000);
    expect(s.expenseByCategory.get('exp_food')).toBe(1000 + 99 + 35);
    expect(s.expenseByCategory.has('exp_cafe')).toBe(false);
    expect(s.byMonth.map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(s.byMonth[0]).toEqual({ month: '2026-08', income: 5000, expense: 1000 });
    expect(s.historyMonths).toEqual(['2026-08']);
  });

  it('a month with transactions ignores its History rows', () => {
    const imported = [
      ...txs,
      tx({ id: 'imp1', type: 'expense', account_id: 'usd', amount: -40, amount_usd: -40, category_id: 'exp_food', date: '2026-08-12' }),
    ];
    const s = periodStats({ ...base, txs: imported, from: '2026-07-01', to: '2026-08-31' });
    expect(s.byMonth).toEqual([
      { month: '2026-07', income: 0, expense: 900 },
      { month: '2026-08', income: 0, expense: 40 },
    ]);
    expect(s.historyMonths).toEqual(['2026-07']);
  });

  it('counts transactions by exact date', () => {
    const s = periodStats({ ...base, from: '2026-10-02', to: '2026-10-20' });
    expect(s.expense).toBe(10 + 5);
    expect(s.byDay).toEqual([
      { date: '2026-10-15', expense: 10 },
      { date: '2026-10-20', expense: 5 },
    ]);
  });

  it('an account filter drops History rows and other accounts', () => {
    const s = periodStats({ ...base, from: '2026-08-01', to: '2026-10-31', accountFilter: (id) => id === 'rub' });
    expect(s.expense).toBe(15);
    expect(s.income).toBe(0);
    expect(s.historyMonths).toEqual([]);
  });

  it('splits spending by tag, overall and inside each category', () => {
    const tagged = [
      tx({ id: 't1', type: 'expense', account_id: 'usd', amount: -30, amount_usd: -30, category_id: 'exp_food', tags: 'groceries', date: '2026-10-03' }),
      tx({ id: 't2', type: 'expense', account_id: 'usd', amount: -50, amount_usd: -50, category_id: 'exp_cafe', tags: 'bali, dinner', date: '2026-10-04' }),
      tx({ id: 't3', type: 'expense', account_id: 'usd', amount: -20, amount_usd: -20, category_id: 'exp_food', date: '2026-10-05' }),
      tx({ id: 't4', type: 'expense', account_id: 'usd', amount: -200, amount_usd: -200, category_id: 'exp_transport', tags: 'bali', date: '2026-10-06' }),
    ];
    const s = periodStats({ ...base, txs: tagged, from: '2026-10-01', to: '2026-10-31' });
    expect(Object.fromEntries(s.expenseByTag)).toEqual({ groceries: 30, bali: 250, dinner: 50 });
    expect(Object.fromEntries(s.categoryTags.get('exp_food')!)).toEqual({ groceries: 30, bali: 50, dinner: 50, '': 20 });
  });
});

describe('budget tone', () => {
  it('goes green → yellow → red as the budget is used up', async () => {
    const { budgetTone } = await import('./metrics');
    expect(budgetTone(100, 0)).toBe('none');
    expect(budgetTone(70, 100)).toBe('ok');
    expect(budgetTone(75, 100)).toBe('warn');
    expect(budgetTone(100, 100)).toBe('warn');
    expect(budgetTone(101, 100)).toBe('over');
  });
});

describe('business and investment spending', () => {
  it('stays out of the budgeted expenses', async () => {
    const { periodStats } = await import('./metrics');
    const cats = [category({ id: 'exp_food' }), category({ id: 'exp_soft', scope: 'business' })];
    const list = [
      tx({ id: 'a', type: 'expense', account_id: 'usd', amount: -30, amount_usd: -30, category_id: 'exp_food', date: '2026-10-03' }),
      tx({ id: 'b', type: 'expense', account_id: 'usd', amount: -99, amount_usd: -99, category_id: 'exp_soft', date: '2026-10-04' }),
    ];
    const s = periodStats({
      txs: list,
      history: [],
      categories: cats,
      rates: RATES,
      currencyOf,
      from: '2026-10-01',
      to: '2026-10-31',
      bucketOf: (t) => (t.category_id === 'exp_soft' ? 'business' : 'personal'),
    });
    expect(s.expense).toBe(30);
    expect(s.expenseByCategory.has('exp_soft')).toBe(false);
    expect(s.outside).toEqual({ business: 99, investment: 0, taxes: 0 });
    expect(s.outsideByCategory).toEqual([{ bucket: 'business', categoryId: 'exp_soft', usd: 99 }]);
  });
});
