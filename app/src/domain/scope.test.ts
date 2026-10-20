import { describe, expect, it } from 'vitest';
import { inScope, joinScopes, parseScopes } from './scope';

describe('category scope', () => {
  it('defaults to liquid', () => {
    expect(parseScopes('')).toEqual(['liquid']);
    expect(parseScopes('junk')).toEqual(['liquid']);
  });
  it('parses and orders a list', () => {
    expect(parseScopes('Investment, liquid,business')).toEqual(['liquid', 'business', 'investment']);
    expect(joinScopes(['investment', 'business'])).toBe('business, investment');
    expect(joinScopes(['liquid'])).toBe('');
  });
  it('a board shows its own categories; Total shows all', () => {
    expect(inScope({ scope: 'business' }, 'business')).toBe(true);
    expect(inScope({ scope: 'business' }, 'liquid')).toBe(false);
    expect(inScope({ scope: '' }, 'liquid')).toBe(true);
    expect(inScope({ scope: 'business' }, 'total')).toBe(true);
  });
});

describe('spend bucket', () => {
  it('owned categories are business or investment spending whoever pays', async () => {
    const { expenseBucket } = await import('./scope');
    expect(expenseBucket({ scope: 'business' }, 'liquid')).toBe('business');
    expect(expenseBucket({ scope: 'investment' }, 'business')).toBe('investment');
  });
  it('taxes are taxes whoever pays; a category shared by two boards follows the paying account', async () => {
    const { expenseBucket, isShared } = await import('./scope');
    const taxes = { scope: 'liquid, business, investment' };
    expect(isShared(taxes)).toBe(true);
    expect(expenseBucket(taxes, 'business')).toBe('taxes');
    expect(expenseBucket(taxes, 'investment')).toBe('taxes');
    expect(expenseBucket(taxes, 'credit')).toBe('taxes');
    expect(expenseBucket(taxes, 'liquid')).toBe('taxes');
    expect(expenseBucket({ scope: 'liquid, business' }, 'liquid')).toBe('personal');
    expect(expenseBucket({ scope: 'liquid, business' }, 'business')).toBe('business');
  });
  it('a personal category stays personal from a business account', async () => {
    const { expenseBucket } = await import('./scope');
    expect(expenseBucket({ scope: '' }, 'business')).toBe('personal');
  });
});

describe('records from an older version', () => {
  it('a category without scope reads as liquid', async () => {
    const { normalize } = await import('./normalize');
    const c = normalize('categories', { id: 'exp_food', name: 'Food', kind: 'expense' });
    expect(c.scope).toBe('');
    expect(parseScopes(undefined)).toEqual(['liquid']);
    expect(inScope({ scope: undefined as unknown as string }, 'liquid')).toBe(true);
  });
});
