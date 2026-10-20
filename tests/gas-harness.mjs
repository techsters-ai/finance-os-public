// Harness: apps-script/*.js code in a vm context with mocked Google services.
// Used by the logic tests (tests/) and the PWA contract test (app/src/data/contract.test.ts).

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps-script');
const FILES = ['Config.js', 'Records.js', 'Api.js', 'Sync.js', 'Triggers.js', 'Fx.js', 'Taxes.js', 'Automations.js', 'Income.js', 'Closes.js', 'Locations.js', 'Setup.js', 'Menu.js', 'Admin.js'];

const colNum = s => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colLetters = c => (c > 0 ? colLetters(Math.floor((c - 1) / 26)) + String.fromCharCode(65 + ((c - 1) % 26)) : '');
function parseA1(a1) {
  const m = a1.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!m) throw new Error('bad A1: ' + a1);
  const r = Number(m[2]), c = colNum(m[1]);
  return m[3] ? [r, c, Number(m[4]) - r + 1, colNum(m[3]) - c + 1] : [r, c, 1, 1];
}

export class Sheet {
  /** formulas: { 'C3': '=…' } for cells whose value stands in for a formula's result. */
  constructor(name, rows, formulas = {}) { this.name = name; this.data = rows.map(r => r.slice()); this.maxRows = Math.max(rows.length, 50); this.formulas = formulas; }
  getName() { return this.name; }
  getLastRow() { let n = this.data.length; while (n > 0 && this.data[n - 1].every(v => v === '' || v === null || v === undefined)) n--; return n; }
  getLastColumn() { return Math.max(...this.data.map(r => r.length)); }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return 26; }
  getFrozenRows() { return 1; }
  isSheetHidden() { return false; }
  getCharts() { return []; }
  insertRowsAfter(_after, n) { this.maxRows += n; }
  insertColumnsAfter() {}
  clearContents() { this.data = []; }
  setFrozenRows() {}
  setFrozenColumns() {}
  getDataRange() { return this.getRange(1, 1, this.getLastRow(), this.getLastColumn()); }
  getRange(r, c, nr = 1, nc = 1) {
    if (typeof r === 'string') [r, c, nr, nc] = parseA1(r);
    const sheet = this;
    return {
      getSheet: () => sheet,
      getRow: () => r,
      getColumn: () => c,
      getNumRows: () => nr,
      getNumColumns: () => nc,
      getA1Notation: () => colLetters(c) + r + (nr * nc > 1 ? ':' + colLetters(c + nc - 1) + (r + nr - 1) : ''),
      getDisplayValues() { return this.getValues().map(row => row.map(v => String(v))); },
      getFormulas() {
        return this.getValues().map((row, i) => row.map((v, j) => sheet.formulas[colLetters(c + j) + (r + i)] || (typeof v === 'string' && v.startsWith('=') ? v : '')));
      },
      clearContent() {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (sheet.data[r - 1 + i]) sheet.data[r - 1 + i][c - 1 + j] = '';
      },
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = sheet.data[r - 1 + i] || [];
          const vals = [];
          for (let j = 0; j < nc; j++) { const v = row[c - 1 + j]; vals.push(v === undefined ? '' : v); }
          out.push(vals);
        }
        return out;
      },
      setValues(vals) {
        if (r - 1 + nr > sheet.maxRows) throw new Error('range out of grid');
        vals.forEach((row, i) => {
          while (sheet.data.length < r + i) sheet.data.push([]);
          row.forEach((v, j) => { sheet.data[r - 1 + i][c - 1 + j] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v; });
        });
        return this;
      },
      setValue(v) { this.setValues([[v]]); },
      setNumberFormat() { return this; },
      setFontWeight() { return this; },
      getValue() { return this.getValues()[0][0]; },
    };
  }
}

export const TS0 = '2026-10-18T10:00:00.000Z';
export const accHeaders = ['id', 'name', 'group', 'type', 'currency', 'institution', 'country', 'kyc_country', 'opening_balance', 'opening_date', 'apr_gross', 'tax_rate', 'maturity_date', 'insured_limit', 'risk_price', 'risk_country', 'risk_legal', 'risk_custody', 'risk_credit', 'risk_currency', 'risk_liquidity', 'in_emergency_fund', 'archived', 'sort', 'color', 'note', 'updated_at', 'server_ts', 'visibility', 'interest_to', 'auto_tax'];
const catHeaders = ['id', 'name', 'kind', 'parent_id', 'budget_usd', 'essential', 'icon', 'color', 'archived', 'sort', 'updated_at', 'server_ts', 'scope'];
export const autoHeaders = ['id', 'name', 'kind', 'account_id', 'frequency', 'day', 'category_id', 'start_date', 'last_run', 'active', 'note', 'deleted', 'created_at', 'updated_at', 'server_ts', 'amount'];
const txHeaders = ['id', 'date', 'type', 'account_id', 'amount', 'to_account_id', 'to_amount', 'category_id', 'orig_amount', 'orig_currency', 'note', 'usd_rate', 'amount_usd', 'created_at', 'updated_at', 'deleted', 'server_ts', 'tags'];

function acc(id, name, currency, opening) {
  const row = accHeaders.map(() => '');
  Object.assign(row, { 0: id, 1: name, 2: 'liquid', 3: 'card', 4: currency, 8: opening, 9: new Date(2026, 8, 1), 21: false, 22: false, 26: TS0, 27: TS0 });
  return row;
}

export function makeEnv() {
  const sheets = {
    Accounts: new Sheet('Accounts', [accHeaders, acc('acc_usd', 'Everyday USD', 'USD', 1000), acc('acc_rub', 'Savings RUB', 'RUB', 100000)]),
    Categories: new Sheet('Categories', [catHeaders, ['exp_food', 'Food', 'expense', '', 1000, true, '🍔', '', false, 10, TS0, TS0]]),
    Transactions: new Sheet('Transactions', [txHeaders]),
    Automations: new Sheet('Automations', [autoHeaders]),
    TaxMarks: new Sheet('TaxMarks', [['id', 'rule', 'period', 'action', 'amount', 'currency', 'date', 'note', 'deleted', 'created_at', 'updated_at', 'server_ts']]),
    Locations: new Sheet('Locations', [['id', 'date', 'countries', 'city', 'source', 'note', 'deleted', 'created_at', 'updated_at', 'server_ts']]),
    Rates: new Sheet('Rates', [
      ['currency', 'pair', 'usd_per_unit', 'units_per_usd', 'exp_change_yoy'],
      ['USD', 'USD:USD', 1, 1, 0],
      ['RUB', 'USD:RUB', 0.0125, 80, -0.08],
      ['XAU', 'XAU:USD', 4000, '', 0],
    ], { C3: '=GOOGLEFINANCE("CURRENCY:RUBUSD")', C4: '=XLOOKUP("XAU",RatesHistory!B:B,RatesHistory!C:C,"",0,-1)' }),
    Risk: new Sheet('Risk', [
      ['Concentration limits (edit A–C)', '', ''],
      ['Dimension', 'Value', 'Limit'],
      ['country', '*', 0.4],
      ['asset_class', 'Crypto', 0.1],
      ['', '', ''],
      ['Alerts', '', ''],
      ['Target allocation (base: all assets except the emergency fund and cash)', '', ''],
      ['Class', 'Target', 'Now, $'],
      ['Bonds & deposits', 0.3, 100],
      ['Stocks', 0.7, 50],
      ['Base', 1, 150],
    ]),
    RatesHistory: new Sheet('RatesHistory', [['date', 'currency', 'usd_per_unit'], [new Date(2026, 9, 1), 'RUB', 0.012]]),
    Settings: new Sheet('Settings', [['key', 'value'], ['base_currency', 'USD'], ['second_currency', 'RUB'], ['webapp_url', 'https://example/exec']]),
    Snapshots: new Sheet('Snapshots', [['date', 'account_id', 'account_name', 'balance', 'usd_per_unit', 'balance_usd', 'source']]),
    History: new Sheet('History', [['month', 'category_id', 'amount_usd', 'note'], ['2026-08', 'exp_food', -940, 'old sheet'], ['2026-08', 'inc_work', 4800, '']]),
    Calc: new Sheet('Calc', [['metric', 'value'], ['Burn rate', 4180.456], ['Essential', 2650]]),
  };
  const named = { BURN: ['Calc', 'B2'], ESSENTIAL: ['Calc', 'B3'] };
  const props = { API_KEY: 'secret', ADMIN_ENABLED: 'true' };
  const cache = {};
  const triggers = [];
  // The daily rates source: fxDays['YYYY-MM-DD' | 'latest'] = { date, usd: { rub: units per USD, … } }.
  const fxDays = {};
  const places = { '13.7563,100.5018': ['TH', 'Bangkok'], '38.7223,-9.1393': ['PT', 'Lisbon'] };
  const reply = (code, body) => ({ getResponseCode: () => code, getContentText: () => body });
  const fetchMock = url => {
    if (url.includes('gold-api')) return reply(200, '{"price": 4100}');
    const day = (url.match(/currency-api@([\w-]+)\//) || url.match(/\/\/([\w-]+)\.currency-api/) || [])[1];
    return fxDays[day] ? reply(200, JSON.stringify(fxDays[day])) : reply(404, 'not found');
  };
  let clock = Date.parse('2026-10-18T12:00:00.000Z');
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(clock); else super(...a); }
    static now() { return clock; }
  }
  const ctx = {
    console, JSON, Math, Number, String, Object, Array, Boolean, isFinite, Error, RegExp, Intl,
    Date: FakeDate,
    SpreadsheetApp: {
      getActive: () => ({
        getSheetByName: n => sheets[n] || null,
        insertSheet: n => (sheets[n] = new Sheet(n, [])),
        getSheets: () => Object.values(sheets),
        getRange: a1 => { const [name, ref] = a1.split('!'); return sheets[name].getRange(ref); },
        getRangeByName: n => (named[n] && sheets[named[n][0]] ? sheets[named[n][0]].getRange(named[n][1]) : null),
        getSpreadsheetTimeZone: () => 'Africa/Nairobi',
      }),
      flush() {},
    },
    Utilities: {
      formatDate: (d, _tz, _fmt) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { MD5: 'md5' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => [...createHash(alg).update(s, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
      base64Encode: (bytes) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString('base64'),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => ({ body: s, getContent: () => s }) }) },
    UrlFetchApp: { fetch: url => fetchMock(url), fetchAll: reqs => reqs.map(q => fetchMock(q.url)) },
    ScriptApp: {
      getService: () => ({ getUrl: () => null }),
      getProjectTriggers: () => triggers,
      deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: fn => {
        const b = { timeBased: () => b, after: () => b, everyDays: () => b, atHour: () => b, forSpreadsheet: () => b, onEdit: () => b, create: () => { const t = { getHandlerFunction: () => fn }; triggers.push(t); return t; } };
        return b;
      },
    },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    // Reverse geocoding: places['lat,lon'] = [country code, city]; anywhere else is at sea.
    Maps: {
      newGeocoder: () => ({
        setLanguage() { return this; },
        reverseGeocode: (lat, lon) => {
          const p = places[lat + ',' + lon];
          if (!p) return { status: 'ZERO_RESULTS', results: [] };
          return { status: 'OK', results: [{ address_components: [
            { long_name: p[1], short_name: p[1], types: ['locality', 'political'] },
            { long_name: 'Somewhere', short_name: p[0], types: ['country', 'political'] },
          ] }] };
        },
      }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(FILES.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n'), ctx);
  const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  return { sheets, ctx, post, fxDays, places, triggers, props, tick: ms => { clock += ms; } };
}

