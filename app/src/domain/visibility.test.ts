import { describe, expect, it } from 'vitest';
import { isHiddenAccount } from './visibility';
import { account } from './fixtures.test-utils';

describe('account visibility', () => {
  const card = account({ id: 'c', currency: 'USD' });
  it('auto hides a zero balance only', () => {
    expect(isHiddenAccount(card, 0)).toBe(true);
    expect(isHiddenAccount(card, 12)).toBe(false);
    expect(isHiddenAccount(card, -3)).toBe(false);
  });
  it('a paid-off credit card stays visible', () => {
    expect(isHiddenAccount({ ...card, type: 'credit' }, 0)).toBe(false);
  });
  it('show and hide override the balance', () => {
    expect(isHiddenAccount({ ...card, visibility: 'show' }, 0)).toBe(false);
    expect(isHiddenAccount({ ...card, visibility: 'hide' }, 500)).toBe(true);
  });
});
