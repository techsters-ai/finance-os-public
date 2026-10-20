import { describe, expect, it } from 'vitest';
import { moveTo, reorderSorts, sortSlots } from './order';

const items = (sorts: number[]) => sorts.map((sort, i) => ({ id: String.fromCharCode(97 + i), sort }));

describe('reordering coins', () => {
  it('moves an item to the target position', () => {
    expect(moveTo(items([1, 2, 3, 4]), 'a', 'c').map((x) => x.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTo(items([1, 2, 3, 4]), 'd', 'b').map((x) => x.id)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('reuses the same sort values, made strictly increasing', () => {
    expect(sortSlots([30, 10, 10, 20])).toEqual([10, 11, 20, 30]);
  });
  it('returns only the changed items with their new sort', () => {
    const changed = reorderSorts(items([10, 20, 30, 40]), 'a', 'c');
    expect(changed).toEqual([
      { id: 'b', sort: 10 },
      { id: 'c', sort: 20 },
      { id: 'a', sort: 30 },
    ]);
  });
});

describe('account order', () => {
  it('sections in turn (credit cards with liquid), then sort', async () => {
    const { byAccountOrder } = await import('./order');
    const { account } = await import('./fixtures.test-utils');
    const list = [
      account({ id: 'biz', currency: 'USD', group: 'business', sort: 1 }),
      account({ id: 'dep', currency: 'USD', group: 'investment', sort: 0 }),
      account({ id: 'cc', currency: 'USD', group: 'credit', sort: 2 }),
      account({ id: 'card', currency: 'USD', group: 'liquid', sort: 3 }),
      account({ id: 'cash', currency: 'USD', group: 'liquid', sort: 1 }),
      account({ id: 'alex', currency: 'USD', group: 'debt', sort: 0 }),
    ];
    expect(list.sort(byAccountOrder).map((a) => a.id)).toEqual(['cash', 'cc', 'card', 'dep', 'biz', 'alex']);
  });
});
