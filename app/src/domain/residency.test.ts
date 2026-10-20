import { describe, expect, it } from 'vitest';
import { countDays, countryCode, countryName, flagOf, pastYears, presenceDays, residencyOf, residencyRange, residencyStatus, residentTax, thresholdOf } from './residency';
import { account } from './fixtures.test-utils';
import type { TaxRate, Transaction } from './types';
import { cleanTaxRates } from '../data/db';
import { cleanCountries, normalizeLocation } from './normalize';
import type { LocationDay } from './types';

const day = (date: string, countries: string, over: Partial<LocationDay> = {}): LocationDay => ({
  id: `loc_${date}`,
  date,
  countries,
  city: '',
  source: 'manual',
  note: '',
  deleted: false,
  created_at: '',
  updated_at: '',
  server_ts: '',
  ...over,
});

// Portugal from Sep 13, then the flight to Bangkok on the 25th (both countries), Thailand since.
const trip = [day('2026-09-13', 'PT'), day('2026-09-25', 'PT TH'), day('2026-10-09', 'TH VN'), day('2026-10-12', 'VN TH')];

describe('tax residency days', () => {
  it('a day without a record is where the previous one ended; before the first record nothing counts', () => {
    const p = presenceDays(trip, '2026-09-10', '2026-09-27');
    expect(p[0]).toMatchObject({ date: '2026-09-13', countries: ['PT'], assumed: false });
    expect(p.find((d) => d.date === '2026-09-20')).toMatchObject({ countries: ['PT'], assumed: true });
    expect(p.find((d) => d.date === '2026-09-26')).toMatchObject({ countries: ['TH'], assumed: true });
    expect(p).toHaveLength(15);
  });

  it('a travel day counts for both countries; the window starts mid-stay from the day before it', () => {
    expect(countDays(trip, '2026-09-20', '2026-10-19')).toEqual([
      { country: 'TH', days: 23 }, // Sep 25 – Oct 9 (15) + Oct 12 – 19 (8)
      { country: 'PT', days: 6 }, // Sep 20 – 25
      { country: 'VN', days: 4 }, // Oct 9 – 12
    ]);
  });

  it('a deleted day is assumed again; a day set by hand overrides the assumption', () => {
    const edited = [...trip, day('2026-09-20', 'PT', { deleted: true }), day('2026-09-21', 'PT ES')];
    const p = presenceDays(edited, '2026-09-20', '2026-09-23');
    expect(p.map((d) => d.countries.join(' '))).toEqual(['PT', 'PT ES', 'ES', 'ES']);
    expect(p[0].assumed).toBe(true);
  });

  it('windows: since Jan 1, the 12 months up to today, last calendar year', () => {
    expect(residencyRange('ytd', '2026-10-19')).toEqual({ from: '2026-01-01', to: '2026-10-19' });
    expect(residencyRange('y1', '2026-10-19')).toEqual({ from: '2025-10-20', to: '2026-10-19' });
    expect(residencyRange('year', '2026-10-19')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(residencyRange('year', '2027-01-01', 2025)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    // On Jan 1, 2027 the past years are 2026 and 2025 (the first with days).
    expect(pastYears([day('2025-01-01', 'TH')], '2027-01-01')).toEqual([2026, 2025]);
    expect(pastYears([], '2026-10-19')).toEqual([2025]);
  });

  it('countries come in as clean codes, the last place last; flags and names', () => {
    expect(cleanCountries('pt, th pt x1')).toBe('TH PT');
    expect(normalizeLocation({ id: 'loc_2026-10-12', date: '2026-10-12T00:00:00.000Z', countries: 'vn th', deleted: 'FALSE' })).toMatchObject({
      date: '2026-10-12',
      countries: 'VN TH',
      deleted: false,
    });
    expect(flagOf('TH')).toBe('🇹🇭');
    expect(countryName('FR')).toBe('France');
  });

  it('the residency set in Settings; thresholds from the TaxRates rows, 183 (Thailand 180) without one', () => {
    expect(residencyOf({ tax_residency: 'th' })).toBe('TH');
    expect(residencyOf({ tax_residency: 'NONE' })).toBe('NONE');
    expect(residencyOf({ tax_residency: 'Thailand' })).toBe('');
    expect(residencyOf({})).toBe('');
    const rates = cleanTaxRates([
      { country: 'pt', domestic_income: '13–48%', threshold_days: '183', as_of: 2026 },
      { country: 'GE', threshold_days: '' },
      { country: '', domestic_income: 'no country' },
      null,
    ]);
    expect(rates.map((r) => [r.country, r.threshold_days, r.as_of])).toEqual([
      ['PT', 183, '2026'],
      ['GE', '', ''],
    ]);
    expect(thresholdOf('PT', [{ ...rates[0], threshold_days: 170 }])).toBe(170);
    expect(thresholdOf('GE', rates)).toBe(183);
    expect(thresholdOf('TH', rates)).toBe(180);
  });

  const rate = (over: Partial<TaxRate>): TaxRate => ({
    country: 'TH', domestic_income: '', foreign_income: '', capital_gains: '', residency_rule: '', threshold_days: '', window: 'year', foreign_rate: '', residency_tests: '', note: '', as_of: '', source: '', confidence: '', ...over,
  });

  it("each country against its own rule; today's country warned 14 days before, as the server does", () => {
    // Portugal Sep 1 – Dec 31, Thailand since Jan 1 (the server's test, apps-script.test.mjs).
    const log = [day('2025-09-01', 'PT'), day('2026-01-01', 'PT TH')];
    const rates = [rate({ country: 'TH', threshold_days: 180 }), rate({ country: 'PT', threshold_days: 183, window: '12m' })];
    const jan = residencyStatus(log, rates, '2026-01-10');
    expect(jan.rules.map((r) => [r.country, r.days, r.window]).sort()).toEqual([['PT', 123, '12m'], ['TH', 10, 'year']]);
    expect(jan.current).toBe('TH');
    expect(residencyStatus(log, rates, '2026-06-01').risk).toBeUndefined();
    expect(residencyStatus(log, rates, '2026-06-15').risk).toMatchObject({ country: 'TH', days: 166, left: 14 });
    // A calendar-year rule can't be met after the year is out: 169 days on Dec 25 need 14 more, 6 are left.
    expect(residencyStatus([day('2026-07-10', 'AM')], [], '2026-12-25').risk).toBeUndefined();
    expect(residencyStatus([day('2026-07-01', 'AM')], [], '2026-12-25').risk).toMatchObject({ days: 178, left: 5 });
  });

  it("accounts' countries as typed", () => {
    expect(['Portugal', 'UAE', 'United Kingdom', 'Global', 'PT', ''].map(countryCode)).toEqual(['PT', 'AE', 'GB', '', 'PT', '']);
  });

  it('resident tax: foreign income this year × the rate, less what is due where it was earned', () => {
    const accounts = [
      account({ id: 'th', currency: 'THB', country: 'Thailand' }),
      account({ id: 'biz', currency: 'KZT', country: 'Estonia', group: 'business' }),
      account({ id: 'dep', currency: 'TRY', country: 'Turkey' }),
      account({ id: 'wallet', currency: 'USD', country: 'Global' }),
    ];
    const tx = (id: string, account_id: string, type: Transaction['type'], amount_usd: number, date = '2026-05-06'): Transaction =>
      ({ id, account_id, type, amount_usd, date, deleted: false }) as Transaction;
    const transactions = [
      tx('a', 'biz', 'income', 5000),
      tx('b', 'dep', 'income', 1000),
      tx('b-tax', 'dep', 'expense', -100),
      tx('c', 'wallet', 'income', 500),
      tx('d', 'th', 'income', 700), // earned in Thailand: not foreign there
      tx('e', 'biz', 'income', 9000, '2025-12-06'), // last year
    ];
    const rules = [{ id: 'business', label: 'Business', owedUsd: 0, owed: { amount: 0, currency: 'KZT' }, periods: [{ key: '2026-Q2', accrued: 40000, marked: 0, owed: 0, owedUsd: 0 }, { key: '2025-Q4', accrued: 90000, marked: 0, owed: 0, owedUsd: 0 }] }];
    const p = { rates: [rate({ country: 'TH', foreign_rate: 0.2 }), rate({ country: 'EE', foreign_rate: 0.2 })], accounts, transactions, rules, toUsd: (a: number) => a / 400, now: '2026-10-20' };
    // Thailand: 6,500 foreign × 20% = 1,300, less 100 withheld in Turkey and 100 accrued in Estonia.
    expect(residentTax({ ...p, residency: 'TH' })).toEqual({ country: 'TH', rate: 0.2, foreignUsd: 6500, paidAbroadUsd: 200, owedUsd: 1100 });
    // Estonia: the business income is domestic, its tax isn't paid abroad.
    expect(residentTax({ ...p, residency: 'EE' })).toMatchObject({ foreignUsd: 2200, paidAbroadUsd: 100, owedUsd: 340 });
    expect(residentTax({ ...p, residency: 'NONE' })).toBeNull();
    expect(residentTax({ ...p, residency: 'GE' })).toMatchObject({ rate: null, owedUsd: 0 });
    // A rule with a country (the interest rule) is due there: paid abroad for Thailand, not for Turkey itself.
    const interest = { id: 'interest', label: 'Interest · TR', country: 'TR', owedUsd: 0, owed: { amount: 0, currency: 'TRY' }, periods: [{ key: '2026', accrued: 8000, marked: 0, owed: 0, owedUsd: 0 }] };
    expect(residentTax({ ...p, rules: [...rules, interest], residency: 'TH' })).toMatchObject({ paidAbroadUsd: 220, owedUsd: 1080 });
    expect(residentTax({ ...p, rules: [...rules, interest], residency: 'TR' })).toMatchObject({ paidAbroadUsd: 100 });
  });
});
