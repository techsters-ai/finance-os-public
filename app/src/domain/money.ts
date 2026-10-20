// Money: rounding, formatting, calculator expressions.

export const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CNY', 'CAD', 'AUD', 'SGD', 'HKD', 'AED', 'TRY', 'RUB', 'INR', 'BRL', 'MXN', 'THB',
  'GEL', 'KZT', 'USDT', 'USDC', 'XAU',
] as const;

const SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CHF: 'CHF',
  JPY: '¥',
  CNY: 'CN¥',
  CAD: 'CA$',
  AUD: 'A$',
  SGD: 'S$',
  HKD: 'HK$',
  AED: 'AED',
  TRY: '₺',
  RUB: '₽',
  INR: '₹',
  BRL: 'R$',
  MXN: 'MX$',
  THB: '฿',
  GEL: '₾',
  KZT: '₸',
  USDT: 'USDT',
  USDC: 'USDC',
  XAU: 'oz',
};

export const CURRENCY_NAMES: Record<string, string> = {
  USD: 'US dollar',
  EUR: 'Euro',
  GBP: 'British pound',
  CHF: 'Swiss franc',
  JPY: 'Japanese yen',
  CNY: 'Chinese yuan',
  CAD: 'Canadian dollar',
  AUD: 'Australian dollar',
  SGD: 'Singapore dollar',
  HKD: 'Hong Kong dollar',
  AED: 'UAE dirham',
  TRY: 'Turkish lira',
  RUB: 'Russian ruble',
  INR: 'Indian rupee',
  BRL: 'Brazilian real',
  MXN: 'Mexican peso',
  THB: 'Thai baht',
  GEL: 'Georgian lari',
  KZT: 'Kazakh tenge',
  USDT: 'Tether (USDT)',
  USDC: 'USD Coin (USDC)',
  XAU: 'Gold, troy ounce',
};

/** Decimal places stored for a currency. */
export function decimals(currency: string): number {
  return currency === 'XAU' ? 4 : 2;
}


export function symbolOf(currency: string): string {
  return SYMBOLS[currency] ?? currency;
}

/** Symmetric rounding to d places without float artifacts (1.005 → 1.01). */
export function roundTo(value: number, d = 2): number {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  let r = Number(`${Math.round(Number(`${abs}e${d}`))}e-${d}`);
  if (!Number.isFinite(r)) r = Math.round(abs * 10 ** d) / 10 ** d;
  return r === 0 ? 0 : sign * r;
}

export function roundMoney(value: number, currency: string): number {
  return roundTo(value, decimals(currency));
}

const MINUS = '−';

function formatNumber(value: number, minFrac: number, maxFrac: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
  }).format(Math.abs(value));
}

export interface FormatOptions {
  /** Show '+' on positive values. */
  signed?: boolean;
  /** No cents. Amounts are whole by default anyway; kept for call sites that say so explicitly. */
  whole?: boolean;
  /** Show cents (entry and reconciliation, where the exact amount matters). */
  exact?: boolean;
  /** Short form for tiles: $1.2k, $35k, $1.4M. */
  compact?: boolean;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.abs(value));
}

/**
 * Whole amounts by default: $1,235 · 1,235 ₽. exact adds the cents: $1,234.50. Gold keeps its fraction: 0.3215 oz.
 */
export function formatMoney(value: number, currency: string, opts: FormatOptions = {}): string {
  let minFrac = 0;
  let maxFrac = 0;
  if (currency === 'XAU') maxFrac = opts.whole ? 0 : decimals(currency);
  else if (opts.exact) minFrac = maxFrac = decimals(currency);
  const rounded = roundTo(value, maxFrac);
  const num = opts.compact && Math.abs(rounded) >= 10_000 ? compactNumber(rounded) : formatNumber(rounded, minFrac, maxFrac);
  const sign = rounded < 0 ? MINUS : opts.signed && rounded > 0 ? '+' : '';
  if (currency === 'USD') return `${sign}$${num}`;
  return `${sign}${num} ${symbolOf(currency)}`;
}

/** Rate: 88.13 · 1.084 · 0.0123 · 0.0000792 */
export function formatRate(x: number): string {
  if (!Number.isFinite(x)) return '—';
  const abs = Math.abs(x);
  const opts: Intl.NumberFormatOptions =
    abs >= 10
      ? { maximumFractionDigits: 2 }
      : abs >= 1
        ? { maximumFractionDigits: 4 }
        : { maximumSignificantDigits: 3 };
  return new Intl.NumberFormat('en-US', opts).format(x);
}

/** '1 € = 88.13 ₽' */
export function rateLine(from: string, to: string, x: number): string {
  return `1 ${symbolOf(from)} = ${formatRate(x)} ${symbolOf(to)}`;
}

export function formatUsd(value: number, opts: FormatOptions = {}): string {
  return formatMoney(value, 'USD', opts);
}

/** 42% · 4.7% (one decimal below 10%). */
export function formatPct(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  const pct = ratio * 100;
  return `${Math.abs(pct) < 10 && pct !== 0 ? pct.toFixed(1) : Math.round(pct)}%`;
}

/**
 * Parses a number typed by a person: '1,234.5', '−20', '1.5', and '1,5' (comma as the
 * decimal separator, as some iOS keyboards type it).
 */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (input == null) return null;
  let s = String(input)
    .trim()
    .replace(/[\s  ]/g, '')
    .replace(MINUS, '-');
  s = s.includes('.') ? s.replace(/,/g, '') : s.replace(',', '.');
  if (s === '' || s === '-' || s === '.') return null;
  if (!/^-?\d*\.?\d*$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ── Calculator ──────────────────────────────────────────────
// The expression is a string of digits, '.', '+' and '-'. Example: '120+35.5-10'.

export const OPERATORS = ['+', '-'] as const;

function isOp(ch: string | undefined): boolean {
  return ch === '+' || ch === '-';
}

/** The current (last) number in the expression. */
function lastOperand(expr: string): string {
  const m = expr.match(/[\d.]*$/);
  return m ? m[0] : '';
}

/** Evaluates the expression. A trailing operator is ignored. */
export function evaluate(expr: string): number | null {
  let s = expr.replace(/\s/g, '').replace(/,/g, '.').replace(new RegExp(MINUS, 'g'), '-');
  while (s.length && isOp(s[s.length - 1])) s = s.slice(0, -1);
  if (s === '') return null;
  const tokens = s.match(/[+-]?[^+-]+/g);
  if (!tokens || tokens.join('') !== s) return null;
  let total = 0;
  for (const t of tokens) {
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    total += n;
  }
  return roundTo(total, 8);
}

export function hasOperator(expr: string): boolean {
  return /[\d.][+-]/.test(expr);
}

export type CalcKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | '+' | '-' | 'back' | '=';

/**
 * Applies a key press to the expression.
 * maxDecimals limits the decimals of the current number.
 * allowNegative lets the expression start with a minus (adjustments, reconciliation).
 */
export function applyKey(expr: string, key: CalcKey, maxDecimals = 2, allowNegative = false): string {
  if (key === 'back') return expr.slice(0, -1);
  if (key === '=') {
    const v = evaluate(expr);
    if (v == null) return expr;
    const r = roundTo(v, maxDecimals);
    if (r < 0 && !allowNegative) return '';
    return r === 0 ? '' : String(r);
  }
  if (isOp(key)) {
    if (expr === '') return key === '-' && allowNegative ? '-' : '';
    const last = expr[expr.length - 1];
    if (isOp(last)) {
      if (expr.length === 1) return key === '-' ? '-' : '';
      return expr.slice(0, -1) + key;
    }
    if (last === '.') return expr.slice(0, -1) + key;
    return expr + key;
  }
  const operand = lastOperand(expr);
  if (key === '.') {
    if (maxDecimals === 0 || operand.includes('.')) return expr;
    return expr + (operand === '' ? '0.' : '.');
  }
  // digit
  if (operand.includes('.')) {
    const frac = operand.split('.')[1] ?? '';
    if (frac.length >= maxDecimals) return expr;
  } else if (operand === '0') {
    return expr.slice(0, -1) + key;
  }
  if (operand.replace('.', '').length >= 12) return expr;
  return expr + key;
}

/** Pretty expression: 1,200 + 35.5 − 10 */
export function prettyExpr(expr: string): string {
  return expr
    .split(/([+-])/)
    .map((part) => {
      if (part === '+') return ' + ';
      if (part === '-') return ` ${MINUS} `;
      if (part === '') return '';
      const [int, frac] = part.split('.');
      const intFmt = int === '' ? '0' : formatNumber(Number(int), 0, 0);
      return frac !== undefined ? `${intFmt}.${frac}` : intFmt;
    })
    .join('')
    .trim()
    .replace(new RegExp(`^${MINUS} `), MINUS);
}

/** Number → calculator field string (unformatted). */
export function toExpr(value: number | '' | null | undefined, currency: string): string {
  if (value === '' || value == null || !Number.isFinite(value) || value === 0) return '';
  return String(roundTo(value, decimals(currency)));
}
