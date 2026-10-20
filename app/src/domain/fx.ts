// Rates: rates[c] = how many USD 1 unit of currency c is worth.
import type { Rates } from './types';
import { roundMoney } from './money';

export function rateOf(currency: string, rates: Rates): number | undefined {
  if (currency === 'USD') return 1;
  const r = rates[currency];
  return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : undefined;
}

export function hasRate(currency: string, rates: Rates): boolean {
  return rateOf(currency, rates) !== undefined;
}

/** Amount in USD, or undefined if there is no rate. */
export function toUsd(amount: number, currency: string, rates: Rates): number | undefined {
  const r = rateOf(currency, rates);
  return r === undefined ? undefined : amount * r;
}

/** Converts between currencies via USD, without rounding. */
export function convertRaw(amount: number, from: string, to: string, rates: Rates): number | undefined {
  if (from === to) return amount;
  const rf = rateOf(from, rates);
  const rt = rateOf(to, rates);
  if (rf === undefined || rt === undefined) return undefined;
  return (amount * rf) / rt;
}

/** Converts and rounds to the target currency. */
export function convert(amount: number, from: string, to: string, rates: Rates): number | undefined {
  const v = convertRaw(amount, from, to, rates);
  return v === undefined ? undefined : roundMoney(v, to);
}

/** Units of `to` per 1 `from` (for a label like "1 € = 98.4 ₽"). */
export function crossRate(from: string, to: string, rates: Rates): number | undefined {
  return convertRaw(1, from, to, rates);
}
