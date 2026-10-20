import { describe, expect, it } from 'vitest';
import {
  BENCHMARKS,
  BONDS_AND_DEPOSITS,
  assetClassOf,
  capitalAllocation,
  checkLimits,
  compareToBenchmark,
  holdingReturn,
  windowStart,
  type ReturnInputs,
} from './allocation';
import type { FxWindows } from './types';
import { account, tx } from './fixtures.test-utils';

const rates = { USD: 1, RUB: 0.01, TRY: 0.0001 };
// The ruble lost 10% since Jan 1 and 4% over 12 months; the som gained 1% over 12 months; gold +20% this year.
const fx: FxWindows = {
  ytd: { start: '2026-01-01', rates: { RUB: { date: '2026-01-01', usd: 0.0111111 }, TRY: { date: '2026-01-01', usd: 0.0001 }, XAU: { date: '2026-01-01', usd: 3500 } } },
  y1: { start: '2025-07-02', rates: { RUB: { date: '2025-07-01', usd: 0.0104167 }, TRY: { date: '2025-07-01', usd: 0.000099 } } },
  now: { RUB: { date: '2026-07-01', usd: 0.01 }, TRY: { date: '2026-07-01', usd: 0.0001 }, XAU: { date: '2026-07-01', usd: 4200 } },
};
// 2026-07-02: half a year (182 days) since Jan 1.
const returns: ReturnInputs = { window: 'ytd', today: '2026-07-02', fx, txs: [] };
const half = 182 / 365;
const accs = [
  account({ id: 'card', currency: 'USD', type: 'card', institution: 'Bank A', country: 'DE' }),
  account({ id: 'dep', currency: 'RUB', type: 'deposit', group: 'investment', apr_gross: 0.15, tax_rate: 0.13, institution: 'Bank B', country: 'BR', risk_country: 6, risk_currency: 6 }),
  account({ id: 'ef', currency: 'TRY', type: 'deposit', group: 'investment', apr_gross: 0.2, tax_rate: 0, institution: 'Bank C', country: 'TR', in_emergency_fund: true }),
  account({ id: 'stk', currency: 'USD', type: 'stocks', group: 'investment', apr_gross: 0.04, institution: 'Broker A', country: 'US' }),
  account({ id: 'cc', currency: 'USD', type: 'credit', group: 'credit' }),
];
const balances = new Map([
  ['card', 1000],
  ['dep', 300000], // $3,000
  ['ef', 20000000], // $2,000
  ['stk', 4000],
  ['cc', -500],
]);

describe('capital allocation', () => {
  it('classes follow the account type', () => {
    expect(assetClassOf('current')).toBe('Cash');
    expect(assetClassOf('flexible')).toBe('Deposits');
    expect(assetClassOf('deposit')).toBe('Deposits');
    expect(assetClassOf('bonds')).toBe('Fixed Income');
    expect(assetClassOf('loan')).toBe('Loans');
  });
  it('windows start on Jan 1 or the same day a year ago', () => {
    expect(windowStart('ytd', '2026-10-19')).toBe('2026-01-01');
    expect(windowStart('y1', '2026-10-19')).toBe('2025-10-19');
  });
  it('a deposit earns its rate for the time elapsed, times the actual move of its currency', () => {
    // 15% × (1 − 13%) × 182/365 = 6.507%; the ruble: 0.01 / 0.0111111 = 0.9
    const r = holdingReturn(accs[1], returns);
    expect(r.local).toBeCloseTo(0.1305 * half, 6);
    expect(r.inUsd).toBeCloseTo((1 + 0.1305 * half) * 0.9 - 1, 4);
    expect(r.priceSince).toBeUndefined();
    // 12 months: the whole rate, the ruble −4%
    const y = holdingReturn(accs[1], { ...returns, window: 'y1' });
    expect(y.local).toBeCloseTo(0.1305, 6);
    expect(y.inUsd).toBeCloseTo(1.1305 * 0.96 - 1, 4);
  });
  it('cash in USD earns nothing; a currency without rates has no USD return', () => {
    expect(holdingReturn(accs[0], returns)).toEqual({ local: 0, inUsd: 0, priceSince: undefined });
    expect(holdingReturn(account({ id: 'g', currency: 'GEL', apr_gross: 0.1 }), returns).inUsd).toBeUndefined();
  });
  it('stocks add revaluations, counted from the first day in the app', () => {
    const stk = account({ id: 's', currency: 'RUB', type: 'stocks', opening_balance: 100000, opening_date: '2026-03-01' });
    const txs = [
      tx({ id: 'buy', account_id: 's', amount: 20000, type: 'transfer', date: '2026-04-01' }),
      tx({ id: 'r1', account_id: 's', amount: 6000, category_id: 'sys_revaluation', type: 'adjustment', date: '2026-05-01' }),
      tx({ id: 'old', account_id: 's', amount: 9999, category_id: 'sys_revaluation', type: 'adjustment', date: '2026-02-01' }),
    ];
    const r = holdingReturn(stk, { ...returns, txs });
    expect(r.priceSince).toBe('2026-03-01');
    expect(r.local).toBeCloseTo(0.06, 6); // 6,000 on the 100,000 there at the start
    expect(r.inUsd).toBeCloseTo(1.06 * 0.9 - 1, 4);
  });
  it('a stablecoin earns its rate; a reconciliation difference there is not a return', () => {
    const stable = account({ id: 'stable', currency: 'USDC', type: 'crypto', apr_gross: 0.06, opening_balance: 10000, opening_date: '2026-03-01' });
    const txs = [tx({ id: 'r', account_id: 'stable', amount: -1500, category_id: 'sys_revaluation', type: 'adjustment', date: '2026-06-01' })];
    expect(holdingReturn(stable, { ...returns, txs })).toEqual({ local: 0.06 * half, inUsd: undefined, priceSince: undefined });
    const pegged: FxWindows = { ...fx, ytd: { ...fx.ytd, rates: { ...fx.ytd.rates, USDC: { date: '2026-01-01', usd: 1 } } }, now: { ...fx.now, USDC: { date: '2026-07-02', usd: 1 } } };
    expect(holdingReturn(stable, { ...returns, fx: pegged, txs }).inUsd).toBeCloseTo(0.06 * half, 9);
  });
  it('gold held in ounces follows its price', () => {
    const gold = account({ id: 'au', currency: 'XAU', type: 'commodity', opening_date: '2026-09-01' });
    expect(holdingReturn(gold, returns)).toEqual({ local: 0, inUsd: 4200 / 3500 - 1, priceSince: undefined });
  });
  it('splits gross assets by class and weights returns by USD', () => {
    const a = capitalAllocation(accs, balances, rates, returns);
    expect(a.gross).toBe(10000);
    const dep = a.lines.find((l) => l.cls === 'Deposits')!;
    expect(dep.usd).toBe(5000);
    expect(dep.share).toBe(0.5);
    expect(a.lines.find((l) => l.cls === 'Cash')!.usd).toBe(1000); // the credit card's debt isn't an asset
    expect(a.local).toBeCloseTo(((3000 * 0.1305 + 2000 * 0.2 + 4000 * 0.04) / 10000) * half, 6);
  });
  it('the benchmark base leaves out cash and the emergency fund', () => {
    const a = capitalAllocation(accs, balances, rates, returns);
    expect(a.investableTotal).toBe(7000);
    const rows = compareToBenchmark(a, BENCHMARKS['60/40']);
    expect(rows).toEqual([
      { cls: 'Stocks', now: 4000 / 7000, target: 0.6 },
      { cls: BONDS_AND_DEPOSITS, now: 3000 / 7000, target: 0.4 },
    ]);
  });
  it('a benchmark counts bonds and deposits together, whatever the target calls them', () => {
    const withBonds = [...accs, account({ id: 'bnd', currency: 'USD', type: 'bonds', group: 'investment' })];
    const a = capitalAllocation(withBonds, new Map([...balances, ['bnd', 1000]]), rates, returns);
    expect(a.lines.find((l) => l.cls === 'Fixed Income')!.usd).toBe(1000);
    const rows = compareToBenchmark(a, { 'Fixed Income': 0.3, Deposits: 0.1, Stocks: 0.6 });
    expect(rows).toEqual([
      { cls: 'Stocks', now: 0.5, target: 0.6 },
      { cls: BONDS_AND_DEPOSITS, now: 0.5, target: 0.4 },
    ]);
  });
  it('checks concentration limits over gross assets', () => {
    const a = capitalAllocation(accs, balances, rates, returns);
    const checks = checkLimits(
      a,
      { targets: [], limits: [
        { dimension: 'institution', value: '*', limit: 0.3 },
        { dimension: 'country', value: 'BR', limit: 0.35 },
        { dimension: 'high_risk', value: '*', limit: 0.2 },
      ] },
      3.5,
    );
    expect(checks[0]).toMatchObject({ value: 'Broker A', share: 0.4, status: 'over' });
    expect(checks[1]).toMatchObject({ value: 'BR', share: 0.3, status: 'ok' });
    expect(checks[2]).toMatchObject({ share: 0.3, status: 'over' });
  });
});
