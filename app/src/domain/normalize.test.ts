import { describe, expect, it } from 'vitest';
import { isNewer, normalizeAccount, normalizeTransaction, toDate } from './normalize';

describe('normalizing records from the sheet', () => {
  it('strings and TRUE → numbers and booleans', () => {
    const a = normalizeAccount({
      id: 'a',
      currency: 'rub',
      opening_balance: '1 500,5',
      apr_gross: '0.135',
      insured_limit: '',
      risk_price: 3,
      in_emergency_fund: 'TRUE',
      archived: false,
    });
    expect(a.currency).toBe('RUB');
    expect(a.opening_balance).toBe(1500.5);
    expect(a.apr_gross).toBe(0.135);
    expect(a.insured_limit).toBe('');
    expect(a.risk_price).toBe(3);
    expect(a.risk_country).toBe('');
    expect(a.in_emergency_fund).toBe(true);
    expect(a.archived).toBe(false);
  });

  it('transaction with empty fields', () => {
    const t = normalizeTransaction({ id: 't', date: '2026-10-18', type: 'expense', amount: '-12.5', deleted: 'false' });
    expect(t.amount).toBe(-12.5);
    expect(t.to_amount).toBe('');
    expect(t.deleted).toBe(false);
  });

  it('dates', () => {
    expect(toDate('2026-10-18')).toBe('2026-10-18');
    expect(toDate('')).toBe('');
    const iso = new Date(2026, 9, 18, 0, 0, 0).toISOString();
    expect(toDate(iso)).toBe('2026-10-18');
  });

  it('comparing updated_at', () => {
    expect(isNewer('2026-10-18T10:00:01.000Z', '2026-10-18T10:00:00.000Z')).toBe(true);
    expect(isNewer('2026-10-18T10:00:00.000Z', '2026-10-18T10:00:00.000Z')).toBe(false);
    expect(isNewer('2026-10-18T10:00:00.000Z', '')).toBe(true);
    expect(isNewer('', '2026-10-18T10:00:00.000Z')).toBe(false);
  });
});
