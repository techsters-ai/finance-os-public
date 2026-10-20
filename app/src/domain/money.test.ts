import { describe, expect, it } from 'vitest';
import { applyKey, evaluate, formatMoney, parseAmount, prettyExpr, roundTo, type CalcKey } from './money';

function type(keys: string, maxDecimals = 2, allowNegative = false): string {
  let expr = '';
  for (const k of keys.split(' ')) expr = applyKey(expr, k as CalcKey, maxDecimals, allowNegative);
  return expr;
}

describe('roundTo', () => {
  it('rounds without float artifacts', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundTo(2.00004999, 4)).toBe(2);
    expect(roundTo(-0.001, 2)).toBe(0);
  });
});

describe('calculator', () => {
  it('adds and subtracts', () => {
    expect(evaluate('120+35.5-10')).toBe(145.5);
    expect(evaluate('0.1+0.2')).toBe(0.3);
    expect(evaluate('100+')).toBe(100);
    expect(evaluate('-50+20')).toBe(-30);
    expect(evaluate('')).toBeNull();
  });

  it('builds the expression from key presses', () => {
    expect(type('1 2 0 + 3 5 . 5 - 1 0')).toBe('120+35.5-10');
    expect(type('0 0 5')).toBe('5');
    expect(type('. 5')).toBe('0.5');
    expect(type('1 . 2 3 4')).toBe('1.23');
    expect(type('1 . 2 3 4 5 6', 4)).toBe('1.2345');
    expect(type('5 + -')).toBe('5-');
    expect(type('5 + back')).toBe('5');
    expect(type('+ 5')).toBe('5');
    expect(type('- 5')).toBe('5');
    expect(type('- 5', 2, true)).toBe('-5');
    expect(type('1 0 + 5 =')).toBe('15');
    expect(type('5 - 1 0 =')).toBe('');
    expect(type('5 - 1 0 =', 2, true)).toBe('-5');
  });

  it('pretty-prints the expression', () => {
    expect(prettyExpr('1200+35.5-10')).toBe('1,200 + 35.5 − 10');
  });
});

describe('formatting', () => {
  it('USD with a prefix, others with a symbol; whole amounts unless exact', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('$1,235');
    expect(formatMoney(1234.5, 'USD', { exact: true })).toBe('$1,234.50');
    expect(formatMoney(-1234.4, 'RUB')).toBe('−1,234 ₽');
    expect(formatMoney(-0.4, 'USD')).toBe('$0');
    expect(formatMoney(2.5, 'XAU')).toBe('2.5 oz');
    expect(formatMoney(0.3215, 'XAU')).toBe('0.3215 oz');
    expect(formatMoney(150000, 'TRY')).toBe('150,000 ₺');
    expect(formatMoney(10, 'USD', { signed: true })).toBe('+$10');
    expect(formatMoney(48213.7, 'USD', { whole: true })).toBe('$48,214');
    expect(formatMoney(48213.7, 'USD', { whole: true, compact: true })).toBe('$48.2K');
    expect(formatMoney(5550.4, 'USD', { whole: true, compact: true })).toBe('$5,550');
  });

  it('parses input', () => {
    expect(parseAmount('1,234.5')).toBe(1234.5);
    expect(parseAmount('1 234,5')).toBe(1234.5);
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount('−20')).toBe(-20);
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});
