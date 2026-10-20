import { describe, expect, it } from 'vitest';
import { shortId, uuid } from './ids';

describe('ids for new entities', () => {
  it('transaction: full uuid v4', () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('account and category: prefix + short uuid', () => {
    expect(shortId('acc')).toMatch(/^acc_[0-9a-f]{10}$/);
    expect(shortId('exp')).toMatch(/^exp_[0-9a-f]{10}$/);
    expect(shortId('inc')).toMatch(/^inc_[0-9a-f]{10}$/);
  });
});
