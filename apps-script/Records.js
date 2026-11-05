// Conversion between sheet rows and protocol JSON records.
// In JSON: dates 'YYYY-MM-DD', timestamps as ISO strings, booleans true/false, numbers as number, empty ''.

function sheetFor_(entity) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS[entity]);
  if (!sh) throw new Error('No sheet ' + SHEETS[entity]);
  return sh;
}

// The rows end at the last one with data: an empty row with a checkbox reads FALSE, so getLastRow() counts it, and
// a column of checkboxes runs down every row the sheet has.
function readTable_(sh) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const rows = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  while (rows.length && isBlankRow_(rows[rows.length - 1])) rows.pop();
  return { headers, rows };
}

/** Nothing typed in: empty cells and unticked checkboxes. */
function isBlankRow_(row) {
  return row.every(v => v === '' || v === null || v === false);
}

/** The last row with data (1 for the header alone), looking up from getLastRow() past the blank rows. */
function lastDataRow_(sh) {
  const width = Math.max(sh.getLastColumn(), 1);
  let end = sh.getLastRow();
  while (end > 1) {
    const from = Math.max(2, end - 499);
    const block = sh.getRange(from, 1, end - from + 1, width).getValues();
    for (let i = block.length - 1; i >= 0; i--) if (!isBlankRow_(block[i])) return from + i;
    end = from - 1;
  }
  return end;
}

function colIndex_(headers) {
  const idx = {};
  headers.forEach((h, i) => { if (h) idx[h] = i; });
  return idx;
}

/** Each header's kind ('date' / 'bool' / 'num' / 'text', '' for none), worked out once per read. */
function fieldKinds_(entity, headers) {
  const types = FIELD_TYPES[entity];
  return headers.map(h => (!h ? '' : types.date.indexOf(h) >= 0 ? 'date' : types.bool.indexOf(h) >= 0 ? 'bool' : types.num.indexOf(h) >= 0 ? 'num' : 'text'));
}

function rowToRecord_(entity, headers, row, kinds) {
  const k = kinds || fieldKinds_(entity, headers);
  const rec = {};
  for (let i = 0; i < headers.length; i++) {
    const kind = k[i];
    if (!kind) continue;
    const v = row[i];
    if (kind === 'date') rec[headers[i]] = formatDate_(v);
    else if (kind === 'bool') rec[headers[i]] = v === true || v === 'TRUE' || v === 'true';
    else if (kind === 'num') rec[headers[i]] = v === '' || v === null ? '' : (isFinite(Number(v)) ? Number(v) : '');
    else rec[headers[i]] = isDate_(v) ? v.toISOString() : (v === null ? '' : String(v));
  }
  return rec;
}

// existing: the current sheet row (for a partial update), or null for a new record.
function recordToRow_(entity, headers, rec, existing, serverTs) {
  const types = FIELD_TYPES[entity];
  return headers.map((h, i) => {
    if (!h) return existing ? existing[i] : '';
    if (h === 'server_ts') return serverTs;
    if (!Object.prototype.hasOwnProperty.call(rec, h)) return existing ? existing[i] : '';
    const v = rec[h];
    if (types.date.indexOf(h) >= 0) return parseDate_(v);
    if (types.bool.indexOf(h) >= 0) return v === true || v === 'true' || v === 1;
    if (types.num.indexOf(h) >= 0) return v === '' || v === null || !isFinite(Number(v)) ? '' : Number(v);
    return safeText_(v);
  });
}

// A string starting with '=', '+', '-' or '@' would otherwise turn into a formula or a number.
function safeText_(v) {
  if (v === null || v === undefined) return '';
  let s = String(v).slice(0, MAX_TEXT_LENGTH);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

// A ledger read formats thousands of dates, most of them repeated: each distinct one is formatted once.
const dateFormatCache_ = {};
function formatDate_(v) {
  if (isDate_(v)) {
    const t = v.getTime();
    return dateFormatCache_[t] || (dateFormatCache_[t] = Utilities.formatDate(v, tz_(), 'yyyy-MM-dd'));
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return '';
}

function parseDate_(v) {
  if (isDate_(v)) return v;
  if (typeof v !== 'string') return '';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function readRecords_(entity) {
  const { headers, rows } = readTable_(sheetFor_(entity));
  const idCol = headers.indexOf('id');
  const kinds = fieldKinds_(entity, headers);
  return rows
    .filter(r => r[idCol] !== '' && r[idCol] !== null)
    .map(r => rowToRecord_(entity, headers, r, kinds));
}

/**
 * Everything the background jobs need, read once: a ledger read takes seconds and the jobs hold the lock a sync
 * waits for. Jobs that add transactions push them into `txs`, so the later ones see them.
 */
function loadLedger_() {
  return {
    accounts: readRecords_('accounts'),
    categories: readRecords_('categories'),
    txs: readRecords_('transactions'),
    autos: SpreadsheetApp.getActive().getSheetByName(SHEETS.automations) ? readRecords_('automations') : [],
    marks: SpreadsheetApp.getActive().getSheetByName(SHEETS.tax_marks) ? readRecords_('tax_marks') : [],
    settings: readSettings_(),
  };
}

// Records with server_ts after `cutoff` (every record when it is null) plus the ids in `touched`.
// The ledger holds thousands of imported rows and most syncs change none of them, so only the id and
// server_ts columns are read in full; whole rows only for the span of the matches.
function readChangedRecords_(entity, cutoff, touched) {
  if (!cutoff) return readRecords_(entity);
  const sh = sheetFor_(entity);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const idCol = headers.indexOf('id');
  const tsCol = headers.indexOf('server_ts');
  const ids = sh.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  const stamps = sh.getRange(2, tsCol + 1, lastRow - 1, 1).getValues();
  const hits = [];
  ids.forEach((r, i) => {
    const id = r[0];
    if (id === '' || id === null) return;
    const ts = stamps[i][0];
    if (touched[String(id)] || (isDate_(ts) ? ts.toISOString() : String(ts)) > cutoff) hits.push(i);
  });
  if (!hits.length) return [];
  const first = hits[0];
  const block = sh.getRange(first + 2, 1, hits[hits.length - 1] - first + 1, lastCol).getValues();
  return hits.map(i => rowToRecord_(entity, headers, block[i - first]));
}

// Rates for the client: { CUR: USD per 1 unit }.
function readRates_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Rates');
  const values = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 3).getValues();
  const rates = {};
  values.forEach(r => {
    const cur = String(r[0] || '').trim();
    const v = Number(r[2]);
    if (cur && isFinite(v) && v > 0) rates[cur] = v;
  });
  rates.USD = 1;
  return rates;
}

function readSettings_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Settings');
  const values = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).getValues();
  const settings = {};
  values.forEach(r => {
    const k = String(r[0] || '').trim();
    if (!k) return;
    settings[k] = isDate_(r[1]) ? formatDate_(r[1]) : r[1];
  });
  return settings;
}

// Writes after the last row with data (into the blank rows below it). start: that row + 1, when the caller has
// just read the table.
function appendRows_(sh, rows, start) {
  if (!rows.length) return;
  const from = start || lastDataRow_(sh) + 1;
  const need = from + rows.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 200);
  sh.getRange(from, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * Deletes the blank rows between the records of the synced sheets, until the deadline (ms). Appends used to start
 * after getLastRow(), which a column of checkboxes puts at the sheet's end: each one left the 200 rows it inserted
 * empty above it, and a sync read every one of them. A sheet without such rows costs one read of its id column.
 */
function compactSheets_(deadline) {
  let removed = 0;
  Object.keys(SHEETS).forEach(entity => {
    const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS[entity]);
    if (sh) removed += compactSheet_(sh, deadline);
  });
  if (removed) console.log('Blank rows removed: ' + removed);
  return removed;
}

function compactSheet_(sh, deadline) {
  const last = sh.getLastRow();
  if (last < 3) return 0;
  const width = sh.getLastColumn();
  const idCol = sh.getRange(1, 1, 1, width).getValues()[0].map(String).indexOf('id');
  if (idCol < 0) return 0;
  const hasId = sh.getRange(2, idCol + 1, last - 1, 1).getValues().map(r => r[0] !== '' && r[0] !== null);
  const end = hasId.lastIndexOf(true);
  const firstGap = hasId.indexOf(false);
  if (firstGap < 0 || firstGap > end) return 0;
  // Runs of blank rows, bottom up so the row numbers above stay put; a row with data but no id stays.
  const rows = sh.getRange(2, 1, end + 1, width).getValues();
  let removed = 0;
  let runEnd = -1;
  for (let i = end; i >= -1; i--) {
    if (i >= 0 && isBlankRow_(rows[i])) {
      if (runEnd < 0) runEnd = i;
      continue;
    }
    if (runEnd < 0) continue;
    if (Date.now() > deadline) break;
    sh.deleteRows(i + 3, runEnd - i);
    removed += runEnd - i;
    runEnd = -1;
  }
  return removed;
}

// Named ranges of the Calc sheet the PWA needs (runway): { burn: 4200, ... } in USD per month.
const METRIC_RANGES = { burn: 'BURN', essential: 'ESSENTIAL', passive: 'PASSIVE', work_income: 'WORK_INCOME', savings: 'SAVINGS' };

function readMetrics_() {
  const ss = SpreadsheetApp.getActive();
  const metrics = {};
  Object.keys(METRIC_RANGES).forEach(k => {
    const range = ss.getRangeByName(METRIC_RANGES[k]);
    const v = range ? Number(range.getValue()) : NaN;
    if (isFinite(v) && range.getValue() !== '') metrics[k] = Math.round(v * 100) / 100;
  });
  return metrics;
}

// History sheet: monthly P&L totals typed in for months before the transactions (optional), [{ month: 'YYYY-MM', category_id, amount_usd }].
function readHistory_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('History');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .map(r => ({
      month: isDate_(r[0]) ? Utilities.formatDate(r[0], tz_(), 'yyyy-MM') : String(r[0]).slice(0, 7),
      category_id: String(r[1] || ''),
      amount_usd: Number(r[2]),
    }))
    .filter(r => /^\d{4}-\d{2}$/.test(r.month) && r.category_id && isFinite(r.amount_usd) && r.amount_usd !== 0);
}

// Inputs of the app's Capital allocation: the expected yearly change of each currency against USD (Rates, column E),
// the target allocation and the concentration limits (Risk sheet, both editable there).
// trends (Rates!E, an assumption) is for app versions before the realized returns; fx is what they use now.
function readAllocationConfig_() {
  const ss = SpreadsheetApp.getActive();
  const out = { trends: {}, targets: [], limits: [], fx: readFxWindows_() };
  const rates = ss.getSheetByName('Rates');
  if (rates && rates.getLastRow() > 1 && rates.getLastColumn() >= 5) {
    rates.getRange(2, 1, rates.getLastRow() - 1, 5).getValues().forEach(r => {
      const cur = String(r[0] || '').trim();
      const v = Number(r[4]);
      if (cur && r[4] !== '' && isFinite(v)) out.trends[cur] = v;
    });
  }
  const risk = ss.getSheetByName('Risk');
  if (!risk || risk.getLastRow() < 2) return out;
  const values = risk.getRange(1, 1, risk.getLastRow(), 3).getValues();
  // Concentration limits: "Dimension | Value | Limit" rows until a blank dimension.
  const head = values.findIndex(r => String(r[0]).trim() === 'Dimension');
  if (head >= 0) {
    for (let i = head + 1; i < values.length; i++) {
      const dim = String(values[i][0]).trim();
      if (!dim) break;
      const limit = Number(values[i][2]);
      if (values[i][2] !== '' && isFinite(limit)) out.limits.push({ dimension: dim, value: String(values[i][1]).trim(), limit });
    }
  }
  // Target allocation: "Class | Target" rows under the "Target allocation" title, until "Base".
  const title = values.findIndex(r => String(r[0]).indexOf('Target allocation') === 0);
  if (title >= 0) {
    for (let i = title + 2; i < values.length; i++) {
      const cls = String(values[i][0]).trim();
      if (!cls || cls === 'Base') break;
      const target = Number(values[i][1]);
      if (values[i][1] !== '' && isFinite(target)) out.targets.push({ class: cls, target });
    }
  }
  return out;
}
