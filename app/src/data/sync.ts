// Sync with the Google Apps Script web app over the shared protocol.
import type { HistoryRow, Rates, ServerMetrics, AllocationConfig, TaxSummary } from '../domain/types';
import { applySyncResponse, pendingCount, readOutbox, getMeta, type SyncChanges, type SyncConfig } from './db';
import { config, keepServerSettings, pending, pendingSettings, refreshPending, reloadFromDb, setChangeListener, setLocalSetting, settingSent, syncStatus } from './store';
import { today } from '../domain/dates';

const BATCH = 200;
const TIMEOUT_MS = 45_000;
const DEBOUNCE_MS = 2_000;
const RETRY_MS = 30_000;

export interface ProtocolResponse {
  ok: boolean;
  serverTs?: string;
  applied?: number;
  changes?: SyncChanges;
  rates?: Rates;
  settings?: Record<string, unknown>;
  metrics?: ServerMetrics;
  history?: HistoryRow[];
  allocation?: AllocationConfig;
  taxes?: TaxSummary | null;
  taxRates?: unknown;
  taxRatesHash?: string;
  /** checkin: the day as recorded, the country and city found. */
  day?: Record<string, unknown>;
  country?: string;
  city?: string;
  /** checkin: residency notices (a rule met, or 14 days from one), for the Shortcut to show. */
  notify?: string;
  error?: string;
  message?: string;
}

export class SyncError extends Error {
  constructor(
    public kind: 'offline' | 'error',
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

function errorText(code: string | undefined, message: string | undefined): string {
  switch (code) {
    case 'unauthorized':
      return 'Wrong key';
    case 'bad_request':
      return `Bad request${message ? `: ${message}` : ''}`;
    case 'server_error':
      return `Server error${message ? `: ${message}` : ''}`;
    default:
      return message || code || 'Unknown error';
  }
}

/** POST text/plain with no preflight: Apps Script can't answer OPTIONS. HTTP is always 200, errors come in the body. */
export async function postProtocol(url: string, body: unknown): Promise<ProtocolResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: ctrl.signal,
    });
  } catch {
    throw new SyncError('offline', ctrl.signal.aborted ? 'The server timed out' : 'No connection to the server');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text().catch(() => '');
  let data: ProtocolResponse;
  try {
    data = JSON.parse(text) as ProtocolResponse;
  } catch {
    throw new SyncError(
      'error',
      `The server didn't return JSON (HTTP ${res.status}). Check the URL and that the web app is shared with "Anyone".`,
    );
  }
  if (!data || typeof data !== 'object') throw new SyncError('error', 'Empty server response');
  if (data.ok !== true) throw new SyncError('error', errorText(data.error, data.message), data.error);
  return data;
}

/**
 * Changes a value of the Settings sheet (only those apps-script/Locations.js SETTABLE_ allows): in use on the phone at
 * once, sent in the background; offline, it goes with the next sync. tax_residency also shows as set by hand today.
 */
export async function saveServerSetting(setting: string, value: string): Promise<void> {
  await setLocalSetting(setting, value, setting === 'tax_residency' ? { tax_residency_set: `manual ${today()}` } : {});
  void sendSettings().catch(() => undefined);
}

/** Sends the settings changed on the phone; one the server refuses is dropped, the rest wait on a failure. */
async function sendSettings(): Promise<void> {
  const cfg = config.value;
  if (!cfg.url || !cfg.key) return;
  for (const [setting, value] of Object.entries(pendingSettings.value)) {
    try {
      const res = await postProtocol(cfg.url, { key: cfg.key, action: 'set_setting', setting, value });
      await settingSent(setting, value);
      if (res.settings) await keepServerSettings(res.settings);
    } catch (e) {
      if (e instanceof SyncError && e.code === 'bad_request') await settingSent(setting, value);
      else throw e;
    }
  }
}

export async function ping(cfg: SyncConfig): Promise<string> {
  const res = await postProtocol(cfg.url, { key: cfg.key, action: 'ping' });
  return res.serverTs ?? '';
}

let running: Promise<boolean> | null = null;
let again = false;
let againFull = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export function scheduleSync(delay = DEBOUNCE_MS): void {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

/** Starts a sync; if one is running, repeats after it finishes. */
export function syncNow(opts: { full?: boolean } = {}): Promise<boolean> {
  clearTimeout(timer);
  if (running) {
    again = true;
    againFull ||= !!opts.full;
    return running;
  }
  running = (async () => {
    let ok = await runSync(!!opts.full);
    while (again) {
      const full = againFull;
      again = false;
      againFull = false;
      ok = await runSync(full);
    }
    return ok;
  })().finally(() => {
    running = null;
  });
  return running;
}

async function runSync(full: boolean): Promise<boolean> {
  const cfg = config.value;
  if (!cfg.url || !cfg.key) {
    syncStatus.value = { phase: 'unconfigured', message: 'Add the URL and key in Settings' };
    return false;
  }
  syncStatus.value = { phase: 'syncing' };
  try {
    // Settings changed on the phone go first, so the sync's answer already has them.
    if (Object.keys(pendingSettings.value).length) await sendSettings();
    let since: string | null = full ? null : ((await getMeta('server_ts')) ?? null);
    // The tax rates come only when they changed (a full reload asks for them again).
    const taxRatesHash = full ? undefined : ((await getMeta('tax_rates_hash')) ?? undefined);
    let first = true;
    for (;;) {
      const ops = (await readOutbox()).slice(0, BATCH);
      const res = await postProtocol(cfg.url, {
        key: cfg.key,
        action: 'sync',
        since,
        device: 'iphone',
        taxRatesHash,
        ops: ops.map((o) => ({ entity: o.entity, record: o.record })),
      });
      if (!res.serverTs) throw new SyncError('error', 'No serverTs in the server response');
      await applySyncResponse({
        sent: ops,
        changes: res.changes ?? {},
        serverTs: String(res.serverTs),
        rates: res.rates,
        settings: res.settings,
        metrics: res.metrics,
        history: res.history,
        allocation: res.allocation,
        taxes: res.taxes,
        taxRates: res.taxRates,
        taxRatesHash: res.taxRatesHash,
        full: full && first,
      });
      since = String(res.serverTs);
      first = false;
      if (ops.length < BATCH || (await pendingCount()) === 0) break;
    }
    await reloadFromDb();
    syncStatus.value = { phase: 'ok' };
    return true;
  } catch (e) {
    const err = e instanceof SyncError ? e : new SyncError('error', e instanceof Error ? e.message : String(e));
    syncStatus.value = { phase: err.kind, message: err.message };
    await refreshPending();
    return false;
  }
}

let started = false;

/** Triggers: start, ~2 s after an entry, returning to the app, network back, retry while the outbox has items. */
export function startSync(): void {
  if (started) return;
  started = true;
  setChangeListener(() => scheduleSync());
  void syncNow();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  window.addEventListener('online', () => void syncNow());
  setInterval(() => {
    if (document.visibilityState === 'visible' && pending.value > 0 && !running) void syncNow();
  }, RETRY_MS);
}
