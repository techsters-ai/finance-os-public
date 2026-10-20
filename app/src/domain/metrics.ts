// Metrics: spending by category, income, budgets, period analytics.
import type { Category, HistoryRow, Rates, Transaction } from './types';
import { roundTo } from './money';
import { toUsd } from './fx';
import { monthsInRange } from './dates';
import { parseTags } from './tags';
import type { SpendBucket } from './scope';

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * USD value of a transaction: the stored amount_usd (rate at entry time),
 * otherwise the account currency converted at the current rate.
 */
export function txUsd(tx: Transaction, rates: Rates, currencyOf: (accountId: string) => string | undefined): number {
  if (typeof tx.amount_usd === 'number' && Number.isFinite(tx.amount_usd)) return tx.amount_usd;
  if (typeof tx.usd_rate === 'number' && tx.usd_rate > 0) return tx.amount * tx.usd_rate;
  const cur = currencyOf(tx.account_id);
  return (cur && toUsd(tx.amount, cur, rates)) || 0;
}

/** Month spending by category, positive USD. Only type = expense counts. */
export function monthSpendingByCategory(
  txs: Transaction[],
  month: string,
  rates: Rates,
  currencyOf: (accountId: string) => string | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of txs) {
    if (t.deleted || t.type !== 'expense' || monthOf(t.date) !== month) continue;
    const spent = -txUsd(t, rates, currencyOf);
    out.set(t.category_id, (out.get(t.category_id) ?? 0) + spent);
  }
  for (const [k, v] of out) out.set(k, roundTo(v, 2));
  return out;
}

/** Subcategory sums are added to their parent. */
export function rollUpToParents(byCategory: Map<string, number>, categories: Category[]): Map<string, number> {
  const parentOf = new Map(categories.map((c) => [c.id, c.parent_id]));
  const out = new Map<string, number>();
  for (const [id, v] of byCategory) {
    const key = parentOf.get(id) || id;
    out.set(key, roundTo((out.get(key) ?? 0) + v, 2));
  }
  return out;
}

export interface MonthTotals {
  expense: number;
  income: number;
}

/** Month expenses (expense) and income (income) in USD. Transfers and adjustments are excluded. */
export function monthTotals(
  txs: Transaction[],
  month: string,
  rates: Rates,
  currencyOf: (accountId: string) => string | undefined,
): MonthTotals {
  let expense = 0;
  let income = 0;
  for (const t of txs) {
    if (t.deleted || monthOf(t.date) !== month) continue;
    if (t.type === 'expense') expense -= txUsd(t, rates, currencyOf);
    else if (t.type === 'income') income += txUsd(t, rates, currencyOf);
  }
  return { expense: roundTo(expense, 2), income: roundTo(income, 2) };
}

/** How far into a budget the spending is: ok below 75%, warn up to 100%, over above it; none without a budget. */
export function budgetTone(spent: number, budget: number): 'none' | 'ok' | 'warn' | 'over' {
  if (!(budget > 0)) return 'none';
  const share = spent / budget;
  return share > 1 ? 'over' : share >= 0.75 ? 'warn' : 'ok';
}

/** Sum of monthly budgets of active expense categories. */
export function budgetTotal(categories: Category[]): number {
  let sum = 0;
  for (const c of categories) {
    if (c.archived || c.kind !== 'expense') continue;
    if (typeof c.budget_usd === 'number') sum += c.budget_usd;
  }
  return roundTo(sum, 2);
}

// ── Period analytics ────────────────────────────────────────

export interface MonthPoint {
  month: string;
  income: number;
  expense: number;
}

export interface PeriodStats {
  income: number;
  expense: number;
  /** Positive USD by top-level category. */
  expenseByCategory: Map<string, number>;
  incomeByCategory: Map<string, number>;
  /** Every month of the range, oldest first. */
  byMonth: MonthPoint[];
  /** Daily spending of the range (transactions only), oldest first. */
  byDay: { date: string; expense: number }[];
  /** Months whose numbers come from the History sheet (monthly totals, no transactions). */
  historyMonths: string[];
  /** Positive USD by tag (transactions only; a transaction counts toward each of its tags). */
  expenseByTag: Map<string, number>;
  incomeByTag: Map<string, number>;
  /** Inside each top-level category: positive USD by tag, '' = untagged. Transactions only. */
  categoryTags: Map<string, Map<string, number>>;
  /** Business and investment spending (with `bucketOf`): kept out of every number above. */
  outside: { business: number; investment: number; taxes: number };
  /** The same by top-level category, largest first. */
  outsideByCategory: { bucket: Exclude<SpendBucket, 'personal'>; categoryId: string; usd: number }[];
}

export interface PeriodInput {
  txs: Transaction[];
  /** History sheet rows; ignored when accountFilter is set (they have no account). */
  history: HistoryRow[];
  categories: Category[];
  /** Inclusive 'YYYY-MM-DD'. */
  from: string;
  to: string;
  rates: Rates;
  currencyOf: (accountId: string) => string | undefined;
  accountFilter?: (accountId: string) => boolean;
  /** Splits off business and investment expenses (not budgeted); without it every expense counts. */
  bucketOf?: (t: Transaction) => SpendBucket;
}

/**
 * Income and expenses of a date range in USD. Transactions are counted by date; History rows
 * by month, for every month the range touches that has no income or expense transactions at all
 * (a month with transactions, e.g. imported from another app, ignores the old monthly totals).
 */
export function periodStats(p: PeriodInput): PeriodStats {
  const byId = new Map(p.categories.map((c) => [c.id, c]));
  const top = (id: string) => byId.get(id)?.parent_id || id;
  const months = monthsInRange(p.from, p.to);
  const monthIdx = new Map(months.map((m, i) => [m, i]));
  const byMonth: MonthPoint[] = months.map((month) => ({ month, income: 0, expense: 0 }));
  const expenseBy = new Map<string, number>();
  const incomeBy = new Map<string, number>();
  const days = new Map<string, number>();
  const historyMonths = new Set<string>();
  const expenseByTag = new Map<string, number>();
  const incomeByTag = new Map<string, number>();
  const categoryTags = new Map<string, Map<string, number>>();
  const outside = { business: 0, investment: 0, taxes: 0 };
  const outsideBy = new Map<string, number>();
  const add = (map: Map<string, number>, k: string, v: number) => map.set(k, (map.get(k) ?? 0) + v);

  for (const t of p.txs) {
    if (t.deleted || t.date < p.from || t.date > p.to) continue;
    if (t.type !== 'expense' && t.type !== 'income') continue;
    if (p.accountFilter && !p.accountFilter(t.account_id)) continue;
    const usd = txUsd(t, p.rates, p.currencyOf);
    const bucket = t.type === 'expense' && p.bucketOf ? p.bucketOf(t) : 'personal';
    if (bucket !== 'personal') {
      outside[bucket] -= usd;
      add(outsideBy, `${bucket}|${top(t.category_id)}`, -usd);
      continue;
    }
    const point = byMonth[monthIdx.get(monthOf(t.date)) ?? -1];
    const value = t.type === 'expense' ? -usd : usd;
    const cat = top(t.category_id);
    const inner = categoryTags.get(cat) ?? new Map<string, number>();
    categoryTags.set(cat, inner);
    const tags = parseTags(t.tags ?? '');
    if (!tags.length) add(inner, '', value);
    for (const tag of tags) {
      add(inner, tag, value);
      add(t.type === 'expense' ? expenseByTag : incomeByTag, tag, value);
    }
    if (t.type === 'expense') {
      add(expenseBy, top(t.category_id), -usd);
      add(days, t.date, -usd);
      if (point) point.expense -= usd;
    } else {
      add(incomeBy, top(t.category_id), usd);
      if (point) point.income += usd;
    }
  }

  if (!p.accountFilter) {
    const txMonths = new Set<string>();
    for (const t of p.txs) {
      if (!t.deleted && (t.type === 'expense' || t.type === 'income')) txMonths.add(monthOf(t.date));
    }
    for (const h of p.history) {
      const point = byMonth[monthIdx.get(h.month) ?? -1];
      if (!point || !Number.isFinite(h.amount_usd) || txMonths.has(h.month)) continue;
      const kind = byId.get(h.category_id)?.kind ?? (h.amount_usd < 0 ? 'expense' : 'income');
      if (kind === 'expense') {
        add(expenseBy, top(h.category_id), -h.amount_usd);
        point.expense -= h.amount_usd;
      } else if (kind === 'income') {
        add(incomeBy, top(h.category_id), h.amount_usd);
        point.income += h.amount_usd;
      } else continue;
      historyMonths.add(h.month);
    }
  }

  const round = (m: Map<string, number>) => {
    for (const [k, v] of m) {
      const r = roundTo(v, 2);
      if (r === 0) m.delete(k);
      else m.set(k, r);
    }
    return m;
  };
  for (const pt of byMonth) {
    pt.income = roundTo(pt.income, 2);
    pt.expense = roundTo(pt.expense, 2);
  }
  return {
    income: roundTo(byMonth.reduce((s, x) => s + x.income, 0), 2),
    expense: roundTo(byMonth.reduce((s, x) => s + x.expense, 0), 2),
    expenseByCategory: round(expenseBy),
    incomeByCategory: round(incomeBy),
    byMonth,
    byDay: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, expense: roundTo(v, 2) })),
    historyMonths: [...historyMonths].sort(),
    expenseByTag: round(expenseByTag),
    incomeByTag: round(incomeByTag),
    categoryTags: new Map([...categoryTags].map(([k, m]) => [k, round(m)])),
    outside: { business: roundTo(outside.business, 2), investment: roundTo(outside.investment, 2), taxes: roundTo(outside.taxes, 2) },
    outsideByCategory: [...round(outsideBy)]
      .map(([k, usd]) => {
        const [bucket, categoryId] = k.split('|') as [Exclude<SpendBucket, 'personal'>, string];
        return { bucket, categoryId, usd };
      })
      .sort((a, b) => b.usd - a.usd),
  };
}
