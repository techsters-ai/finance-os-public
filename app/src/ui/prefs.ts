// Display preferences that live only in this browser (localStorage).
import { signal } from '@preact/signals';

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: not a big deal */
  }
}

/** Hide all amounts (tap on net worth on Home). */
export const hideAmounts = signal<boolean>(read('fos.hideAmounts', false));

export function toggleHideAmounts(): void {
  hideAmounts.value = !hideAmounts.value;
  write('fos.hideAmounts', hideAmounts.value);
}

export const showArchived = signal<boolean>(read('fos.showArchived', false));

export function toggleShowArchived(): void {
  showArchived.value = !showArchived.value;
  write('fos.showArchived', showArchived.value);
}

/** Which accounts the transactions board shows. Liquid includes credit cards; Total is every group but debts. */
export type BoardGroup = 'total' | 'liquid' | 'investment' | 'business';

export const boardGroup = signal<BoardGroup>(read('fos.boardGroup', 'liquid'));

export function setBoardGroup(g: BoardGroup): void {
  boardGroup.value = g;
  write('fos.boardGroup', g);
}

export type PeriodPreset = 'month' | 'last_month' | '3m' | '6m' | '12m' | 'ytd' | 'all' | 'custom';

/** Home analytics period. Presets are recomputed from today on every launch; custom keeps its dates. */
export interface PeriodPref {
  preset: PeriodPreset;
  from?: string;
  to?: string;
}

export const analyticsPeriod = signal<PeriodPref>(read('fos.analyticsPeriod', { preset: 'month' }));

/** The board's period (its Expenses, Income and category coins); the header's date button picks it. */
export const boardPeriod = signal<PeriodPref>(read('fos.boardPeriod', { preset: 'month' }));

export function setBoardPeriod(p: PeriodPref): void {
  boardPeriod.value = p;
  write('fos.boardPeriod', p);
}

export function setAnalyticsPeriod(p: PeriodPref): void {
  analyticsPeriod.value = p;
  write('fos.analyticsPeriod', p);
}

/** Currency for every USD total in the app (Home, the board, group totals): converted at the current rate. */
export type DisplayCurrency = 'USD' | 'EUR' | 'GBP';
export const DISPLAY_CURRENCIES: DisplayCurrency[] = ['USD', 'EUR', 'GBP'];

export const displayCurrency = signal<DisplayCurrency>(read('fos.displayCurrency', 'USD'));

export function setDisplayCurrency(c: DisplayCurrency): void {
  displayCurrency.value = c;
  write('fos.displayCurrency', c);
}

/** Show accounts that are hidden by hand or (automatically) for a zero balance. */
export const showHidden = signal<boolean>(read('fos.showHidden', false));

export function toggleShowHidden(): void {
  showHidden.value = !showHidden.value;
  write('fos.showHidden', showHidden.value);
}

/** Home spending chart: bars by month/day, or a ring filling up toward the budget. */
export type SpendChart = 'bars' | 'ring';

export const spendChart = signal<SpendChart>(read('fos.spendChart', 'ring'));

export function setSpendChart(v: SpendChart): void {
  spendChart.value = v;
  write('fos.spendChart', v);
}

/** Capital allocation and its benchmark: a donut or the bars. */
export const allocChart = signal<SpendChart>(read('fos.allocChart', 'bars'));
export function setAllocChart(v: SpendChart): void {
  allocChart.value = v;
  write('fos.allocChart', v);
}
/** Capital allocation's realized return: since Jan 1 or the last 12 months. */
export const allocWindow = signal<'ytd' | 'y1'>(read<string>('fos.allocWindow', 'ytd') === 'y1' ? 'y1' : 'ytd');
export function setAllocWindow(v: 'ytd' | 'y1'): void {
  allocWindow.value = v;
  write('fos.allocWindow', v);
}
export const benchChart = signal<SpendChart>(read('fos.benchChart', 'bars'));
export function setBenchChart(v: SpendChart): void {
  benchChart.value = v;
  write('fos.benchChart', v);
}

/** Tax residency in Settings: since Jan 1, the last 12 months or last year. */
// 'last' (last year) was stored before a past year could be picked: it's 'year' now.
const storedWindow = read<string>('fos.residencyWindow', 'ytd');
export const residencyWindow = signal<'ytd' | 'y1' | 'year'>(storedWindow === 'last' ? 'year' : storedWindow === 'y1' || storedWindow === 'year' ? storedWindow : 'ytd');
export function setResidencyWindow(v: 'ytd' | 'y1' | 'year'): void {
  residencyWindow.value = v;
  write('fos.residencyWindow', v);
}

