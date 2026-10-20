import { describe, expect, it } from 'vitest';
import { debtBoards } from './debts';
import { tx } from './fixtures.test-utils';

describe('debt board', () => {
  const groups = new Map([
    ['biz', { group: 'business' as const }],
    ['card', { group: 'liquid' as const }],
    ['other', { group: 'debt' as const }],
    ['p', { group: 'debt' as const }],
  ]);
  it('follows the latest transfer with the person', () => {
    const txs = [
      tx({ id: '2', type: 'transfer', account_id: 'biz', amount: -10, to_account_id: 'p', to_amount: 10 }),
      tx({ id: '1', type: 'transfer', account_id: 'card', amount: -10, to_account_id: 'p', to_amount: 10 }),
    ];
    expect(debtBoards(txs, groups).get('p')).toBe('business');
  });
  it('skips transfers between people', () => {
    const txs = [tx({ id: '1', type: 'transfer', account_id: 'other', amount: -10, to_account_id: 'p', to_amount: 10 })];
    expect(debtBoards(txs, groups).has('p')).toBe(false);
  });
});
