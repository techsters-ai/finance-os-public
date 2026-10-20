// Capital allocation: assets by class, their realized return in USD and risk, against a benchmark and concentration
// limits. Classes follow the spreadsheet (Calc!Y asset class, the Risk sheet).
import type { Account, AccountType, AllocationConfig, FxWindows, Rates, Transaction } from './types';
import { RISK_KEYS } from './types';
import { toUsd } from './fx';
import { SYS_REVALUATION, adjustmentCategory } from './reconcile';

/** Deposits (savings and term deposits) are bank money with a fixed rate; Fixed Income is bonds, priced by the market. */
export type AssetClass = 'Cash' | 'Deposits' | 'Fixed Income' | 'Stocks' | 'Crypto' | 'Commodities' | 'Loans' | 'Other';
export const ASSET_CLASSES: AssetClass[] = ['Cash', 'Deposits', 'Fixed Income', 'Stocks', 'Crypto', 'Commodities', 'Loans', 'Other'];

export function assetClassOf(type: AccountType): AssetClass {
  switch (type) {
    case 'card':
    case 'current':
    case 'business':
    case 'cash':
    case 'credit':
      return 'Cash';
    case 'flexible':
    case 'deposit':
      return 'Deposits';
    case 'bonds':
      return 'Fixed Income';
    case 'stocks':
      return 'Stocks';
    case 'crypto':
      return 'Crypto';
    case 'commodity':
      return 'Commodities';
    case 'loan':
      return 'Loans';
    default:
      return 'Other';
  }
}

/** Yearly rate after tax, in the account's currency. */
export function netApr(a: Pick<Account, 'apr_gross' | 'tax_rate'>): number {
  const apr = typeof a.apr_gross === 'number' ? a.apr_gross : 0;
  const tax = typeof a.tax_rate === 'number' ? a.tax_rate : 0;
  return apr * (1 - tax);
}

/** Average of the filled-in risk axes (1–7), undefined when none is set. */
export function riskScore(a: Account): number | undefined {
  const v = RISK_KEYS.map((k) => a[k]).filter((x): x is number => typeof x === 'number');
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
}

/** Realized return over a window: since Jan 1, or the last 12 months. */
export type ReturnWindow = 'ytd' | 'y1';

export function windowStart(w: ReturnWindow, today: string): string {
  return w === 'ytd' ? `${today.slice(0, 4)}-01-01` : `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
}

const yearsBetween = (from: string, to: string) => Math.max(0, Date.parse(to) - Date.parse(from)) / (365 * 86_400_000);

/** A metal held in its own unit: its price is the rate, not revaluations of the balance. */
const PRICED_BY_RATE = /^X(AU|AG|PT|PD)$/;
/** A stablecoin doesn't reprice: a reconciliation difference there is spending or income left unrecorded. */
const STABLECOIN = /^(USDT|USDC|DAI)$/;

/** The currency's value in USD now against the window start, from one daily source; undefined without both rates. */
export function fxFactor(currency: string, w: ReturnWindow, fx: FxWindows | undefined): number | undefined {
  if (currency === 'USD') return 1;
  const start = fx?.[w].rates[currency];
  const now = fx?.now[currency];
  return start && now ? now.usd / start.usd : undefined;
}

/**
 * Revaluations of an asset priced in its balance (stocks, crypto…) over the window, as a share of the balance at
 * its start. They exist only from the account's first day in the app, so later than that the window starts there.
 */
export function revaluationReturn(a: Account, txs: Transaction[], from: string, to: string): { value: number; since?: string } {
  const base = a.opening_date > from ? a.opening_date : from;
  let start = Number(a.opening_balance) || 0;
  let reval = 0;
  for (const t of txs) {
    if (t.deleted || t.date < a.opening_date) continue;
    const amount =
      t.account_id === a.id ? Number(t.amount) || 0 : t.type === 'transfer' && t.to_account_id === a.id ? Number(t.to_amount) || 0 : 0;
    if (!amount) continue;
    if (t.date < base) start += amount;
    else if (t.date <= to && t.account_id === a.id && t.category_id === SYS_REVALUATION) reval += amount;
  }
  return { value: start > 0 ? reval / start : 0, since: base > from ? base : undefined };
}

export interface Holding {
  account: Account;
  cls: AssetClass;
  usd: number;
  /** Yearly rate after tax. */
  rate: number;
  /** Return over the window in the account's currency: interest at the rate, plus revaluations for priced assets. */
  local: number;
  /** The same in USD, with the currency's actual move; undefined without its rates. */
  inUsd?: number;
  /** Revaluations count from this day only (the account's first day in the app). */
  priceSince?: string;
  risk?: number;
}

export interface ClassLine {
  cls: AssetClass;
  usd: number;
  /** Of gross assets. */
  share: number;
  local: number;
  inUsd?: number;
  risk?: number;
  holdings: Holding[];
}

export interface Allocation {
  /** Positive balances in USD, archived accounts left out. */
  gross: number;
  lines: ClassLine[];
  /** Returns over the window, weighted by USD over gross assets. */
  local: number;
  inUsd?: number;
  risk?: number;
  /** The benchmark base, as the Risk sheet: assets except cash, loans to people and the emergency fund. */
  investable: Map<AssetClass, number>;
  investableTotal: number;
  holdings: Holding[];
}

const weighted = (items: { usd: number; v?: number }[]): number | undefined => {
  const withV = items.filter((x) => x.v !== undefined);
  const w = withV.reduce((s, x) => s + x.usd, 0);
  return w > 0 ? withV.reduce((s, x) => s + x.usd * (x.v as number), 0) / w : undefined;
};

export interface ReturnInputs {
  window: ReturnWindow;
  today: string;
  fx?: FxWindows;
  txs: Transaction[];
}

/**
 * Realized return of one account over the window, as if held all along: interest at its current rate after tax
 * for the time elapsed, revaluations for assets priced in the balance, times the actual move of its currency.
 */
export function holdingReturn(a: Account, r: ReturnInputs): Pick<Holding, 'local' | 'inUsd' | 'priceSince'> {
  const from = windowStart(r.window, r.today);
  let local = netApr(a) * yearsBetween(from, r.today);
  let priceSince: string | undefined;
  if (adjustmentCategory(a.type) === SYS_REVALUATION && !PRICED_BY_RATE.test(a.currency) && !STABLECOIN.test(a.currency)) {
    const reval = revaluationReturn(a, r.txs, from, r.today);
    local += reval.value;
    priceSince = reval.since;
  }
  const f = fxFactor(a.currency, r.window, r.fx);
  return { local, inUsd: f === undefined ? undefined : (1 + local) * f - 1, priceSince };
}

export function capitalAllocation(accounts: Account[], balances: Map<string, number>, rates: Rates, returns: ReturnInputs): Allocation {
  const holdings: Holding[] = [];
  for (const a of accounts) {
    if (a.archived) continue;
    const usd = toUsd(balances.get(a.id) ?? 0, a.currency, rates);
    if (usd === undefined || usd <= 0) continue;
    holdings.push({ account: a, cls: assetClassOf(a.type), usd, rate: netApr(a), ...holdingReturn(a, returns), risk: riskScore(a) });
  }
  const gross = holdings.reduce((s, h) => s + h.usd, 0);
  const lines: ClassLine[] = [];
  for (const cls of ASSET_CLASSES) {
    const hs = holdings.filter((h) => h.cls === cls).sort((x, y) => y.usd - x.usd);
    if (!hs.length) continue;
    const usd = hs.reduce((s, h) => s + h.usd, 0);
    lines.push({
      cls,
      usd,
      share: gross > 0 ? usd / gross : 0,
      local: weighted(hs.map((h) => ({ usd: h.usd, v: h.local }))) ?? 0,
      inUsd: weighted(hs.map((h) => ({ usd: h.usd, v: h.inUsd }))),
      risk: weighted(hs.map((h) => ({ usd: h.usd, v: h.risk }))),
      holdings: hs,
    });
  }
  lines.sort((x, y) => y.usd - x.usd);
  const investable = new Map<AssetClass, number>();
  for (const h of holdings) {
    if (h.account.in_emergency_fund || h.cls === 'Cash' || h.cls === 'Loans') continue;
    investable.set(h.cls, (investable.get(h.cls) ?? 0) + h.usd);
  }
  return {
    gross,
    lines,
    local: weighted(holdings.map((h) => ({ usd: h.usd, v: h.local }))) ?? 0,
    inUsd: weighted(holdings.map((h) => ({ usd: h.usd, v: h.inUsd }))),
    risk: weighted(holdings.map((h) => ({ usd: h.usd, v: h.risk }))),
    investable,
    investableTotal: [...investable.values()].reduce((s, v) => s + v, 0),
    holdings,
  };
}

/**
 * The defensive part of a portfolio. Reference portfolios hold bonds there; deposits do the same job for a private
 * investor (with bank and currency risk instead of price swings), so a benchmark compares both against it.
 */
export const BONDS_AND_DEPOSITS = 'Bonds & deposits';

/** The class a benchmark compares: deposits and bonds together, the rest as is. */
export function benchmarkClassOf(cls: string): string {
  return /^(deposits?|fixed income|bonds?|bonds & deposits)$/i.test(cls.trim()) ? BONDS_AND_DEPOSITS : cls.trim();
}

/** Reference portfolios next to the target from the spreadsheet. */
export const BENCHMARKS: Record<string, Partial<Record<string, number>>> = {
  '60/40': { Stocks: 0.6, [BONDS_AND_DEPOSITS]: 0.4 },
  'All Weather': { Stocks: 0.3, [BONDS_AND_DEPOSITS]: 0.55, Commodities: 0.15 },
};

export interface BenchmarkRow {
  cls: string;
  now: number;
  target: number;
}

/**
 * Share of the benchmark base per class vs the target; every class of either side shows up. Deposits and bonds
 * count as one class, and so do the target's own labels for them (Fixed Income, Bonds, Deposits).
 */
export function compareToBenchmark(a: Allocation, targets: Partial<Record<string, number>>): BenchmarkRow[] {
  const now = new Map<string, number>();
  for (const [cls, usd] of a.investable) now.set(benchmarkClassOf(cls), (now.get(benchmarkClassOf(cls)) ?? 0) + usd);
  const goal = new Map<string, number>();
  for (const [cls, t] of Object.entries(targets)) {
    if (typeof t === 'number') goal.set(benchmarkClassOf(cls), (goal.get(benchmarkClassOf(cls)) ?? 0) + t);
  }
  const classes = new Set<string>([...goal.keys(), ...now.keys()]);
  return [...classes]
    .map((cls) => ({
      cls,
      now: a.investableTotal > 0 ? (now.get(cls) ?? 0) / a.investableTotal : 0,
      target: goal.get(cls) ?? 0,
    }))
    .sort((x, y) => y.target - x.target || y.now - x.now);
}

export interface LimitCheck {
  dimension: string;
  /** The value the share belongs to: the largest one for '*'. */
  value: string;
  share: number;
  limit: number;
  status: 'ok' | 'near' | 'over';
}

/** Concentration limits of the Risk sheet over gross assets; near = from 90% of the limit. */
export function checkLimits(a: Allocation, config: AllocationConfig, highRiskThreshold: number): LimitCheck[] {
  const keyOf = (h: Holding, dim: string): string =>
    dim === 'country'
      ? h.account.country
      : dim === 'institution'
        ? h.account.institution
        : dim === 'currency'
          ? h.account.currency
          : dim === 'asset_class'
            ? h.cls
            : '';
  const out: LimitCheck[] = [];
  for (const l of config.limits) {
    let value = l.value;
    let share = 0;
    if (l.dimension === 'high_risk') {
      value = `risk ≥ ${highRiskThreshold}`;
      share = a.gross > 0 ? a.holdings.filter((h) => (h.risk ?? 0) >= highRiskThreshold).reduce((s, h) => s + h.usd, 0) / a.gross : 0;
    } else {
      const sums = new Map<string, number>();
      for (const h of a.holdings) {
        const k = keyOf(h, l.dimension).trim();
        if (k) sums.set(k, (sums.get(k) ?? 0) + h.usd);
      }
      if (l.value === '*' || !l.value) {
        const top = [...sums].sort((x, y) => y[1] - x[1])[0];
        if (!top) continue;
        value = top[0];
        share = a.gross > 0 ? top[1] / a.gross : 0;
      } else {
        const match = [...sums].find(([k]) => k.toLowerCase() === l.value.toLowerCase());
        share = a.gross > 0 && match ? match[1] / a.gross : 0;
      }
    }
    out.push({ dimension: l.dimension, value, share, limit: l.limit, status: share > l.limit ? 'over' : share >= 0.9 * l.limit ? 'near' : 'ok' });
  }
  return out;
}
