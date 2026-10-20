// Category scope: which boards (liquid, business, investment) show a category's coin.
import type { Category } from './types';

export type CategoryScope = 'liquid' | 'business' | 'investment';
export const SCOPES: CategoryScope[] = ['liquid', 'business', 'investment'];

/** 'business, investment' → ['business', 'investment']; unknown words dropped; nothing = ['liquid']. */
export function parseScopes(raw: string | undefined): CategoryScope[] {
  const set = new Set(
    String(raw ?? '')
      .toLowerCase()
      .split(/[,\s]+/)
      .filter((x): x is CategoryScope => (SCOPES as string[]).includes(x)),
  );
  return set.size ? SCOPES.filter((s) => set.has(s)) : ['liquid'];
}

/** The canonical stored form; plain 'liquid' is stored as '' (the default). */
export function joinScopes(list: CategoryScope[]): string {
  const ordered = SCOPES.filter((s) => list.includes(s));
  return ordered.length === 1 && ordered[0] === 'liquid' ? '' : ordered.join(', ');
}

/** Whether a board shows this category; the Total board shows every category. */
export function inScope(c: Pick<Category, 'scope'>, board: CategoryScope | 'total'): boolean {
  return board === 'total' || parseScopes(c.scope).includes(board);
}

/** On every board: such a category (Taxes) sits in the shared row next to Debts, not in a board's grid. */
export function isShared(c: Pick<Category, 'scope'>): boolean {
  return parseScopes(c.scope).length === SCOPES.length;
}

/**
 * Whose spending an expense is: the personal budget; business / investment costs; or taxes (a category on every
 * board, whoever pays: the sheet shows them by accrual). Only personal is budgeted.
 */
export type SpendBucket = 'personal' | 'business' | 'investment' | 'taxes';

/**
 * A category on every board (Taxes) is taxes whoever pays; one owned by business or investments (Software, Fees) is
 * that spending whoever pays; one shared with Liquid follows the paying account's group; a personal category (Food)
 * stays personal even when a business account pays for it. Pass the top-level category: subcategories follow it.
 */
export function expenseBucket(c: Pick<Category, 'scope'> | undefined, accountGroup: string | undefined): SpendBucket {
  const s = parseScopes(c?.scope ?? '');
  if (s.length === SCOPES.length) return 'taxes';
  if (!s.includes('liquid')) return s[0] === 'investment' ? 'investment' : 'business';
  if (accountGroup === 'business' || accountGroup === 'investment') return s.length > 1 ? accountGroup : 'personal';
  return 'personal';
}

/** Categories whose budget counts on Home: personal ones (a category on every board is outside the budget). */
export function isBudgeted(c: Pick<Category, 'scope'>): boolean {
  return parseScopes(c.scope).includes('liquid') && !isShared(c);
}
