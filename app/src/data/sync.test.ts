import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockStore, seedData, type MockStore } from '../../dev/mock-core.mjs';
import { applySyncResponse, exportAll, putWithOutbox, readOutbox, resetDbForTests } from './db';
import {
  accounts,
  categories,
  config,
  pending,
  rates,
  reloadFromDb,
  saveConfig,
  saveTransaction,
  syncStatus,
  transactions,
} from './store';
import { syncNow } from './sync';
import { buildTransaction } from '../domain/transactions';
import { accountBalance } from '../domain/balances';

const URL = 'http://mock.test/macros/s/dev/exec';
let server: MockStore;
let online = true;
const requests: Record<string, unknown>[] = [];

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await resetDbForTests();
  server = createMockStore({ key: 'dev' });
  online = true;
  requests.length = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe(URL);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain;charset=utf-8');
    expect(init.redirect).toBe('follow');
    if (!online) throw new TypeError('Failed to fetch');
    const body = JSON.parse(String(init.body));
    requests.push(body);
    return new Response(JSON.stringify(server.handle(body)), { status: 200 });
  });
  await reloadFromDb();
  await saveConfig({ url: URL, key: 'dev' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function expense(amount: number, accountId = 'acc_card') {
  const acc = accounts.value.find((a) => a.id === accountId)!;
  return buildTransaction(
    { type: 'expense', date: '2026-10-18', account: acc, amount, category_id: 'exp_food' },
    { id: crypto.randomUUID(), now: new Date().toISOString(), rates: rates.value },
  );
}

describe('sync', () => {
  it('the first sync pulls everything: accounts, categories, rates', async () => {
    expect(await syncNow()).toBe(true);
    expect(requests[0]).toMatchObject({ key: 'dev', action: 'sync', since: null, device: 'iphone', ops: [] });
    expect(accounts.value.length).toBe(seedData().accounts.length);
    expect(categories.value.map((c) => c.id)).toContain('sys_correction');
    expect(rates.value.XAU).toBe(4166);
    expect(syncStatus.value.phase).toBe('ok');
  });

  it('a new transaction goes to the server, the outbox empties, server_ts arrives', async () => {
    await syncNow();
    const t = expense(1250);
    await saveTransaction(t);
    expect(pending.value).toBe(1);
    await syncNow();
    const last = requests.at(-1) as { since: string; ops: { entity: string; record: { id: string } }[] };
    expect(last.since).toBeTypeOf('string');
    expect(last.ops).toEqual([{ entity: 'transactions', record: expect.objectContaining({ id: t.id, amount: -1250 }) }]);
    expect(pending.value).toBe(0);
    expect(server.db.transactions.get(t.id)?.amount).toBe(-1250);
    expect(transactions.value.find((x) => x.id === t.id)?.server_ts).not.toBe('');
  });

  it('offline: entries pile up in the outbox, then get through', async () => {
    await syncNow();
    online = false;
    const t = expense(300);
    await saveTransaction(t);
    expect(await syncNow()).toBe(false);
    expect(syncStatus.value.phase).toBe('offline');
    expect(pending.value).toBe(1);
    const card = accounts.value.find((a) => a.id === 'acc_card')!;
    expect(accountBalance(card, transactions.value)).toBeCloseTo(2169 + 4200 - 1250 - 86.4 - 500 - 300, 2);

    online = true;
    expect(await syncNow()).toBe(true);
    expect(pending.value).toBe(0);
    expect(server.db.transactions.has(t.id)).toBe(true);
  });

  it('server edits arrive incrementally', async () => {
    await syncNow();
    const acc = server.db.accounts.get('acc_cash_eur')!;
    server.serverEdit('accounts', { ...acc, name: 'Cash' });
    await syncNow();
    const last = requests.at(-1) as { since: string };
    expect(last.since).not.toBeNull();
    expect(accounts.value.find((a) => a.id === 'acc_cash_eur')?.name).toBe('Cash');
  });

  it('ops are sent in batches of at most 200', async () => {
    await syncNow();
    for (let i = 0; i < 450; i++) await saveTransaction(expense(1 + i));
    expect(pending.value).toBe(450);
    const before = requests.length;
    expect(await syncNow()).toBe(true);
    const sizes = requests.slice(before).map((r) => (r.ops as unknown[]).length);
    expect(sizes).toEqual([200, 200, 50]);
    expect(pending.value).toBe(0);
    expect(server.db.transactions.size).toBe(7 + 450);
  });

  it('wrong key → error, data untouched', async () => {
    await saveConfig({ url: URL, key: 'wrong' });
    expect(await syncNow()).toBe(false);
    expect(syncStatus.value).toEqual({ phase: 'error', message: 'Wrong key' });
  });

  it('no sync without settings', async () => {
    await saveConfig({ url: '', key: '' });
    expect(await syncNow()).toBe(false);
    expect(syncStatus.value.phase).toBe('unconfigured');
    expect(config.value.url).toBe('');
    expect(requests.length).toBe(0);
  });

  it('a full reload deletes local records missing on the server (except pending)', async () => {
    await syncNow();
    server.db.transactions.delete('seed-0001');
    await syncNow({ full: true });
    expect(transactions.value.some((t) => t.id === 'seed-0001')).toBe(false);
    expect(transactions.value.length).toBe(6);
  });
});

describe('export', () => {
  it('exports everything except the secret key', async () => {
    await syncNow();
    const data = await exportAll();
    expect((data.accounts as unknown[]).length).toBe(seedData().accounts.length);
    expect((data.transactions as unknown[]).length).toBe(7);
    expect((data.meta as { config: { url: string; key: string } }).config).toEqual({ url: URL, key: '' });
  });
});

describe('merge rule', () => {
  it('a pending op with a newer updated_at is not overwritten by an incoming record', async () => {
    await syncNow();
    const base = transactions.value.find((t) => t.id === 'seed-0003')!;
    const local = { ...base, note: 'local', updated_at: '2030-01-01T00:00:00.000Z' };
    await putWithOutbox('transactions', local);
    const incoming = { ...base, note: 'from server', updated_at: '2029-01-01T00:00:00.000Z', server_ts: 'x' };
    const res = await applySyncResponse({ sent: [], changes: { transactions: [incoming] }, serverTs: 'x' });
    expect(res.kept).toBe(1);
    await reloadFromDb();
    expect(transactions.value.find((t) => t.id === 'seed-0003')?.note).toBe('local');
    expect((await readOutbox()).length).toBe(1);
  });

  it('an incoming record newer than the pending op overwrites it', async () => {
    await syncNow();
    const base = transactions.value.find((t) => t.id === 'seed-0003')!;
    await putWithOutbox('transactions', { ...base, note: 'local', updated_at: '2029-01-01T00:00:00.000Z' });
    const incoming = { ...base, note: 'from server', updated_at: '2030-01-01T00:00:00.000Z' };
    await applySyncResponse({ sent: [], changes: { transactions: [incoming] }, serverTs: 'x' });
    await reloadFromDb();
    expect(transactions.value.find((t) => t.id === 'seed-0003')?.note).toBe('from server');
  });

  it('an op overwritten during the request is not removed', async () => {
    await syncNow();
    const t = expense(10);
    await saveTransaction(t);
    const sent = await readOutbox();
    await putWithOutbox('transactions', { ...t, note: 'edit', updated_at: '2099-01-01T00:00:00.000Z' });
    await applySyncResponse({ sent, changes: { transactions: [t] }, serverTs: 'x' });
    const left = await readOutbox();
    expect(left.length).toBe(1);
    expect(left[0].record.note).toBe('edit');
  });
});
