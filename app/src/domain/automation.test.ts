import { describe, expect, it } from 'vitest';
import { defaultStart, estimate, nextDue } from './automation';
import { account } from './fixtures.test-utils';

describe('automations', () => {
  it('the next monthly accrual and the days it covers', () => {
    const deposit = { frequency: 'monthly' as const, day: 28, start_date: '2026-10-28' };
    expect(nextDue(deposit, '2026-10-19')).toEqual({ date: '2026-10-28', days: 30 });
    expect(nextDue(deposit, '2026-10-29')).toEqual({ date: '2026-11-28', days: 31 });
    expect(nextDue({ frequency: 'monthly', day: 31, start_date: '' }, '2027-02-10')).toEqual({ date: '2027-02-28', days: 28 });
    expect(nextDue({ frequency: 'daily', day: '', start_date: '2026-10-20' }, '2026-10-19')).toEqual({ date: '2026-10-20', days: 1 });
    // Weekly from Wednesday Oct 14: the next Wednesday on or after today.
    expect(nextDue({ frequency: 'weekly', day: '', start_date: '2026-10-14' }, '2026-10-19')).toEqual({ date: '2026-10-21', days: 7 });
    expect(nextDue({ frequency: 'weekly', day: '', start_date: '2026-10-14' }, '2026-10-21')).toEqual({ date: '2026-10-21', days: 7 });
    // Yearly on Feb 29: Feb 28 in other years.
    expect(nextDue({ frequency: 'yearly', day: '', start_date: '2024-02-29' }, '2026-10-19')).toEqual({ date: '2027-02-28', days: 365 });
  });
  it("estimates at the balance, the card's rate and the days", () => {
    const dep = account({ id: 'd', currency: 'RUB', apr_gross: 0.1369 });
    expect(estimate(dep, 1_500_000, 30)).toBe(16878.08);
    expect(estimate(account({ id: 'x', currency: 'USD' }), 1000, 1)).toBe(0);
  });
  it('a new daily rule starts tomorrow; a monthly one on its next day', () => {
    expect(defaultStart('daily', 1, '2026-10-19')).toBe('2026-10-20');
    expect(defaultStart('monthly', 28, '2026-10-19')).toBe('2026-10-28');
    expect(defaultStart('monthly', 5, '2026-10-19')).toBe('2026-11-05');
  });
});
