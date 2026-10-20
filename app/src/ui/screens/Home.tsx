// Home: net worth with runway, and income & expense analytics for a chosen period.
import { Fragment, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { computed } from '@preact/signals';
import {
  accounts,
  activeAccounts,
  allocationConfig,
  balances,
  capital,
  categories,
  categoriesById,
  currencyOf,
  history,
  liveTransactions,
  rates,
  reconciledMonths,
  serverMetrics,
  serverSettings,
  spendBucket,
  taxSummary,
  taxMarks,
  taxRates,
  saveTaxMark,
  config,
  syncStatus,
} from '../../data/store';
import {
  ASSET_CLASSES,
  BENCHMARKS,
  BONDS_AND_DEPOSITS,
  capitalAllocation,
  checkLimits,
  compareToBenchmark,
  windowStart,
  type AssetClass,
} from '../../domain/allocation';
import { budgetTone, budgetTotal, periodStats, type MonthPoint } from '../../domain/metrics';
import { runwayMonths } from '../../domain/balances';
import {
  addMonths,
  currentMonth,
  monthEnd,
  monthLabel,
  monthShort,
  monthStart,
  monthsInRange,
  plural,
  rangeLabel,
  shortDay,
  today,
} from '../../domain/dates';
import { formatMoney, formatPct } from '../../domain/money';
import { taxCategory } from '../../domain/tax';
import { NOWHERE, countryCode, countryName, residencyOf, residentTax } from '../../domain/residency';
import { toUsd } from '../../domain/fx';
import type { Account, TaxMark, TaxSummary } from '../../domain/types';
import { isBudgeted } from '../../domain/scope';
import { reconcileCandidates, reconcileReminderDue } from '../../domain/reconcile';
import { CatIcon, CurrencySwitch, Row, Section, Segmented, Sheet, Usd, cx, formatUsd, showToast, useScrollMemory } from '../components';
import { PeriodSheet, resolvePeriod, shiftPeriod } from '../period';
import { IconBack, IconBars, IconChevron, IconChevronDown, IconEye, IconEyeOff, IconGear, IconRing, IconScale } from '../icons';
import { pullProgress, usePullToRefresh } from '../usePullToRefresh';
import { ResidencyCard } from './Residency';
import { syncNow } from '../../data/sync';
import {
  analyticsPeriod,
  hideAmounts,
  setAnalyticsPeriod,
  allocChart,
  allocWindow,
  benchChart,
  setAllocChart,
  setAllocWindow,
  setBenchChart,
  setSpendChart,
  spendChart,
  type SpendChart,
  toggleHideAmounts,
} from '../prefs';
import { navigate } from '../router';

// ── Net worth & runway ──────────────────────────────────────

/** Months of runway, plus the same in years. Burn is the spreadsheet's average of recent full months. */
function runwayText(months: number | undefined): { main: string; sub?: string } {
  if (months === undefined) return { main: '—' };
  if (months >= 1200) return { main: '100+ yr' };
  return { main: `${months.toFixed(1)} mo`, sub: `${(months / 12).toFixed(1)} years` };
}

type TaxRule = TaxSummary['rules'][number];

/**
 * The server's taxes with the app's marks it hasn't counted yet (made since its last run) taken off, and marks it
 * counted but the app has undone since added back: the card reacts at once, the server catches up in a minute.
 */
function effectiveTaxRules(): TaxRule[] {
  const t = taxSummary.value;
  if (!t) return [];
  const counted = new Set(t.marks);
  const marks = new Map(taxMarks.value.map((m) => [m.id, m]));
  return t.rules.map((r) => {
    const usdPer = toUsd(1, r.owed.currency, rates.value) ?? 0;
    let dNative = 0;
    let dUsd = 0;
    const periods = r.periods.map((p) => {
      const m = marks.get(`${r.id}_${p.key}`);
      let owed = p.owed;
      if (m && !m.deleted && !counted.has(m.id)) owed = Math.max(0, owed - m.amount);
      if (m && m.deleted && counted.has(m.id)) owed += Math.min(m.amount, p.marked);
      const diff = owed - p.owed;
      const usd = diff * (p.owed > 0 ? p.owedUsd / p.owed : usdPer);
      dNative += diff;
      dUsd += usd;
      return { ...p, owed, owedUsd: p.owedUsd + usd };
    });
    return { ...r, periods, owedUsd: r.owedUsd + dUsd, owed: { ...r.owed, amount: r.owed.amount + dNative } };
  });
}

/**
 * What the country of residence would want on this year's foreign income (domain/residency.ts residentTax): an
 * estimate at its TaxRates foreign_rate, less what is due where the income was earned. Null: resident nowhere or not set.
 */
const residentEstimate = computed(() =>
  residentTax({
    residency: residencyOf(serverSettings.value),
    rates: taxRates.value,
    accounts: accounts.value,
    transactions: liveTransactions.value,
    rules: effectiveTaxRules(),
    toUsd: (amount, currency) => toUsd(amount, currency, rates.value) ?? 0,
    now: today(),
  }),
);

/**
 * Taxes to set aside: territorial (accrued and not yet paid where the income is earned, the server's Taxes sheet) and
 * resident (the estimate for the country of residence); by where they'll be paid from — the resident one personally.
 */
function taxesOwed(): { total: number; business: number; personal: number; territorial: number; resident: number } {
  const rules = effectiveTaxRules();
  const pos = (v: number) => Math.max(0, v);
  const business = pos(rules.filter((r) => r.id === 'business').reduce((s, r) => s + r.owedUsd, 0));
  const local = pos(rules.filter((r) => r.id !== 'business').reduce((s, r) => s + r.owedUsd, 0));
  const resident = residentEstimate.value?.owedUsd ?? 0;
  return { total: business + local + resident, business, personal: local + resident, territorial: business + local, resident };
}

/** Net worth less the taxes owed: they're no longer yours. */
function netWorth(): number {
  return capital.value.total - taxesOwed().total;
}

/**
 * Burn rate, USD a month: the spreadsheet's BURN when it has one (a Calc sheet of your own); otherwise personal
 * spending a month over the last `burn_window_months` (6) whole months that had any, from the transactions.
 */
const burnRate = computed((): number | undefined => {
  if (serverMetrics.value.burn !== undefined) return serverMetrics.value.burn;
  const n = Number(serverSettings.value.burn_window_months) > 0 ? Number(serverSettings.value.burn_window_months) : 6;
  const last = addMonths(currentMonth(), -1);
  const stats = periodStats({
    txs: liveTransactions.value,
    history: history.value,
    categories: categories.value,
    from: monthStart(addMonths(last, -23)),
    to: monthEnd(last),
    rates: rates.value,
    currencyOf,
    bucketOf: spendBucket,
  });
  const spent = stats.byMonth.map((m) => m.expense).filter((v) => v > 0).slice(-n);
  return spent.length ? spent.reduce((s, v) => s + v, 0) / spent.length : undefined;
});

function CapitalCard() {
  const c = capital.value;
  const hidden = hideAmounts.value;
  const burn = burnRate.value;
  const hasBusiness = activeAccounts.value.some((a) => a.group === 'business');
  const owed = taxesOwed();
  const liquidNet = c.liquidNet - owed.personal;
  const liquid = runwayText(runwayMonths(liquidNet, burn));
  const total = runwayText(runwayMonths(netWorth(), burn));
  return (
    <button type="button" class="capital" onClick={toggleHideAmounts} aria-label="Hide or show amounts">
      <div class="capital-label">
        Net worth {hidden ? <IconEyeOff size={15} /> : <IconEye size={15} />}
      </div>
      <div class="capital-value">
        <Usd value={netWorth()} whole />
      </div>
      <div class="capital-sub">
        <span>
          Liquid <Usd value={liquidNet} whole />
        </span>
        <span>
          Investments <Usd value={c.byGroup.investment} whole />
        </span>
        {hasBusiness && (
          <span>
            Business <Usd value={c.byGroup.business - owed.business} whole />
          </span>
        )}
        {c.receivable > 0 && (
          <span>
            Owed to you <Usd value={c.receivable} whole />
          </span>
        )}
        {c.payable < 0 && (
          <span>
            You owe <Usd value={-c.payable} whole />
          </span>
        )}
      </div>
      <div class="runway">
        <div class="runway-cell">
          <span class="runway-label">Runway · liquid</span>
          <span class="runway-value">{liquid.main}</span>
          {liquid.sub && <span class="runway-sub">{liquid.sub}</span>}
        </div>
        <div class="runway-cell">
          <span class="runway-label">Runway · total</span>
          <span class="runway-value">{total.main}</span>
          {total.sub && <span class="runway-sub">{total.sub}</span>}
        </div>
      </div>
      {c.missingRates.length > 0 && <div class="capital-warn">No rate for: {c.missingRates.join(', ')}</div>}
    </button>
  );
}

/** '2026-Q3' → 'Q3 2026'; a year stays as is. */
const periodTitle = (key: string) => (key.includes('-Q') ? `${key.slice(5)} ${key.slice(0, 4)}` : key);

function periodNote(key: string, now = today()): string {
  if (key.includes('-Q')) {
    const q = `${now.slice(0, 4)}-Q${Math.ceil(Number(now.slice(5, 7)) / 3)}`;
    return key === q ? 'this quarter so far' : 'quarter closed';
  }
  return key === now.slice(0, 4) ? 'this year so far' : 'year closed';
}

/** Where a rule's tax is usually paid from: the business account, or an account in the rule's country, in its currency. */
function payFrom(rule: TaxRule): Account | undefined {
  const live = activeAccounts.value.filter((a) => a.currency === rule.owed.currency);
  const where = countryCode(rule.country ?? '');
  return rule.id === 'business'
    ? live.find((a) => a.group === 'business')
    : live.find((a) => !!where && countryCode(a.country) === where && (a.group === 'liquid' || a.group === 'credit'));
}

/**
 * Taxes accrued and not yet paid, between net worth and the averages; a tap opens what they're made of: each rule
 * by year or quarter, oldest first (payments settle those first). A period offers: pay (the entry screen, amount
 * filled in), already paid (a mark: it's in the balances, no transaction) or delete (a mark: not owed). Marks can be
 * undone from the list under the rules.
 */
function TaxesCard() {
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState<{ rule: TaxRule; key: string; owed: number } | null>(null);
  const t = taxSummary.value;
  const split = taxesOwed();
  const owed = split.total;
  const marks = taxMarks.value.filter((m) => !m.deleted);
  const residency = residencyOf(serverSettings.value);
  const est = residentEstimate.value;
  if (!t || (owed <= 0 && !marks.length)) return null;
  const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;
  const rules = effectiveTaxRules().filter((r) => r.periods.some((p) => p.owed > 0));
  const taxCat = taxCategory(categories.value);
  const label = (ruleId: string) => t.rules.find((r) => r.id === ruleId)?.label.split(' · ')[0] ?? ruleId;

  const mark = async (action: TaxMark['action']) => {
    if (!act) return;
    const m: TaxMark = {
      id: `${act.rule.id}_${act.key}`,
      rule: act.rule.id,
      period: act.key,
      action,
      amount: act.owed,
      currency: act.rule.owed.currency,
      date: today(),
      note: '',
      deleted: false,
      created_at: '',
      updated_at: '',
      server_ts: '',
    };
    setAct(null);
    await saveTaxMark(m);
    showToast(action === 'paid' ? 'Marked as paid' : 'Deleted');
  };
  const pay = () => {
    if (!act) return;
    const from = payFrom(act.rule);
    setAct(null);
    setOpen(false);
    const q = new URLSearchParams({ type: 'expense', cat: taxCat?.id ?? '' });
    if (from) {
      q.set('account', from.id);
      q.set('amount', String(act.owed));
    }
    navigate(`/entry?${q.toString()}`);
  };
  const actFrom = act ? payFrom(act.rule) : undefined;

  return (
    <>
      <button type="button" class="taxes-card" onClick={() => setOpen(true)}>
        <CatIcon cat={taxCat} size={36} />
        <span class="taxes-card-text">
          <b>Taxes to set aside</b>
          <span>
            {residency
              ? residency === NOWHERE
                ? `${formatUsd(split.territorial, { whole: true })} territorial`
                : `${formatUsd(split.territorial, { whole: true })} + ${formatUsd(split.resident, { whole: true })} resident`
              : rules.length
                ? rules.map((r) => formatMoney(r.owed.amount, r.owed.currency, { whole: true })).join(' · ')
                : 'all settled'}
          </span>
        </span>
        <span class="taxes-card-value">
          <Usd value={owed} whole />
        </span>
        <IconChevron size={16} />
      </button>
      <Sheet open={open} title="Taxes to set aside" onClose={() => setOpen(false)}>
        <div class="taxes-total">
          <b>
            <Usd value={owed} whole />
          </b>
          <span>accrued from your income and not paid yet</span>
        </div>
        <div class="taxes-group">
          <b>
            Territorial · <Usd value={split.territorial} whole />
          </b>
          <span>Due where the income is earned, whatever your residency</span>
        </div>
        {rules.length === 0 && (
          <Section>
            <Row title="All settled" />
          </Section>
        )}
        {rules.map((r) => (
          <Section key={r.id} title={r.label} right={formatMoney(r.owed.amount, r.owed.currency, { whole: true })}>
            {r.periods
              .filter((p) => p.owed > 0)
              .map((p) => (
                <Row
                  key={p.key}
                  title={periodTitle(p.key)}
                  subtitle={`${periodNote(p.key)}${p.owed < p.accrued ? ` · ${formatMoney(p.accrued - p.owed, r.owed.currency, { whole: true })} settled` : ''}`}
                  value={formatMoney(p.owed, r.owed.currency, { whole: true })}
                  valueSub={<Usd value={p.owedUsd} whole />}
                  chevron
                  onClick={() => setAct({ rule: r, key: p.key, owed: p.owed })}
                />
              ))}
          </Section>
        ))}
        {marks.length > 0 && (
          <Section title="Marked" footer="Tap one to undo it.">
            {marks.map((m) => (
              <Row
                key={m.id}
                title={`${label(m.rule)} · ${periodTitle(m.period)}`}
                subtitle={m.action === 'paid' ? `paid already · marked ${shortDay(m.date)}` : `deleted · ${shortDay(m.date)}`}
                value={formatMoney(m.amount, m.currency, { whole: true })}
                onClick={() => {
                  if (confirm(`Undo: ${label(m.rule)} ${periodTitle(m.period)} owed again?`)) void saveTaxMark({ ...m, deleted: true });
                }}
              />
            ))}
          </Section>
        )}
        <div class="taxes-group">
          <b>
            {residency && residency !== NOWHERE ? `As a resident of ${countryName(residency)}` : 'As a resident'}
            {est && est.rate !== null && (
              <>
                {' · '}
                <Usd value={est.owedUsd} whole />
              </>
            )}
          </b>
          <span>On foreign income, where you're a tax resident; changes with the residency</span>
        </div>
        {!residency || residency === NOWHERE ? (
          <Section>
            <Row
              title={residency === NOWHERE ? 'Resident nowhere' : 'Tax residency not set'}
              subtitle={residency === NOWHERE ? 'Nothing to pay as a resident' : 'Pick it to estimate the tax there'}
              chevron
              onClick={() => {
                setOpen(false);
                navigate('/residency/current');
              }}
            />
          </Section>
        ) : est && est.rate === null ? (
          <Section footer="Add its foreign_rate (the share of foreign income it takes) on the TaxRates sheet.">
            <Row title={`No rate for ${countryName(residency)}`} />
          </Section>
        ) : (
          est && (
            <Section footer="An estimate for planning: income since Jan 1 on accounts in other countries (an account's country is where its income comes from) at the TaxRates foreign_rate, less the taxes due where it was earned (the rules above and tax withheld). Progressive rates, allowances and treaties aren't counted.">
              <Row title="Foreign income this year" subtitle={`On accounts outside ${countryName(residency)}`} value={<Usd value={est.foreignUsd} whole />} />
              <Row title={`At ${pct(est.rate ?? 0)}`} subtitle="foreign_rate on the TaxRates sheet" value={<Usd value={est.foreignUsd * (est.rate ?? 0)} whole />} />
              <Row title="Due where it was earned" subtitle="Accrued and withheld abroad this year" value={<Usd value={-est.paidAbroadUsd} whole />} />
              <Row title={<b>To set aside</b>} value={<b><Usd value={est.owedUsd} whole /></b>} />
            </Section>
          )
        )}
      </Sheet>
      <Sheet
        open={!!act}
        title={act ? `${label(act.rule.id)} · ${periodTitle(act.key)} · ${formatMoney(act.owed, act.rule.owed.currency, { whole: true })}` : ''}
        onClose={() => setAct(null)}
      >
        <Section>
          <Row title="Pay" subtitle={`${actFrom ? `From ${actFrom.name}` : 'A Taxes expense'}, today`} chevron onClick={pay} />
          <Row title="Already paid" subtitle="It's in your balances already: marks it settled, no transaction" onClick={() => void mark('paid')} />
          <Row
            class="row-danger"
            title="Delete"
            subtitle="Not owed: comes off the taxes and their accrual"
            onClick={() => confirm('Delete this tax? It comes off the taxes and their accrual.') && void mark('deleted')}
          />
        </Section>
      </Sheet>
    </>
  );
}

/** Whole months of the window: Jan up to last month (this month alone in January), or the last 12. */
function averageWindow(w: 'ytd' | 'y1', now = today()): { from: string; to: string } {
  const cur = now.slice(0, 7);
  const last = addMonths(cur, -1);
  if (w === 'y1') return { from: monthStart(addMonths(cur, -12)), to: monthEnd(last) };
  return cur.endsWith('-01') ? { from: monthStart(cur), to: now } : { from: `${cur.slice(0, 4)}-01-01`, to: monthEnd(last) };
}

/**
 * Spending and what's left a month on average over whole months (YTD or 12 months, the switch Capital allocation
 * uses too): personal spending, and income less every expense with taxes by accrual (the Taxes sheet) where known.
 */
function AverageCard() {
  const w = allocWindow.value;
  const { from, to } = averageWindow(w);
  const months = monthsInRange(from, to);
  const stats = periodStats({
    txs: liveTransactions.value,
    history: history.value,
    categories: categories.value,
    from,
    to,
    rates: rates.value,
    currencyOf,
    bucketOf: spendBucket,
  });
  const accrued = taxSummary.value?.accrued ?? {};
  const byAccrual = months.every((m) => accrued[m] !== undefined);
  const taxes = byAccrual ? months.reduce((s, m) => s + accrued[m], 0) : stats.outside.taxes;
  const n = Math.max(1, months.length);
  const spent = stats.expense / n;
  const outside = (stats.outside.business + stats.outside.investment + taxes) / n;
  const left = stats.income / n - spent - outside;
  return (
    <section class="section avg-card">
      <div class="an-switch">
        <Segmented
          value={w}
          onChange={setAllocWindow}
          options={[
            { value: 'ytd', label: 'YTD' },
            { value: 'y1', label: '12 months' },
          ]}
        />
      </div>
      <div class="group">
        <div class="alloc-kpis">
          <div class="an-kpi">
            <span class="an-key">Expenses a month</span>
            <b>
              <Usd value={spent} whole />
            </b>
            <span class="an-kpi-sub">
              {outside > 0 ? (
                <>
                  + <Usd value={outside} whole /> not budgeted
                </>
              ) : (
                'all in the budget'
              )}
            </span>
          </div>
          <div class="an-kpi">
            <span class="an-key">Left a month</span>
            <b class={cx(left < 0 && 'neg')}>
              <Usd value={left} whole />
            </b>
            <span class="an-kpi-sub">
              {stats.income > 0 ? `${Math.round((left / (stats.income / n)) * 100)}% of income` : 'no income'}
            </span>
          </div>
        </div>
      </div>
      <div class="section-footer">
        Average of {rangeLabel(from, to)}{byAccrual ? ', taxes by accrual' : ''}.
      </div>
    </section>
  );
}

function ReconcileBanner() {
  if (!reconcileReminderDue(today(), reconciledMonths.value)) return null;
  const n = reconcileCandidates(activeAccounts.value).length;
  if (!n) return null;
  return (
    <button type="button" class="banner" onClick={() => navigate('/reconcile')}>
      <IconScale size={22} />
      <span class="banner-text">
        <b>Monthly reconciliation</b>
        <span>
          {n} {plural(n, 'account needs', 'accounts need')} a balance check
        </span>
      </span>
      <IconChevron size={16} />
    </button>
  );
}

// ── Chart ───────────────────────────────────────────────────

function useWidth(ref: { current: HTMLElement | null }): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** A bar with a rounded top, anchored to the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const CHART_H = 132;

interface ChartGroup {
  key: string;
  label: string;
  title: string;
  income?: number;
  expense: number;
}

/** Income vs expenses per month, or daily spending for a single month. Tap a bar for its numbers. */
function BarChart({ groups, pair }: { groups: ChartGroup[]; pair: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => setSel(null), [groups.length, groups[0]?.key]);
  const max = Math.max(1, ...groups.map((g) => Math.max(g.expense, g.income ?? 0)));
  const n = Math.max(1, groups.length);
  const slot = width / n;
  const barW = Math.max(2, Math.min(pair ? 12 : 10, pair ? (slot - 6) / 2 : slot - 2));
  const groupW = pair ? barW * 2 + 2 : barW;
  const h = (v: number) => (Math.max(0, v) / max) * (CHART_H - 4);
  const every = Math.ceil(n / (pair ? 7 : 6));
  const s = sel !== null ? groups[sel] : undefined;
  return (
    <div class="chart">
      <div class="chart-readout">
        {s ? (
          <>
            <b>{s.title}</b>
            {pair && (
              <span>
                <i class="sw sw-income" /> {formatUsd(s.income ?? 0, { whole: true })}
              </span>
            )}
            <span>
              <i class="sw sw-expense" /> {formatUsd(s.expense, { whole: true })}
            </span>
          </>
        ) : (
          <span class="muted">Tap a bar to see its numbers</span>
        )}
      </div>
      <div class="chart-plot" ref={box}>
        {width > 0 && (
          <svg width={width} height={CHART_H} role="img" aria-label={pair ? 'Income and expenses by month' : 'Spending by day'}>
            <line x1={0} x2={width} y1={CHART_H - 0.5} y2={CHART_H - 0.5} class="chart-base" />
            {groups.map((g, i) => {
              const x0 = i * slot + (slot - groupW) / 2;
              const dim = sel !== null && sel !== i;
              return (
                <g key={g.key} class={cx(dim && 'chart-dim')} onClick={() => setSel(sel === i ? null : i)}>
                  <rect x={i * slot} y={0} width={slot} height={CHART_H} fill="transparent" />
                  {pair && <path d={barPath(x0, CHART_H - h(g.income ?? 0), barW, h(g.income ?? 0))} class="bar-income" />}
                  <path
                    d={barPath(pair ? x0 + barW + 2 : x0, CHART_H - h(g.expense), barW, h(g.expense))}
                    class="bar-expense"
                  />
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <div class="chart-labels">
        {groups.map((g, i) => (
          <span key={g.key} style={{ width: `${100 / n}%` }}>
            {i % every === 0 || i === n - 1 ? g.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function monthGroups(points: MonthPoint[]): ChartGroup[] {
  return points.map((p) => ({ key: p.month, label: monthShort(p.month), title: monthLabel(p.month), income: p.income, expense: p.expense }));
}

function dayGroups(from: string, to: string, byDay: { date: string; expense: number }[]): ChartGroup[] {
  const spent = new Map(byDay.map((d) => [d.date, d.expense]));
  const out: ChartGroup[] = [];
  for (let d = from; d <= to && out.length < 62; d = new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10)) {
    out.push({ key: d, label: String(Number(d.slice(8))), title: shortDay(d), expense: spent.get(d) ?? 0 });
  }
  return out;
}

// ── Ring ────────────────────────────────────────────────────

const RING_SIZE = 188;
const RING_W = 14;

/** Spending kept out of the budget, in this order; taxes paid from personal accounts read as Personal. */
const OUTSIDE = ['business', 'investment', 'taxes'] as const;
const OUTSIDE_LABEL: Record<(typeof OUTSIDE)[number], string> = { business: 'Business', investment: 'Investments', taxes: 'Taxes' };

/** Share of the period gone by today (0…1), or undefined when today is outside it. */
function periodPace(from: string, to: string, now = today()): number | undefined {
  if (now < from || now > to) return undefined;
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  return (day(now) - day(from) + 1) / (day(to) - day(from) + 1);
}

/**
 * Spending as a ring that fills up toward the period's budget: light green, then yellow from 75%, red over it.
 * The tick marks where an even pace would be today.
 */
function SpendRing({ spent, budget, pace }: { spent: number; budget: number; pace?: number }) {
  const tone = budgetTone(spent, budget);
  const c = RING_SIZE / 2;
  const r = c - RING_W / 2 - 3;
  const len = 2 * Math.PI * r;
  const share = budget > 0 ? spent / budget : 0;
  const shown = Math.min(1, share);
  const tick =
    pace !== undefined && budget > 0
      ? (() => {
          const a = 2 * Math.PI * pace - Math.PI / 2;
          const p = (rad: number) => [c + rad * Math.cos(a), c + rad * Math.sin(a)];
          return [p(r - RING_W / 2 - 3), p(r + RING_W / 2 + 3)];
        })()
      : undefined;
  return (
    <div class={cx('spend-ring', `tone-${tone}`)}>
      <div class="spend-ring-plot">
        <svg
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          role="img"
          aria-label={budget > 0 ? `Spent ${formatUsd(spent, { whole: true })} of a ${formatUsd(budget, { whole: true })} budget` : 'Spending'}
        >
          <circle cx={c} cy={c} r={r} fill="none" class="spend-ring-track" stroke-width={RING_W} />
          {shown > 0 && (
            <circle
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke="var(--tone)"
              stroke-width={RING_W}
              stroke-linecap="round"
              stroke-dasharray={`${len * shown} ${len}`}
              transform={`rotate(-90 ${c} ${c})`}
            />
          )}
          {tick && <line x1={tick[0][0]} y1={tick[0][1]} x2={tick[1][0]} y2={tick[1][1]} class="spend-ring-pace" />}
        </svg>
        <div class="spend-ring-center">
          <span class="spend-ring-key">Spent</span>
          <b>
            <Usd value={spent} whole />
          </b>
          {budget > 0 ? (
            <span class="spend-ring-of">
              of <Usd value={budget} whole />
            </span>
          ) : (
            <span class="spend-ring-of">no budget set</span>
          )}
        </div>
      </div>
      {budget > 0 ? (
        <div class="spend-ring-foot">
          <span class={cx('spend-ring-left', share > 1 && 'neg')}>
            {share > 1 ? 'Over by ' : 'Left '}
            <Usd value={Math.abs(budget - spent)} whole />
          </span>
          <span class="muted">
            {formatPct(share)} of the budget
            {pace !== undefined && ` · ${formatPct(pace)} of the period gone`}
          </span>
        </div>
      ) : (
        <div class="spend-ring-foot muted">Set monthly budgets on categories to fill the ring</div>
      )}
    </div>
  );
}

// ── Analytics ───────────────────────────────────────────────

function Analytics() {
  const [sheet, setSheet] = useState(false);
  const [view, setView] = useState<'expense' | 'income' | 'tags'>('expense');
  const [openCat, setOpenCat] = useState<string | null>(null);
  const { from, to } = resolvePeriod(analyticsPeriod.value);
  const cats = categories.value;
  const stats = periodStats({
    txs: liveTransactions.value,
    history: history.value,
    categories: cats,
    from,
    to,
    rates: rates.value,
    currencyOf,
    bucketOf: spendBucket,
  });
  const months = monthsInRange(from, to);
  const outsideTotal = stats.outside.business + stats.outside.investment + stats.outside.taxes;
  // Saved counts every expense, budgeted or not (as Savings in the sheet).
  const net = stats.income - stats.expense - outsideTotal;
  const singleMonth = months.length === 1;
  const budget = budgetTotal(cats.filter(isBudgeted)) * months.length;
  const groups = singleMonth && !stats.historyMonths.length ? dayGroups(from, to, stats.byDay) : monthGroups(stats.byMonth);
  const pair = groups.length > 0 && groups[0].income !== undefined;
  const byCat = view === 'income' ? stats.incomeByCategory : view === 'tags' ? stats.expenseByTag : stats.expenseByCategory;
  const total = view === 'income' ? stats.income : stats.expense;
  const rows = [...byCat].sort((a, b) => b[1] - a[1]);
  const top = rows.length ? rows[0][1] : 0;
  const atEnd = to >= monthEnd(currentMonth());
  const ring = spendChart.value === 'ring';

  return (
    <>
      <div class="period-bar">
        <button type="button" class="icon-btn" aria-label="Previous period" onClick={() => setAnalyticsPeriod(shiftPeriod(from, to, -1))}>
          <IconBack size={20} />
        </button>
        <button type="button" class="period-label" onClick={() => setSheet(true)}>
          {rangeLabel(from, to)}
          <IconChevronDown size={14} stroke-width={2.4} />
        </button>
        <button
          type="button"
          class="icon-btn"
          aria-label="Next period"
          disabled={atEnd}
          onClick={() => setAnalyticsPeriod(shiftPeriod(from, to, 1))}
        >
          <IconChevron size={20} />
        </button>
      </div>

      <section class="section">
        <div class="group an-card">
          <div class="an-kpis">
            <div class="an-kpi">
              <span class="an-key">
                <i class="sw sw-income" />
                Income
              </span>
              <b>
                <Usd value={stats.income} whole />
              </b>
            </div>
            <div class="an-kpi">
              <span class="an-key">
                <i class="sw sw-expense" />
                Expenses
              </span>
              <b>
                <Usd value={stats.expense} whole />
              </b>
              {outsideTotal > 0 && (
                <span class="an-kpi-sub">
                  + <Usd value={outsideTotal} whole /> not budgeted
                </span>
              )}
            </div>
            <div class="an-kpi">
              <span class="an-key">Saved</span>
              <b class={cx(net < 0 && 'neg')}>
                <Usd value={net} whole />
              </b>
              {stats.income > 0 && <span class="an-kpi-sub">{formatPct(net / stats.income)} of income</span>}
            </div>
          </div>
          <div class="an-chart-head">
            <span class="an-chart-title">{ring ? 'Spending vs budget' : pair ? 'Income and expenses' : 'Spending by day'}</span>
            <div class="chart-toggle" role="radiogroup" aria-label="Chart">
              <button type="button" role="radio" aria-checked={ring} aria-label="Ring" class={cx(ring && 'on')} onClick={() => setSpendChart('ring')}>
                <IconRing size={17} />
              </button>
              <button type="button" role="radio" aria-checked={!ring} aria-label="Bars" class={cx(!ring && 'on')} onClick={() => setSpendChart('bars')}>
                <IconBars size={17} />
              </button>
            </div>
          </div>
          {ring && <SpendRing spent={stats.expense} budget={budget} pace={periodPace(from, to)} />}
          {!ring && groups.length > 0 && <BarChart groups={groups} pair={pair} />}
          {!ring && budget > 0 && (
            <div class="an-budget">
              <div class="progress">
                <div
                  class={cx('progress-bar', stats.expense > budget && 'over', stats.expense <= budget && stats.expense > budget * 0.85 && 'warn')}
                  style={{ width: `${Math.min(1, stats.expense / budget) * 100}%` }}
                />
              </div>
              <div class="budget-foot">
                <span>
                  Budget <Usd value={budget} whole />
                </span>
                <span class={cx(stats.expense > budget && 'neg')}>
                  {stats.expense > budget ? 'Over by ' : 'Left '}
                  <Usd value={Math.abs(budget - stats.expense)} whole />
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      <section class="section">
        <div class="an-switch">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'expense', label: 'Expenses' },
              { value: 'income', label: 'Income' },
              { value: 'tags', label: 'Tags' },
            ]}
          />
        </div>
        <div class="group">
          {rows.length === 0 && (
            <Row
              title={
                view === 'tags' ? 'No tagged expenses in this period' : view === 'expense' ? 'No expenses in this period' : 'No income in this period'
              }
            />
          )}
          {view === 'tags' &&
            rows.map(([tag, v]) => (
              <button type="button" key={tag} class="row row-tap an-row" onClick={() => navigate(`/history?tag=${encodeURIComponent(tag)}`)}>
                <div class="row-icon">
                  <span class="tag-icon">#</span>
                </div>
                <div class="row-main">
                  <div class="an-row-top">
                    <span class="row-title">{tag}</span>
                    <span class="an-row-amount">
                      <Usd value={v} whole />
                    </span>
                  </div>
                  <div class="an-bar">
                    <div class="bar-expense" style={{ width: `${top ? (v / top) * 100 : 0}%` }} />
                  </div>
                  <div class="row-sub">{total > 0 ? formatPct(v / total) : '—'} of expenses</div>
                </div>
              </button>
            ))}
          {view !== 'tags' && rows.map(([id, v]) => {
            const c = categoriesById.value.get(id);
            const b = view === 'expense' && typeof c?.budget_usd === 'number' ? c.budget_usd * months.length : 0;
            const inner = [...(stats.categoryTags.get(id) ?? [])].sort((x, y) => (x[0] === '' ? 1 : y[0] === '' ? -1 : y[1] - x[1]));
            const tagged = inner.some(([t]) => t !== '');
            const open = openCat === id && tagged;
            const history = () => navigate(`/history?category=${encodeURIComponent(id)}`);
            return (
              <Fragment key={id}>
                <button
                  type="button"
                  class={cx('row row-tap an-row', open && 'an-row-open')}
                  onClick={() => (tagged ? setOpenCat(open ? null : id) : history())}
                >
                  <div class="row-icon">
                    <CatIcon cat={c} size={32} />
                  </div>
                  <div class="row-main">
                    <div class="an-row-top">
                      <span class="row-title">{c?.name ?? id}</span>
                      <span class="an-row-amount">
                        <Usd value={v} whole />
                      </span>
                    </div>
                    <div class="an-bar">
                      <div class={view === 'expense' ? 'bar-expense' : 'bar-income'} style={{ width: `${top ? (v / top) * 100 : 0}%` }} />
                    </div>
                    <div class="row-sub">
                      {total > 0 ? formatPct(v / total) : '—'} of {view === 'expense' ? 'expenses' : 'income'}
                      {b > 0 && (
                        <span class={cx(v > b && 'neg')}>
                          {' '}
                          · budget {formatUsd(b, { whole: true })}
                        </span>
                      )}
                      {tagged && <span class="an-tags-hint"> · {open ? 'hide tags' : 'by tag'}</span>}
                    </div>
                  </div>
                </button>
                {open && (
                  <div class="an-sub">
                    {inner.map(([t, tv]) => (
                      <button
                        type="button"
                        key={t || '-'}
                        class="row row-tap an-sub-row"
                        onClick={() => (t ? navigate(`/history?category=${encodeURIComponent(id)}&tag=${encodeURIComponent(t)}`) : history())}
                      >
                        <span class="row-main row-title">{t ? `#${t}` : 'No tag'}</span>
                        <span class="row-value">
                          <Usd value={tv} whole />
                        </span>
                      </button>
                    ))}
                    <button type="button" class="row row-tap an-sub-row an-sub-all" onClick={history}>
                      <span class="row-main">All {c?.name ?? id} transactions</span>
                    </button>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
        {view === 'expense' && stats.outsideByCategory.length > 0 && (
          <>
            <div class="section-header an-outside-head">
              <span>Not in the budget</span>
              <span class="section-header-right">
                {OUTSIDE.filter((b) => stats.outside[b] > 0).map((b, i) => (
                  <Fragment key={b}>
                    {i > 0 && ' · '}
                    {OUTSIDE_LABEL[b]} <Usd value={stats.outside[b]} whole />
                  </Fragment>
                ))}
              </span>
            </div>
            <div class="group">
              {stats.outsideByCategory.map(({ bucket, categoryId, usd }) => {
                const c = categoriesById.value.get(categoryId);
                return (
                  <Row
                    key={`${bucket}|${categoryId}`}
                    icon={<CatIcon cat={c} size={32} />}
                    title={c?.name ?? categoryId}
                    subtitle={bucket === 'taxes' ? 'Paid in the period' : OUTSIDE_LABEL[bucket]}
                    value={<Usd value={usd} whole />}
                    chevron
                    onClick={() => navigate(`/history?category=${encodeURIComponent(categoryId)}`)}
                  />
                );
              })}
            </div>
            <div class="section-footer">
              Business and investment costs and taxes: outside the budget, the burn rate and runway.
            </div>
          </>
        )}
        {stats.historyMonths.length > 0 && (
          <div class="section-footer">
            {stats.historyMonths.length === months.length ? 'Monthly totals' : `${rangeLabel(monthStart(stats.historyMonths[0]), monthEnd(stats.historyMonths[stats.historyMonths.length - 1]))}: monthly totals`}{' '}
            from the old spreadsheet (History sheet).
          </div>
        )}
      </section>

      <PeriodSheet open={sheet} onClose={() => setSheet(false)} value={analyticsPeriod.value} onChange={setAnalyticsPeriod} />
    </>
  );
}

// ── Capital allocation ──────────────────────────────────────

/**
 * Asset class colors: fixed per class (never by rank), validated as a ring in this order, Other neutral. A benchmark's
 * bonds & deposits wear the deposits color: that's where the money is.
 */
const CLASS_COLOR: Record<AssetClass | typeof BONDS_AND_DEPOSITS, string> = {
  Cash: 'var(--ac-cash)',
  Deposits: 'var(--ac-dep)',
  [BONDS_AND_DEPOSITS]: 'var(--ac-dep)',
  'Fixed Income': 'var(--ac-fi)',
  Stocks: 'var(--ac-stocks)',
  Crypto: 'var(--ac-crypto)',
  Commodities: 'var(--ac-comm)',
  Loans: 'var(--ac-loans)',
  Other: 'var(--ac-other)',
};
const colorOf = (cls: string) => CLASS_COLOR[cls as AssetClass] ?? 'var(--ac-other)';
const classOrder = (cls: string) => {
  const i = ASSET_CLASSES.indexOf((cls === BONDS_AND_DEPOSITS ? 'Deposits' : cls) as AssetClass);
  return i < 0 ? 99 : i;
};

function ChartToggle({ value, onChange }: { value: SpendChart; onChange: (v: SpendChart) => void }) {
  return (
    <div class="chart-toggle" role="radiogroup" aria-label="Chart">
      <button type="button" role="radio" aria-checked={value === 'ring'} aria-label="Ring" class={cx(value === 'ring' && 'on')} onClick={() => onChange('ring')}>
        <IconRing size={17} />
      </button>
      <button type="button" role="radio" aria-checked={value === 'bars'} aria-label="Bars" class={cx(value === 'bars' && 'on')} onClick={() => onChange('bars')}>
        <IconBars size={17} />
      </button>
    </div>
  );
}

const DONUT = 188;
const DONUT_W = 20;

/**
 * Shares as a donut, one ring per series (outer first), segments in a fixed class order with a 2px gap between
 * them. The rows under it carry the labels and numbers.
 */
function Donut({ rings, label, children }: { rings: { key: string; value: number; color: string }[][]; label: string; children?: ComponentChildren }) {
  const c = DONUT / 2;
  const w = rings.length > 1 ? 16 : DONUT_W;
  return (
    <div class="donut">
      <svg width={DONUT} height={DONUT} viewBox={`0 0 ${DONUT} ${DONUT}`} role="img" aria-label={label}>
        {rings.map((segs, ri) => {
          const r = c - w / 2 - 2 - ri * (w + 6);
          const len = 2 * Math.PI * r;
          const shown = segs.filter((s) => s.value > 0);
          const total = shown.reduce((s, x) => s + x.value, 0);
          let offset = 0;
          return (
            <g key={ri}>
              <circle cx={c} cy={c} r={r} fill="none" class="donut-track" stroke-width={w} />
              {total > 0 &&
                shown.map((s) => {
                  const frac = s.value / total;
                  const arc = Math.max(0.5, frac * len - (shown.length > 1 ? 2 : 0));
                  const el = (
                    <circle
                      key={s.key}
                      cx={c}
                      cy={c}
                      r={r}
                      fill="none"
                      stroke={s.color}
                      stroke-width={w}
                      stroke-dasharray={`${arc} ${len - arc}`}
                      stroke-dashoffset={-offset}
                      transform={`rotate(-90 ${c} ${c})`}
                    >
                      <title>{`${s.key}: ${formatPct(frac)}`}</title>
                    </circle>
                  );
                  offset += frac * len;
                  return el;
                })}
            </g>
          );
        })}
      </svg>
      {children && <div class="donut-center">{children}</div>}
    </div>
  );
}

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

/** A return: +12.1%, -6.4%, 0.0%; a dash without the rates to compute it. */
const ret = (v: number | undefined) => {
  if (v === undefined) return '—';
  const x = Math.round(v * 1000) / 10;
  return `${x > 0 ? '+' : ''}${(x === 0 ? 0 : x).toFixed(1)}%`;
};

function Ret({ v }: { v: number | undefined }) {
  return <span class={cx(v !== undefined && Math.round(v * 1000) < 0 && 'neg')}>{ret(v)}</span>;
}

const DIMENSION: Record<string, string> = {
  country: 'Country',
  institution: 'Bank',
  currency: 'Currency',
  asset_class: 'Asset class',
  high_risk: 'High-risk assets',
};

type Bench = 'target' | '60/40' | 'All Weather';

/**
 * Capital by asset class with its yield in USD and risk, compared with a benchmark (the target from the Risk sheet
 * or a reference portfolio), and the concentration limits of the Risk sheet.
 */
function CapitalAllocation() {
  const cfg = allocationConfig.value;
  const hasTarget = cfg.targets.length > 0;
  const [bench, setBench] = useState<Bench>(hasTarget ? 'target' : '60/40');
  const [open, setOpen] = useState<string | null>(null);
  const w = allocWindow.value;
  const now = today();
  const a = capitalAllocation(accounts.value, balances.value, rates.value, { window: w, today: now, fx: cfg.fx, txs: liveTransactions.value });
  if (a.gross <= 0) return null;
  const threshold = Number(serverSettings.value.high_risk_threshold) || 3.5;
  const checks = checkLimits(a, cfg, threshold);
  const targets: Partial<Record<string, number>> =
    bench === 'target' ? Object.fromEntries(cfg.targets.map((t) => [t.class, t.target])) : BENCHMARKS[bench];
  const rows = compareToBenchmark(a, targets);

  return (
    <>
      <section class="section">
        <div class="section-header">
          <span>Capital allocation</span>
          <span class="section-header-right">
            <Usd value={a.gross} whole />
          </span>
        </div>
        <div class="an-switch">
          <Segmented
            value={w}
            onChange={setAllocWindow}
            options={[
              { value: 'ytd', label: 'YTD' },
              { value: 'y1', label: '12 months' },
            ]}
          />
        </div>
        <div class="group">
          <div class="alloc-kpis">
            <div class="an-kpi">
              <span class="an-key">Return in USD</span>
              <b>
                <Ret v={a.inUsd} />
              </b>
              <span class="an-kpi-sub">
                {a.inUsd === undefined
                  ? 'no rate history yet'
                  : `since ${w === 'ytd' ? 'Jan 1' : shortDay(windowStart('y1', now), now)} · ${ret(a.local)} before currency moves`}
              </span>
            </div>
            <div class="an-kpi">
              <span class="an-key">Risk</span>
              <b>
                {a.risk !== undefined ? a.risk.toFixed(1) : '—'}
                <small> / 7</small>
              </b>
              <span class="an-kpi-sub">weighted, 1 low … 7 high</span>
            </div>
          </div>
          <div class="an-chart-head alloc-chart-head">
            <span class="an-chart-title">By asset class</span>
            <ChartToggle value={allocChart.value} onChange={setAllocChart} />
          </div>
          {allocChart.value === 'ring' && (
            <Donut
              label="Capital by asset class"
              rings={[[...a.lines].sort((x, y) => classOrder(x.cls) - classOrder(y.cls)).map((l) => ({ key: l.cls, value: l.usd, color: colorOf(l.cls) }))]}
            >
              <span class="spend-ring-key">Assets</span>
              <b>
                <Usd value={a.gross} whole />
              </b>
              <span class="spend-ring-of">{ret(a.inUsd)} in USD</span>
            </Donut>
          )}
          {a.lines.map((l) => {
            const expanded = open === l.cls;
            const ring = allocChart.value === 'ring';
            return (
              <Fragment key={l.cls}>
                <button type="button" class={cx('row row-tap an-row', expanded && 'an-row-open')} onClick={() => setOpen(expanded ? null : l.cls)}>
                  <div class="row-main">
                    <div class="an-row-top">
                      <span class="row-title">
                        {ring && <i class="alloc-dot" style={{ background: colorOf(l.cls) }} />}
                        {l.cls}
                      </span>
                      <span class="an-row-amount">
                        <Usd value={l.usd} whole />
                      </span>
                    </div>
                    {!ring && (
                      <div class="an-bar">
                        <div class="alloc-fill" style={{ width: `${l.share * 100}%` }} />
                      </div>
                    )}
                    <div class="row-sub">
                      {formatPct(l.share)} · <Ret v={l.inUsd} /> in USD
                      {l.risk !== undefined && ` · risk ${l.risk.toFixed(1)}`}
                    </div>
                  </div>
                </button>
                {expanded && (
                  <div class="an-sub">
                    {l.holdings.map((h) => (
                      <button
                        type="button"
                        key={h.account.id}
                        class="row row-tap alloc-hold"
                        onClick={() => navigate(`/accounts/${encodeURIComponent(h.account.id)}/view`)}
                      >
                        <span class="alloc-hold-main">
                          <span class="row-title">{h.account.name}</span>
                          <span class="row-sub">
                            {h.rate > 0 && `${pct1(h.rate)} a year · `}
                            {h.local !== 0 && ret(h.local) !== ret(h.inUsd) && `${ret(h.local)} in ${h.account.currency} → `}
                            <Ret v={h.inUsd} /> in USD
                            {h.priceSince && ` · price since ${shortDay(h.priceSince, now)}`}
                            {h.risk !== undefined && ` · risk ${h.risk.toFixed(1)}`}
                          </span>
                        </span>
                        <span class="alloc-hold-value">
                          <Usd value={h.usd} whole />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
        <div class="section-footer">
          Assets only: net worth (<Usd value={netWorth()} whole />) also subtracts what you owe (
          <Usd value={Math.max(0, a.gross - netWorth())} whole />: credit cards, debts to people, taxes to pay). Return in USD
          over the period, as if held all along: interest at the account's current rate after tax for the time elapsed,
          times the actual change of its currency against the dollar (daily rates, RatesHistory); gold follows its price.
          Stocks and crypto (not stablecoins) add their revaluations from reconciliations, kept since the account's first
          day in the app.
        </div>
      </section>

      <section class="section">
        <div class="section-header alloc-bench-head">
          <span>Against a benchmark</span>
          <ChartToggle value={benchChart.value} onChange={setBenchChart} />
        </div>
        <div class="an-switch">
          <Segmented
            value={bench}
            onChange={setBench}
            options={[
              ...(hasTarget ? [{ value: 'target' as Bench, label: 'Your target' }] : []),
              { value: '60/40' as Bench, label: '60/40' },
              { value: 'All Weather' as Bench, label: 'All Weather' },
            ]}
          />
        </div>
        <div class="group">
          {benchChart.value === 'ring' && (
            <Donut
              label="Now (outer ring) against the target (inner ring)"
              rings={[
                [...rows].sort((x, y) => classOrder(x.cls) - classOrder(y.cls)).map((r) => ({ key: r.cls, value: r.now, color: colorOf(r.cls) })),
                [...rows].sort((x, y) => classOrder(x.cls) - classOrder(y.cls)).map((r) => ({ key: r.cls, value: r.target, color: colorOf(r.cls) })),
              ]}
            >
              <span class="spend-ring-key">Outer: now</span>
              <span class="spend-ring-key">Inner: target</span>
            </Donut>
          )}
          {rows.map((r) => {
            const d = r.now - r.target;
            const usd = Math.abs(d) * a.investableTotal;
            const ring = benchChart.value === 'ring';
            return (
              <div class="row an-row" key={r.cls}>
                <div class="row-main">
                  <div class="an-row-top">
                    <span class="row-title">
                      {ring && <i class="alloc-dot" style={{ background: colorOf(r.cls) }} />}
                      {r.cls}
                    </span>
                    <span class="an-row-amount">
                      {formatPct(r.now)} <span class="muted">/ {formatPct(r.target)}</span>
                    </span>
                  </div>
                  {!ring && (
                    <div class="an-bar alloc-bench-bar">
                      <div class="alloc-fill" style={{ width: `${Math.min(1, r.now) * 100}%` }} />
                      <span class="alloc-tick" style={{ left: `${Math.min(1, r.target) * 100}%` }} />
                    </div>
                  )}
                  <div class="row-sub">
                    {Math.abs(d) <= 0.05 ? (
                      'Within ±5 pp of the target'
                    ) : (
                      <>
                        {Math.round(Math.abs(d) * 100)} pp {d > 0 ? 'over' : 'under'} · {d > 0 ? 'trim' : 'add'} ≈{' '}
                        <Usd value={usd} whole />
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div class="section-footer">
          Now / target, of assets except cash, loans to people and the emergency fund (<Usd value={a.investableTotal} whole />).
          {bench === 'target' ? ' Your target is the Risk sheet\'s (edit it there).' : bench === '60/40' ? ' 60% stocks, 40% bonds.' : ' 30% stocks, 55% bonds, 15% commodities.'}{' '}
          Deposits stand in for bonds here: they hold the steady part of the portfolio, with bank and currency risk instead
          of price swings.
        </div>
      </section>

      {checks.length > 0 && (
        <section class="section">
          <div class="section-header">
            <span>Risks</span>
          </div>
          <div class="group">
            {checks.map((c, i) => (
              <Row
                key={i}
                icon={<span class="alloc-status-icon">{c.status === 'over' ? '🔴' : c.status === 'near' ? '🟡' : '🟢'}</span>}
                title={`${DIMENSION[c.dimension] ?? c.dimension}: ${c.value}`}
                subtitle={`${formatPct(c.share)} of assets · limit ${formatPct(c.limit)}`}
                value={<span class={cx('alloc-status', c.status)}>{c.status === 'over' ? 'Over' : c.status === 'near' ? 'Near' : 'OK'}</span>}
              />
            ))}
          </div>
          <div class="section-footer">Concentration limits of the Risk sheet, as a share of gross assets.</div>
        </section>
      )}
    </>
  );
}

/** Pull Home down to sync: a gear turns with the pull and spins while the sync runs. */
async function pullSync(): Promise<void> {
  if (!config.value.url || !config.value.key) {
    showToast('Connect the sheet in Settings');
    return;
  }
  const ok = await syncNow();
  if (!ok) showToast(syncStatus.value.message || 'Sync failed');
}

export function HomeScreen() {
  const root = useScrollMemory<HTMLElement>('home');
  const empty = activeAccounts.value.length === 0;
  const { pull, refreshing, dragging } = usePullToRefresh(root, pullSync);
  return (
    <main class="screen" ref={root}>
      <div class={cx('ptr', dragging && 'dragging', refreshing && 'spinning')} style={{ height: pull }} aria-hidden={!refreshing}>
        <span class="ptr-gear" style={{ opacity: refreshing ? 1 : pullProgress(pull), transform: refreshing ? undefined : `rotate(${pull * 4}deg)` }}>
          <IconGear size={26} />
        </span>
      </div>
      <div class="home-top">
        <span class="home-brand">Finance OS</span>
        <CurrencySwitch />
      </div>
      <CapitalCard />
      {!empty && <ResidencyCard />}
      {!empty && <TaxesCard />}
      {!empty && <AverageCard />}
      <ReconcileBanner />
      {empty ? (
        <Section>
          <Row
            title="No accounts yet"
            subtitle="Connect the spreadsheet in Settings or add an account"
            chevron
            onClick={() => navigate('/settings')}
          />
        </Section>
      ) : (
        <>
          <Analytics />
          <CapitalAllocation />
        </>
      )}
    </main>
  );
}
