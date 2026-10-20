import { describe, expect, it } from 'vitest';
import { convert, crossRate, toUsd } from './fx';
import { RATES } from './fixtures.test-utils';

describe('rates', () => {
  it('XAU: ounces → USD', () => {
    expect(toUsd(2, 'XAU', RATES)).toBe(8332);
    expect(toUsd(0.5, 'XAU', RATES)).toBe(2083);
  });

  it('USD → XAU and back', () => {
    expect(convert(4166, 'USD', 'XAU', RATES)).toBe(1);
    expect(convert(1000, 'USD', 'XAU', RATES)).toBe(0.24);
    expect(convert(0.24, 'XAU', 'USD', RATES)).toBe(999.84);
  });

  it('cross rate via USD', () => {
    expect(convert(1000, 'RUB', 'USD', RATES)).toBe(12.5);
    expect(convert(100, 'USD', 'RUB', RATES)).toBe(8000);
    expect(convert(10, 'EUR', 'RUB', RATES)).toBe(864);
    expect(crossRate('EUR', 'RUB', RATES)).toBeCloseTo(86.4, 10);
  });

  it('no rate → undefined', () => {
    expect(toUsd(10, 'BRL', RATES)).toBeUndefined();
    expect(convert(10, 'BRL', 'USD', RATES)).toBeUndefined();
    expect(convert(10, 'BRL', 'BRL', RATES)).toBe(10);
  });
});
