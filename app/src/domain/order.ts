// Reordering items that carry a numeric `sort`, and the order of accounts.
import type { Account, AccountGroup } from './types';

/**
 * The order of accounts everywhere: these sections in turn (the Accounts screen top to bottom, the board left to
 * right), `sort` within one. Credit cards share Liquid's section, so one can stand anywhere among liquid accounts.
 */
export const ACCOUNT_SECTIONS: { id: string; groups: AccountGroup[] }[] = [
  { id: 'liquid', groups: ['liquid', 'credit'] },
  { id: 'investment', groups: ['investment'] },
  { id: 'business', groups: ['business'] },
  { id: 'debt', groups: ['debt'] },
];

export function sectionOf(group: AccountGroup): number {
  const i = ACCOUNT_SECTIONS.findIndex((s) => s.groups.includes(group));
  return i < 0 ? ACCOUNT_SECTIONS.length : i;
}

export function byAccountOrder(a: Account, b: Account): number {
  return sectionOf(a.group) - sectionOf(b.group) || (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name);
}

/** Moves `srcId` to the position `targetId` holds; the others shift. */
export function moveTo<T extends { id: string }>(list: T[], srcId: string, targetId: string): T[] {
  const from = list.findIndex((x) => x.id === srcId);
  const to = list.findIndex((x) => x.id === targetId);
  if (from < 0 || to < 0 || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * The sort values to hand out to a reordered list: the same values it had, ascending and made strictly
 * increasing, so items outside the list keep their place around it.
 */
export function sortSlots(values: number[]): number[] {
  const out = [...values].map((v) => (Number.isFinite(v) ? v : 0)).sort((a, b) => a - b);
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 1;
  return out;
}

/** New sort values after moving `srcId` onto `targetId`: only the items whose sort changes. */
export function reorderSorts<T extends { id: string; sort: number }>(list: T[], srcId: string, targetId: string): T[] {
  const before = new Map(list.map((x) => [x.id, x.sort]));
  const slots = sortSlots(list.map((x) => x.sort));
  return moveTo(list, srcId, targetId)
    .map((x, i) => ({ ...x, sort: slots[i] }))
    .filter((x) => x.sort !== before.get(x.id));
}
