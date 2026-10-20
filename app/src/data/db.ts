// IndexedDB: records, outbox and service values (meta).
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Account, Automation, Category, Entity, LocationDay, TaxMark, TaxRate, HistoryRow, Rates, ServerMetrics, Transaction, AllocationConfig, FxPoint, FxWindow, FxWindows, TaxSummary } from '../domain/types';
import { isNewer, normalize } from '../domain/normalize';
import { uuid } from './ids';

export const ENTITIES: Entity[] = ['accounts', 'categories', 'transactions', 'automations', 'tax_marks', 'locations'];

/** One record waiting to be sent. Key entity:id: edits of one record collapse into the latest. */
export interface OutboxOp {
  key: string;
  entity: Entity;
  id: string;
  record: Record<string, unknown>;
  updated_at: string;
  /** Op version: removed after a sync only if nobody overwrote it during the request. */
  rev: string;
}

export interface SyncConfig {
  url: string;
  key: string;
}

export interface MetaValues {
  server_ts: string | null;
  rates: Rates;
  rates_at: string;
  server_settings: Record<string, unknown>;
  /** Settings changed on the phone and not yet on the server (store.ts setLocalSetting). */
  pending_settings: Record<string, string>;
  server_metrics: ServerMetrics;
  history: HistoryRow[];
  allocation: AllocationConfig;
  taxes: TaxSummary;
  tax_rates: TaxRate[];
  /** The server's fingerprint of tax_rates: sent with each sync, the rows come back only when it changed. */
  tax_rates_hash: string;
  last_sync_at: string;
  config: SyncConfig;
  last_account_by_category: Record<string, string>;
  last_account: string;
  reconciled_months: string[];
}
export type MetaKey = keyof MetaValues;

interface FosSchema extends DBSchema {
  accounts: { key: string; value: Account };
  categories: { key: string; value: Category };
  transactions: { key: string; value: Transaction; indexes: { by_date: string } };
  automations: { key: string; value: Automation };
  tax_marks: { key: string; value: TaxMark };
  locations: { key: string; value: LocationDay };
  outbox: { key: string; value: OutboxOp };
  meta: { key: string; value: unknown };
}

export type FosDB = IDBPDatabase<FosSchema>;

const DB_NAME = 'finance-os';
let dbPromise: Promise<FosDB> | null = null;

export function getDb(): Promise<FosDB> {
  if (!dbPromise) {
    // Version 2 adds automations, 3 tax marks, 4 locations; a phone on an older version keeps its data and gets the new stores.
    dbPromise = openDB<FosSchema>(DB_NAME, 4, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('accounts', { keyPath: 'id' });
          db.createObjectStore('categories', { keyPath: 'id' });
          const txs = db.createObjectStore('transactions', { keyPath: 'id' });
          txs.createIndex('by_date', 'date');
          db.createObjectStore('outbox', { keyPath: 'key' });
          db.createObjectStore('meta');
        }
        if (oldVersion < 2) db.createObjectStore('automations', { keyPath: 'id' });
        if (oldVersion < 3) db.createObjectStore('tax_marks', { keyPath: 'id' });
        if (oldVersion < 4) db.createObjectStore('locations', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

/** For tests: close and forget the connection. */
export async function resetDbForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

export async function getMeta<K extends MetaKey>(key: K): Promise<MetaValues[K] | undefined> {
  const db = await getDb();
  return (await db.get('meta', key)) as MetaValues[K] | undefined;
}

export async function setMeta<K extends MetaKey>(key: K, value: MetaValues[K]): Promise<void> {
  const db = await getDb();
  await db.put('meta', value, key);
}

export interface Snapshot {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  automations: Automation[];
  taxMarks: TaxMark[];
  locations: LocationDay[];
  pending: number;
  meta: Partial<MetaValues>;
}

export async function loadSnapshot(): Promise<Snapshot> {
  const db = await getDb();
  const tx = db.transaction(['accounts', 'categories', 'transactions', 'automations', 'tax_marks', 'locations', 'outbox', 'meta'], 'readonly');
  const [accounts, categories, transactions, automations, taxMarks, locations, pending, metaKeys, metaVals] = await Promise.all([
    tx.objectStore('accounts').getAll(),
    tx.objectStore('categories').getAll(),
    tx.objectStore('transactions').getAll(),
    tx.objectStore('automations').getAll(),
    tx.objectStore('tax_marks').getAll(),
    tx.objectStore('locations').getAll(),
    tx.objectStore('outbox').count(),
    tx.objectStore('meta').getAllKeys(),
    tx.objectStore('meta').getAll(),
  ]);
  await tx.done;
  const meta: Record<string, unknown> = {};
  metaKeys.forEach((k, i) => (meta[String(k)] = metaVals[i]));
  return { accounts, categories, transactions, automations, taxMarks, locations, pending, meta: meta as Partial<MetaValues> };
}

/** Saves the record and queues the op in the outbox in one transaction. */
export async function putWithOutbox<E extends Entity>(entity: E, record: Account | Category | Transaction | Automation | TaxMark | LocationDay): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([entity, 'outbox'], 'readwrite');
  await (tx.objectStore(entity) as unknown as { put(v: unknown): Promise<unknown> }).put(record);
  await tx.objectStore('outbox').put({
    key: `${entity}:${record.id}`,
    entity,
    id: record.id,
    record: { ...record } as unknown as Record<string, unknown>,
    updated_at: record.updated_at,
    rev: uuid(),
  });
  await tx.done;
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  return db.count('outbox');
}

const ENTITY_ORDER: Record<Entity, number> = { accounts: 0, categories: 1, transactions: 2, automations: 3, tax_marks: 4, locations: 5 };

export async function readOutbox(): Promise<OutboxOp[]> {
  const db = await getDb();
  const ops = await db.getAll('outbox');
  return ops.sort((a, b) => ENTITY_ORDER[a.entity] - ENTITY_ORDER[b.entity] || a.updated_at.localeCompare(b.updated_at));
}

/** Merge rule: an incoming record overwrites the local one unless a pending op has a newer updated_at. */
export function shouldOverwrite(incomingUpdatedAt: string, pending: OutboxOp | undefined): boolean {
  return !(pending && isNewer(pending.updated_at, incomingUpdatedAt));
}

/**
 * A day the server wrote outside a sync (a check-in), kept the way a sync would keep it: not over a newer local
 * edit still waiting to be sent. Returns the day, or null when it was kept out.
 */
export async function putLocationFromServer(raw: Record<string, unknown>): Promise<LocationDay | null> {
  const db = await getDb();
  const tx = db.transaction(['locations', 'outbox'], 'readwrite');
  const rec = normalize('locations', raw);
  const keep = !!rec.id && shouldOverwrite(rec.updated_at, await tx.objectStore('outbox').get(`locations:${rec.id}`));
  if (keep) await tx.objectStore('locations').put(rec);
  await tx.done;
  return keep ? rec : null;
}

export interface SyncChanges {
  accounts?: unknown[];
  categories?: unknown[];
  transactions?: unknown[];
  automations?: unknown[];
  tax_marks?: unknown[];
  locations?: unknown[];
}

export interface ApplyInput {
  sent: OutboxOp[];
  changes: SyncChanges;
  serverTs: string;
  rates?: Rates;
  settings?: Record<string, unknown>;
  metrics?: ServerMetrics;
  history?: HistoryRow[];
  allocation?: AllocationConfig;
  taxes?: TaxSummary | null;
  taxRates?: unknown;
  taxRatesHash?: string;
  /** Full reload: local records without a pending op and without a server copy are deleted. */
  full?: boolean;
}

export interface ApplyResult {
  received: number;
  kept: number;
}

/** Applies a sync response atomically: incoming records, sent ops removal, serverTs, rates. */
export async function applySyncResponse(input: ApplyInput): Promise<ApplyResult> {
  const db = await getDb();
  const tx = db.transaction(['accounts', 'categories', 'transactions', 'automations', 'tax_marks', 'locations', 'outbox', 'meta'], 'readwrite');
  const outbox = tx.objectStore('outbox');
  let received = 0;
  let kept = 0;

  // 1. Remove sent ops unless they were overwritten during the request.
  for (const op of input.sent) {
    const cur = await outbox.get(op.key);
    if (cur && cur.rev === op.rev) await outbox.delete(op.key);
  }

  // 2. Incoming records.
  const pendingByKey = new Map((await outbox.getAll()).map((op) => [op.key, op]));
  for (const entity of ENTITIES) {
    const store = tx.objectStore(entity) as unknown as {
      put(v: unknown): Promise<unknown>;
      getAllKeys(): Promise<string[]>;
      delete(k: string): Promise<void>;
    };
    const incoming = Array.isArray(input.changes[entity]) ? (input.changes[entity] as Record<string, unknown>[]) : [];
    const seen = new Set<string>();
    for (const raw of incoming) {
      if (!raw || typeof raw !== 'object' || !raw.id) continue;
      const rec = normalize(entity, raw);
      seen.add(rec.id);
      received++;
      const pending = pendingByKey.get(`${entity}:${rec.id}`);
      if (shouldOverwrite(rec.updated_at, pending)) await store.put(rec);
      else kept++;
    }
    if (input.full) {
      for (const id of await store.getAllKeys()) {
        if (seen.has(id) || pendingByKey.has(`${entity}:${id}`)) continue;
        await store.delete(id);
      }
    }
  }

  // 3. Meta.
  const meta = tx.objectStore('meta');
  await meta.put(input.serverTs, 'server_ts');
  await meta.put(new Date().toISOString(), 'last_sync_at');
  if (input.rates && typeof input.rates === 'object') {
    const rates: Rates = { USD: 1 };
    for (const [k, v] of Object.entries(input.rates)) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n) && n > 0) rates[k.toUpperCase()] = n;
    }
    await meta.put(rates, 'rates');
    await meta.put(new Date().toISOString(), 'rates_at');
  }
  if (input.settings && typeof input.settings === 'object') await meta.put(input.settings, 'server_settings');
  if (input.metrics && typeof input.metrics === 'object') await meta.put(cleanMetrics(input.metrics), 'server_metrics');
  if (Array.isArray(input.history)) await meta.put(cleanHistory(input.history), 'history');
  if (input.allocation && typeof input.allocation === 'object') await meta.put(cleanAllocation(input.allocation), 'allocation');
  if (Array.isArray(input.taxRates)) {
    await meta.put(cleanTaxRates(input.taxRates), 'tax_rates');
    if (input.taxRatesHash) await meta.put(input.taxRatesHash, 'tax_rates_hash');
  }
  const taxes = cleanTaxes(input.taxes);
  if (taxes) await meta.put(taxes, 'taxes');
  await tx.done;
  return { received, kept };
}

function cleanMetrics(raw: ServerMetrics): ServerMetrics {
  const out: ServerMetrics = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) out[k as keyof ServerMetrics] = n;
  }
  return out;
}

function cleanFxPoints(raw: unknown): Record<string, FxPoint> {
  const out: Record<string, FxPoint> = {};
  for (const [k, p] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    const usd = Number(p?.usd);
    if (typeof p?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && usd > 0) out[k.toUpperCase()] = { date: p.date, usd };
  }
  return out;
}

function cleanFx(raw: unknown): FxWindows | undefined {
  const fx = raw as Partial<FxWindows> | undefined;
  const win = (w: unknown): FxWindow | undefined => {
    const x = w as Partial<FxWindow> | undefined;
    return x && typeof x.start === 'string' ? { start: x.start, rates: cleanFxPoints(x.rates) } : undefined;
  };
  const ytd = win(fx?.ytd);
  const y1 = win(fx?.y1);
  return ytd && y1 ? { ytd, y1, now: cleanFxPoints(fx?.now) } : undefined;
}

export function cleanTaxes(raw: unknown): TaxSummary | undefined {
  const t = raw as Partial<TaxSummary> | null | undefined;
  if (!t || typeof t !== 'object' || !Number.isFinite(Number(t.owedUsd))) return undefined;
  const accrued: Record<string, number> = {};
  for (const [m, v] of Object.entries(t.accrued ?? {})) if (/^\d{4}-\d{2}$/.test(m) && Number.isFinite(Number(v))) accrued[m] = Number(v);
  const rules = (Array.isArray(t.rules) ? t.rules : [])
    .filter((r) => r && typeof r.id === 'string' && Number.isFinite(Number(r.owedUsd)))
    .map((r) => ({
      id: r.id,
      label: String(r.label ?? r.id),
      owedUsd: Number(r.owedUsd),
      owed: { amount: Number(r.owed?.amount) || 0, currency: String(r.owed?.currency ?? 'USD') },
      periods: (Array.isArray(r.periods) ? r.periods : [])
        .filter((p) => p && typeof p.key === 'string')
        .map((p) => ({ key: p.key, accrued: Number(p.accrued) || 0, marked: Number(p.marked) || 0, owed: Number(p.owed) || 0, owedUsd: Number(p.owedUsd) || 0 })),
    }));
  const marks = Array.isArray(t.marks) ? t.marks.filter((x): x is string => typeof x === 'string') : [];
  return { owedUsd: Number(t.owedUsd), rules, accrued, marks, at: String(t.at ?? '') };
}

/** The TaxRates rows as the app keeps them: text fields, a country code, the threshold a number or ''. */
export function cleanTaxRates(raw: unknown): TaxRate[] {
  if (!Array.isArray(raw)) return [];
  const text = (v: unknown) => (v == null ? '' : String(v).trim());
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => {
      const days = Number(r.threshold_days);
      const rate = Number(r.foreign_rate);
      return {
        country: text(r.country).toUpperCase(),
        domestic_income: text(r.domestic_income),
        foreign_income: text(r.foreign_income),
        capital_gains: text(r.capital_gains),
        residency_rule: text(r.residency_rule),
        threshold_days: r.threshold_days !== '' && r.threshold_days != null && Number.isFinite(days) && days > 0 ? days : ('' as const),
        window: r.window === '12m' ? ('12m' as const) : ('year' as const),
        foreign_rate: r.foreign_rate !== '' && r.foreign_rate != null && Number.isFinite(rate) && rate >= 0 ? rate : ('' as const),
        residency_tests: text(r.residency_tests),
        note: text(r.note),
        as_of: text(r.as_of),
        source: text(r.source),
        confidence: text(r.confidence).toLowerCase(),
      };
    })
    .filter((r) => /^[A-Z]{2}$/.test(r.country));
}

/** Also reads what an older version stored (with trends, without fx). */
export function cleanAllocation(raw: AllocationConfig): AllocationConfig {
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
  const targets = (Array.isArray(raw.targets) ? raw.targets : [])
    .filter((t) => t && typeof t.class === 'string' && Number.isFinite(num(t.target)))
    .map((t) => ({ class: t.class, target: num(t.target) }));
  const limits = (Array.isArray(raw.limits) ? raw.limits : [])
    .filter((l) => l && typeof l.dimension === 'string' && Number.isFinite(num(l.limit)))
    .map((l) => ({ dimension: l.dimension, value: String(l.value ?? '*'), limit: num(l.limit) }));
  return { targets, limits, fx: cleanFx(raw.fx) };
}

function cleanHistory(rows: unknown[]): HistoryRow[] {
  const out: HistoryRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const { month, category_id, amount_usd } = r as Record<string, unknown>;
    const n = Number(amount_usd);
    if (typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) && category_id && Number.isFinite(n)) {
      out.push({ month, category_id: String(category_id), amount_usd: n });
    }
  }
  return out;
}

/** Whole database for export (without the secret key). */
export async function exportAll(): Promise<Record<string, unknown>> {
  const snap = await loadSnapshot();
  const db = await getDb();
  const outbox = await db.getAll('outbox');
  const meta = { ...snap.meta };
  if (meta.config) meta.config = { url: meta.config.url, key: '' };
  return {
    app: 'finance-os',
    exported_at: new Date().toISOString(),
    accounts: snap.accounts,
    categories: snap.categories,
    transactions: snap.transactions,
    automations: snap.automations,
    tax_marks: snap.taxMarks,
    locations: snap.locations,
    outbox,
    meta,
  };
}
