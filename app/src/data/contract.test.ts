// Contract test: the real PWA sync client against the real Apps Script code
// (apps-script/*.js in a vm harness with in-memory sheets, see tests/gas-harness.mjs).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — the harness is an untyped JS module
import { makeEnv } from '../../../tests/gas-harness.mjs';
import { resetDbForTests } from './db';
import { accounts, balances, locations, pending, pendingSettings, rates, reloadFromDb, saveConfig, saveLocation, saveTransaction, serverSettings, syncStatus, transactions } from './store';
import { LocationRefused, checkIn } from './location';
import { today } from '../domain/dates';
import { saveServerSetting, syncNow } from './sync';
import { buildTransaction } from '../domain/transactions';
import { buildAdjustment } from '../domain/reconcile';

const URL = 'https://script.google.com/macros/s/test/exec';
type Env = { sheets: Record<string, { data: unknown[][] }>; ctx: Record<string, (...a: unknown[]) => unknown>; post: (b: unknown) => unknown; tick: (ms: number) => void };
let env: Env;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await resetDbForTests();
  env = makeEnv();
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    env.tick(1000);
    return new Response(JSON.stringify(env.post(JSON.parse(String(init.body)))), { status: 200 });
  });
  await reloadFromDb();
  await saveConfig({ url: URL, key: 'secret' });
});

afterEach(() => vi.unstubAllGlobals());

const acc = (id: string) => accounts.value.find((a) => a.id === id)!;
const txRows = () => env.sheets.Transactions.data.slice(1) as unknown[][];

// Balance computed the way the spreadsheet does (Calc!H): opening + Σamount + Σto_amount.
function sheetBalance(id: string): number {
  const opening = (env.sheets.Accounts.data.find((r) => r[0] === id) as unknown[])[8] as number;
  return txRows().reduce((s, r) => {
    if (r[15] === true) return s;
    return s + (r[3] === id ? Number(r[4]) : 0) + (r[5] === id ? Number(r[6]) : 0);
  }, opening);
}

describe('PWA ↔ Apps Script contract', () => {
  it('first sync: accounts from the sheet with string dates, booleans and rates', async () => {
    expect(await syncNow()).toBe(true);
    expect(accounts.value.map((a) => a.id).sort()).toEqual(['acc_rub', 'acc_usd']);
    expect(acc('acc_rub').opening_date).toBe('2026-09-01');
    expect(acc('acc_rub').in_emergency_fund).toBe(false);
    expect(rates.value.RUB).toBe(0.0125);
  });

  it('an expense and a transfer reach the sheet, balances match the sheet formula', async () => {
    await syncNow();
    const now = new Date().toISOString();
    await saveTransaction(buildTransaction(
      { type: 'expense', date: '2026-10-18', account: acc('acc_rub'), amount: 1250, category_id: 'exp_food', note: '-coffee' },
      { id: crypto.randomUUID(), now, rates: rates.value },
    ));
    await saveTransaction(buildTransaction(
      { type: 'transfer', date: '2026-10-18', account: acc('acc_rub'), amount: 8000, toAccount: acc('acc_usd'), toAmount: 100 },
      { id: crypto.randomUUID(), now, rates: rates.value },
    ));
    expect(await syncNow()).toBe(true);
    expect(pending.value).toBe(0);

    const rows = txRows();
    expect(rows).toHaveLength(2);
    const exp = rows.find((r) => r[2] === 'expense')!;
    const trf = rows.find((r) => r[2] === 'transfer')!;
    expect(Object.prototype.toString.call(exp[1])).toBe('[object Date]');
    expect(exp[10]).toBe('-coffee');
    expect(exp[12]).toBeCloseTo(-1250 * 0.0125, 1); // the PWA rounds amount_usd to cents
    expect(exp[16]).not.toBe('');
    expect([trf[4], trf[5], trf[6]]).toEqual([-8000, 'acc_usd', 100]);
    for (const id of ['acc_rub', 'acc_usd']) expect(balances.value.get(id)).toBe(sheetBalance(id));
    expect(sheetBalance('acc_rub')).toBe(100000 - 1250 - 8000);
  });

  it('a zero-difference reconciliation is saved as adjustment 0 with the category for the account type', async () => {
    await syncNow();
    await saveTransaction(buildAdjustment(acc('acc_usd'), 0, { id: crypto.randomUUID(), now: new Date().toISOString(), date: '2026-10-18', rates: rates.value }));
    await syncNow();
    const row = txRows()[0];
    expect(row[2]).toBe('adjustment');
    expect(row[4]).toBe(0);
    expect(row[7]).toBe('sys_correction');
  });

  it('a manual edit in the sheet (onEditStamp) reaches the PWA on the next sync', async () => {
    await syncNow();
    const sh = env.sheets.Accounts;
    (sh.data[1] as unknown[])[1] = 'Everyday USD (main)';
    env.tick(5 * 60_000);
    env.ctx.onEditStamp({ range: { getSheet: () => sh, getRow: () => 2, getNumRows: () => 1 } });
    await syncNow();
    expect(acc('acc_usd').name).toBe('Everyday USD (main)');
  });

  it('check-in from the app: the server finds the country, the day shows at once; a fix by hand reaches the sheet', async () => {
    await syncNow();
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 13.7563, longitude: 100.5018 } } as GeolocationPosition) },
    });
    expect(await checkIn()).toEqual({ country: 'TH', city: 'Bangkok', notify: '' });
    const day = locations.value.find((d) => d.date === today())!;
    expect(day).toMatchObject({ id: `loc_${today()}`, countries: 'TH', source: 'app', city: 'Bangkok' });
    expect(pending.value).toBe(0); // the server already has it
    await saveLocation({ ...day, countries: 'PT TH', note: 'LIS→BKK' });
    await syncNow();
    const row = (env.sheets.Locations.data as unknown[][]).find((r) => r[0] === day.id)!;
    expect([row[2], row[4], row[5]]).toEqual(['PT TH', 'manual', 'LIS→BKK']);
  });

  it('check-in: a refusal from iOS is told apart (Check in runs the shortcut then), nothing is sent', async () => {
    await syncNow();
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 1, message: 'User denied Geolocation' } as GeolocationPositionError) },
    });
    await expect(checkIn()).rejects.toBeInstanceOf(LocationRefused);
    expect(env.sheets.Locations.data).toHaveLength(1);
  });

  it('a setting changed on the phone is in use at once; offline it waits and goes with the next sync', async () => {
    await syncNow();
    const settingsRow = () => (env.sheets.Settings.data as unknown[][]).find((r) => r[0] === 'tax_residency')?.[1];
    const online = globalThis.fetch;
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    await saveServerSetting('tax_residency', 'NONE');
    expect(serverSettings.value.tax_residency).toBe('NONE');
    expect(serverSettings.value.tax_residency_set).toBe(`manual ${today()}`);
    await new Promise((r) => setTimeout(r, 0));
    expect(pendingSettings.value).toEqual({ tax_residency: 'NONE' });
    expect(settingsRow()).toBeUndefined();
    vi.stubGlobal('fetch', online);
    expect(await syncNow()).toBe(true);
    expect(settingsRow()).toBe('NONE');
    expect(pendingSettings.value).toEqual({});
    expect(serverSettings.value.tax_residency).toBe('NONE');
  });

  it('wrong key: a clear error', async () => {
    await saveConfig({ url: URL, key: 'wrong' });
    expect(await syncNow()).toBe(false);
    expect(syncStatus.value).toEqual({ phase: 'error', message: 'Wrong key' });
    expect(transactions.value).toHaveLength(0);
  });
});
