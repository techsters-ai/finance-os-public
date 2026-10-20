import { describe, expect, it } from 'vitest';
import {
  adjustmentCategory,
  buildAdjustment,
  interestRecorded,
  reconcileCandidates,
  reconcileDelta,
  reconcileReminderDue,
} from './reconcile';
import { NOW, RATES, account } from './fixtures.test-utils';

describe('reconciliation', () => {
  it('adjustment category by account type', () => {
    expect(adjustmentCategory('stocks')).toBe('sys_revaluation');
    expect(adjustmentCategory('crypto')).toBe('sys_revaluation');
    expect(adjustmentCategory('commodity')).toBe('sys_revaluation');
    expect(adjustmentCategory('deposit')).toBe('inc_interest');
    expect(adjustmentCategory('flexible')).toBe('inc_interest');
    expect(adjustmentCategory('card')).toBe('sys_correction');
    expect(adjustmentCategory('cash')).toBe('sys_correction');
    expect(adjustmentCategory('credit')).toBe('sys_correction');
  });

  it("a deposit whose interest is recorded otherwise: the difference is a correction with no category, not interest", () => {
    const auto = { kind: 'interest', account_id: 'hy', active: true, deleted: false };
    expect(interestRecorded(account({ id: 'hy', currency: 'USD', type: 'flexible' }), [auto])).toBe(true);
    expect(interestRecorded(account({ id: 'dep', currency: 'GEL', type: 'deposit', interest_to: 'card' }), [])).toBe(true);
    expect(interestRecorded(account({ id: 'sav', currency: 'RUB', type: 'flexible' }), [{ ...auto, active: false }])).toBe(false);
    expect(adjustmentCategory('flexible', true)).toBe('');
    expect(adjustmentCategory('card', true)).toBe('sys_correction');
    const hy = account({ id: 'hy', currency: 'USD', type: 'flexible' });
    expect(buildAdjustment(hy, 845, { id: 'x', now: NOW, date: '2026-10-14', rates: RATES, interestRecorded: true }).category_id).toBe('');
  });

  it('a zero difference still creates a 0 adjustment noted "Reconciliation"', () => {
    const a = account({ id: 'a', currency: 'USD' });
    expect(reconcileDelta(100.004, 100, 'USD')).toBe(0);
    const adj = buildAdjustment(a, 0, { id: 'x', now: NOW, date: '2026-10-01', rates: RATES });
    expect(adj).toMatchObject({ type: 'adjustment', amount: 0, amount_usd: 0, note: 'Reconciliation', category_id: 'sys_correction' });
  });

  it('gold revaluation in ounces and USD', () => {
    const gold = account({ id: 'g', currency: 'XAU', group: 'investment', type: 'commodity', opening_balance: 2 });
    const delta = reconcileDelta(2, 2.0512, 'XAU');
    expect(delta).toBe(0.0512);
    const adj = buildAdjustment(gold, delta, { id: 'x', now: NOW, date: '2026-10-01', rates: RATES });
    expect(adj.category_id).toBe('sys_revaluation');
    expect(adj.amount).toBe(0.0512);
    expect(adj.usd_rate).toBe(4166);
    expect(adj.amount_usd).toBe(213.3);
  });

  it('deposit interest', () => {
    const dep = account({ id: 'd', currency: 'RUB', type: 'deposit', group: 'investment' });
    const adj = buildAdjustment(dep, 987.65, { id: 'x', now: NOW, date: '2026-10-01', rates: RATES });
    expect(adj.category_id).toBe('inc_interest');
    expect(adj.amount).toBe(987.65);
  });

  it('monthly wizard: all unarchived, investment → liquid → credit', () => {
    const list = reconcileCandidates([
      account({ id: 'card', currency: 'USD', type: 'card', sort: 1 }),
      account({ id: 'cc', currency: 'USD', group: 'credit', type: 'credit' }),
      account({ id: 'flex', currency: 'RUB', type: 'flexible', sort: 2 }),
      account({ id: 'brk', currency: 'USD', group: 'investment', type: 'stocks', sort: 2 }),
      account({ id: 'gold', currency: 'XAU', group: 'investment', type: 'commodity', sort: 1 }),
      account({ id: 'arch', currency: 'USD', group: 'investment', type: 'stocks', archived: true }),
    ]).map((a) => a.id);
    expect(list).toEqual(['gold', 'brk', 'card', 'flex', 'cc']);
  });

  it('reminder from the 1st to the 7th until the month is reconciled', () => {
    expect(reconcileReminderDue('2026-10-01', [])).toBe(true);
    expect(reconcileReminderDue('2026-10-07', [])).toBe(true);
    expect(reconcileReminderDue('2026-10-08', [])).toBe(false);
    expect(reconcileReminderDue('2026-10-03', ['2026-10'])).toBe(false);
    expect(reconcileReminderDue('2026-11-02', ['2026-10'])).toBe(true);
  });
});
