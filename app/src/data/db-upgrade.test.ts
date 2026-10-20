import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { getDb, loadSnapshot, resetDbForTests } from './db';

afterEach(async () => {
  await resetDbForTests();
});

describe('database upgrade', () => {
  it('a phone on version 1 keeps its records and gets the automations, tax marks and locations stores', async () => {
    globalThis.indexedDB = new IDBFactory();
    await resetDbForTests();
    const v1 = await openDB('finance-os', 1, {
      upgrade(db) {
        db.createObjectStore('accounts', { keyPath: 'id' });
        db.createObjectStore('categories', { keyPath: 'id' });
        db.createObjectStore('transactions', { keyPath: 'id' }).createIndex('by_date', 'date');
        db.createObjectStore('outbox', { keyPath: 'key' });
        db.createObjectStore('meta');
      },
    });
    await v1.put('accounts', { id: 'acc_1', name: 'Card', currency: 'USD' });
    v1.close();
    const db = await getDb();
    expect([...db.objectStoreNames].sort()).toEqual(['accounts', 'automations', 'categories', 'locations', 'meta', 'outbox', 'tax_marks', 'transactions']);
    const snap = await loadSnapshot();
    expect(snap.accounts.map((a) => a.id)).toEqual(['acc_1']);
    expect(snap.automations).toEqual([]);
    expect(snap.taxMarks).toEqual([]);
    expect(snap.locations).toEqual([]);
  });
});
