// In-memory app state (signals) on top of IndexedDB.
import { computed, signal } from '@preact/signals';
import type { Account, AllocationConfig, Automation, Category, LocationDay, TaxMark, TaxRate, TaxSummary, Entity, HistoryRow, Rates, ServerMetrics, Transaction } from '../domain/types';
import { capitalSummary, computeBalances } from '../domain/balances';
import { isHiddenAccount } from '../domain/visibility';
import { normalize } from '../domain/normalize';
import { expenseBucket, type SpendBucket } from '../domain/scope';
import { debtBoards } from '../domain/debts';
import { byAccountOrder } from '../domain/order';
import { taxIdOf } from '../domain/tax';
import { putWithOutbox, putLocationFromServer, loadSnapshot, pendingCount, setMeta, getMeta, cleanAllocation, cleanTaxes, cleanTaxRates, type SyncConfig } from './db';
import { nowIso } from './ids';
import { parseTags } from '../domain/tags';

export type SyncPhase = 'unconfigured' | 'idle' | 'syncing' | 'ok' | 'offline' | 'error';
export interface SyncStatus {
  phase: SyncPhase;
  message?: string;
}

export const ready = signal(false);
export const accounts = signal<Account[]>([]);
export const categories = signal<Category[]>([]);
export const transactions = signal<Transaction[]>([]);
export const automations = signal<Automation[]>([]);
export const taxMarks = signal<TaxMark[]>([]);
export const locations = signal<LocationDay[]>([]);
export const rates = signal<Rates>({ USD: 1 });
export const ratesAt = signal('');
/** The Settings sheet's values, with the ones changed on the phone and not sent yet on top. */
export const serverSettings = signal<Record<string, unknown>>({});
export const pendingSettings = signal<Record<string, string>>({});
export const serverMetrics = signal<ServerMetrics>({});
export const history = signal<HistoryRow[]>([]);
export const allocationConfig = signal<AllocationConfig>({ targets: [], limits: [] });
/** Taxes owed and accrued by month (the server's Taxes sheet); undefined until a server sends it. */
export const taxSummary = signal<TaxSummary | undefined>(undefined);
/** Headline tax rates by country of residence (the TaxRates sheet). */
export const taxRates = signal<TaxRate[]>([]);
export const pending = signal(0);
export const config = signal<SyncConfig>({ url: '', key: '' });
export const syncStatus = signal<SyncStatus>({ phase: 'idle' });
export const lastSyncAt = signal('');
export const lastAccountByCategory = signal<Record<string, string>>({});
export const lastAccount = signal('');
export const reconciledMonths = signal<string[]>([]);


function byCategoryOrder(a: Category, b: Category): number {
  return (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name);
}

/** Newest first: date, then creation time. */
function byTxOrder(a: Transaction, b: Transaction): number {
  return b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || '');
}

export const sortedAccounts = computed(() => [...accounts.value].sort(byAccountOrder));
export const activeAccounts = computed(() => sortedAccounts.value.filter((a) => !a.archived));
export const accountsById = computed(() => new Map(accounts.value.map((a) => [a.id, a])));
export const sortedCategories = computed(() => [...categories.value].sort(byCategoryOrder));
export const categoriesById = computed(() => new Map(categories.value.map((c) => [c.id, c])));
export const liveTransactions = computed(() => transactions.value.filter((t) => !t.deleted).sort(byTxOrder));
export const balances = computed(() => computeBalances(accounts.value, transactions.value));
export const capital = computed(() => capitalSummary(accounts.value, balances.value, rates.value));

/** The board each person (debt account) belongs to, from the latest transfer with them; missing = liquid. */
export const debtBoardOf = computed(() => debtBoards(liveTransactions.value, accountsById.value));

/** Personal budget or business / investment spending (see domain/scope.ts); subcategories follow their parent. */
export function spendBucket(t: Transaction): SpendBucket {
  const cat = categoriesById.value.get(t.category_id);
  const top = cat?.parent_id ? categoriesById.value.get(cat.parent_id) ?? cat : cat;
  return expenseBucket(top, accountsById.value.get(t.account_id)?.group);
}

/** Hidden by hand or for a zero balance: left out of lists unless "Show hidden" is on. Totals still count it. */
export function accountHidden(a: Account): boolean {
  return isHiddenAccount(a, balances.value.get(a.id) ?? 0);
}

/** Every tag in use, most used first, with the categories it was used in. */
export const tagStats = computed(() => {
  const stats = new Map<string, { tag: string; count: number; last: string; categories: Map<string, number> }>();
  for (const t of liveTransactions.value) {
    for (const tag of parseTags(t.tags)) {
      const s = stats.get(tag) ?? { tag, count: 0, last: '', categories: new Map<string, number>() };
      s.count++;
      if (t.date > s.last) s.last = t.date;
      if (t.category_id) s.categories.set(t.category_id, (s.categories.get(t.category_id) ?? 0) + 1);
      stats.set(tag, s);
    }
  }
  return [...stats.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last) || a.tag.localeCompare(b.tag));
});

/** Tags for a category: the ones used with it (most used with it first), and the rest by popularity. */
export function suggestedTags(categoryId: string): { used: string[]; other: string[] } {
  const all = tagStats.value;
  const used = all.filter((s) => s.categories.has(categoryId)).sort((a, b) => b.categories.get(categoryId)! - a.categories.get(categoryId)!);
  const other = all.filter((s) => !s.categories.has(categoryId));
  return { used: used.map((s) => s.tag), other: other.map((s) => s.tag) };
}

export function currencyOf(accountId: string): string | undefined {
  return accountsById.value.get(accountId)?.currency;
}

/** Categories of a kind ordered as 'parent, its children'. */
export function categoryTree(kind: Category['kind'], includeArchived = false): Category[] {
  const list = sortedCategories.value.filter((c) => c.kind === kind && (includeArchived || !c.archived));
  const ids = new Set(list.map((c) => c.id));
  const roots = list.filter((c) => !c.parent_id || !ids.has(c.parent_id));
  const out: Category[] = [];
  for (const r of roots) {
    out.push(r);
    for (const ch of list) if (ch.parent_id === r.id) out.push(ch);
  }
  return out;
}

// Writes and reloads run one at a time so that a reload after a sync
// doesn't wipe a record saved at the same moment from memory.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

// ── Loading ─────────────────────────────────────────────────

export function reloadFromDb(): Promise<void> {
  return serial(loadIntoSignals);
}

async function loadIntoSignals(): Promise<void> {
  const snap = await loadSnapshot();
  // Records saved by an older version lack newer fields (scope, visibility…): normalize fills in the defaults.
  accounts.value = snap.accounts.map((r) => normalize('accounts', r as unknown as Record<string, unknown>));
  categories.value = snap.categories.map((r) => normalize('categories', r as unknown as Record<string, unknown>));
  transactions.value = snap.transactions.map((r) => normalize('transactions', r as unknown as Record<string, unknown>));
  automations.value = (snap.automations ?? []).map((r) => normalize('automations', r as unknown as Record<string, unknown>));
  taxMarks.value = (snap.taxMarks ?? []).map((r) => normalize('tax_marks', r as unknown as Record<string, unknown>));
  locations.value = (snap.locations ?? []).map((r) => normalize('locations', r as unknown as Record<string, unknown>));
  pending.value = snap.pending;
  const m = snap.meta;
  rates.value = { USD: 1, ...(m.rates ?? {}) };
  ratesAt.value = m.rates_at ?? '';
  pendingSettings.value = m.pending_settings ?? {};
  serverSettings.value = { ...(m.server_settings ?? {}), ...pendingSettings.value };
  serverMetrics.value = m.server_metrics ?? {};
  history.value = m.history ?? [];
  allocationConfig.value = m.allocation ? cleanAllocation(m.allocation) : { targets: [], limits: [] };
  taxSummary.value = cleanTaxes(m.taxes);
  taxRates.value = cleanTaxRates(m.tax_rates);
  config.value = m.config ?? { url: '', key: '' };
  lastSyncAt.value = m.last_sync_at ?? '';
  lastAccountByCategory.value = m.last_account_by_category ?? {};
  lastAccount.value = m.last_account ?? '';
  reconciledMonths.value = m.reconciled_months ?? [];
  ready.value = true;
}

export async function refreshPending(): Promise<void> {
  pending.value = await pendingCount();
}

// ── Changes ─────────────────────────────────────────────────

let changeListener: (() => void) | null = null;

/** Sync subscribes here to run ~2 s after an entry. */
export function setChangeListener(fn: () => void): void {
  changeListener = fn;
}

function upsertIn<T extends { id: string }>(list: T[], rec: T): T[] {
  const i = list.findIndex((x) => x.id === rec.id);
  if (i === -1) return [...list, rec];
  const copy = list.slice();
  copy[i] = rec;
  return copy;
}

async function persist(entity: Entity, rec: Account | Category | Transaction | Automation | TaxMark | LocationDay): Promise<void> {
  await serial(async () => {
    await putWithOutbox(entity, rec);
    if (entity === 'accounts') accounts.value = upsertIn(accounts.value, rec as Account);
    else if (entity === 'categories') categories.value = upsertIn(categories.value, rec as Category);
    else if (entity === 'automations') automations.value = upsertIn(automations.value, rec as Automation);
    else if (entity === 'tax_marks') taxMarks.value = upsertIn(taxMarks.value, rec as TaxMark);
    else if (entity === 'locations') locations.value = upsertIn(locations.value, rec as LocationDay);
    else transactions.value = upsertIn(transactions.value, rec as Transaction);
    pending.value = await pendingCount();
  });
  changeListener?.();
}

export async function saveTransaction(tx: Transaction): Promise<void> {
  await persist('transactions', { ...tx, updated_at: tx.updated_at || nowIso() });
}

/** Deleting an income deletes its automatic tax too (domain/tax.ts). */
export async function deleteTransaction(tx: Transaction): Promise<void> {
  await persist('transactions', { ...tx, deleted: true, updated_at: nowIso() });
  const tax = transactions.value.find((t) => t.id === taxIdOf(tx.id) && !t.deleted);
  if (tax) await persist('transactions', { ...tax, deleted: true, updated_at: nowIso() });
}

/** The server counts it in the taxes (apps-script/Taxes.js) a minute after the sync; the app at once. */
export async function saveTaxMark(m: TaxMark): Promise<void> {
  await persist('tax_marks', { ...m, updated_at: nowIso(), created_at: m.created_at || nowIso() });
}

/** A day's countries set by hand (deleted: the day is assumed again from the one before). */
export async function saveLocation(d: LocationDay): Promise<void> {
  await persist('locations', { ...d, source: 'manual', updated_at: nowIso(), created_at: d.created_at || nowIso() });
}

/** A check-in the server recorded (data/location.ts): shown at once, as the next sync would bring it. */
export async function applyServerLocation(raw: Record<string, unknown>): Promise<void> {
  await serial(async () => {
    const rec = await putLocationFromServer(raw);
    if (rec) locations.value = upsertIn(locations.value, rec);
  });
}

/** The server runs it (apps-script/Automations.js) a minute after the sync that carries it, then daily. */
export async function saveAutomation(a: Automation): Promise<void> {
  await persist('automations', { ...a, updated_at: nowIso(), created_at: a.created_at || nowIso() });
}

export async function saveAccount(acc: Account): Promise<void> {
  await persist('accounts', { ...acc, updated_at: nowIso() });
}

export async function saveCategory(cat: Category): Promise<void> {
  await persist('categories', { ...cat, updated_at: nowIso() });
}

export async function rememberAccount(categoryId: string, accountId: string): Promise<void> {
  lastAccount.value = accountId;
  await setMeta('last_account', accountId);
  if (!categoryId) return;
  lastAccountByCategory.value = { ...lastAccountByCategory.value, [categoryId]: accountId };
  await setMeta('last_account_by_category', lastAccountByCategory.value);
}

export async function markMonthReconciled(month: string): Promise<void> {
  const list = (await getMeta('reconciled_months')) ?? [];
  if (!list.includes(month)) list.push(month);
  reconciledMonths.value = list;
  await setMeta('reconciled_months', list);
}

/** Settings the server sent back after a change (data/sync.ts), kept as a sync keeps them; unsent ones stay on top. */
export async function keepServerSettings(s: Record<string, unknown>): Promise<void> {
  serverSettings.value = { ...s, ...pendingSettings.value };
  await setMeta('server_settings', s);
}

/**
 * A setting changed on the phone: in use at once, sent to the server in the background (data/sync.ts
 * saveServerSetting), and again with each sync until it's there. `shown` are values to show meanwhile (what the
 * server will write along with it).
 */
export async function setLocalSetting(key: string, value: string, shown: Record<string, string> = {}): Promise<void> {
  pendingSettings.value = { ...pendingSettings.value, [key]: value };
  serverSettings.value = { ...serverSettings.value, ...shown, [key]: value };
  await setMeta('pending_settings', pendingSettings.value);
}

/** The server has it now (unless it was changed again meanwhile). */
export async function settingSent(key: string, value: string): Promise<void> {
  if (pendingSettings.value[key] !== value) return;
  const rest = { ...pendingSettings.value };
  delete rest[key];
  pendingSettings.value = rest;
  await setMeta('pending_settings', rest);
}

export async function saveConfig(cfg: SyncConfig): Promise<void> {
  const clean = { url: cfg.url.trim(), key: cfg.key.trim() };
  config.value = clean;
  await setMeta('config', clean);
}

/** Default account for a category: the last one used with it, otherwise the last one used at all. */
export function defaultAccountFor(categoryId: string): Account | undefined {
  const active = activeAccounts.value;
  const pick = (id: string | undefined) => (id ? active.find((a) => a.id === id) : undefined);
  return (
    pick(lastAccountByCategory.value[categoryId]) ??
    pick(lastAccount.value) ??
    active.find((a) => a.group === 'liquid') ??
    active[0]
  );
}
