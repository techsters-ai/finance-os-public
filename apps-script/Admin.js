// Admin mode for developing the spreadsheet: read and edit sheets with the same key as the PWA.
// action: 'admin', op: 'sheets' | 'read' | 'write' | 'exec'.
// Edits from here don't fire onEdit: on synced sheets set updated_at / server_ts yourself,
// otherwise the PWA won't pick them up.

const ADMIN_MAX_CELLS = 50000;

// Off until turned on from the spreadsheet menu: `exec` runs any code with the key, so a leaked key would be worse
// with it on. Turn it on while an AI agent (or you) works on the spreadsheet remotely, then off again.
function adminEnabled_() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_ENABLED') === 'true';
}

function enableAdmin() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('Turn on admin access?', 'Anyone with the key can then read and change every sheet and run code in this spreadsheet. Turn it off when you are done.', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  PropertiesService.getScriptProperties().setProperty('ADMIN_ENABLED', 'true');
  ui.alert('Admin access is on.');
}

function disableAdmin() {
  PropertiesService.getScriptProperties().deleteProperty('ADMIN_ENABLED');
  SpreadsheetApp.getUi().alert('Admin access is off.');
}

function handleAdmin_(req) {
  const ss = SpreadsheetApp.getActive();
  switch (req.op) {
    case 'sheets':
      return { ok: true, sheets: ss.getSheets().map(describeSheet_) };
    case 'read':
      return Object.assign({ ok: true }, readRange_(adminRange_(ss, req), req.raw));
    case 'write':
      return withScriptLock_(() => writeRange_(adminRange_(ss, req), req.values));
    case 'exec':
      return withScriptLock_(() => execCode_(ss, req.code));
    default:
      throw badRequest_('Unknown admin op: ' + req.op);
  }
}

function describeSheet_(sh) {
  return {
    name: sh.getName(),
    lastRow: sh.getLastRow(),
    lastColumn: sh.getLastColumn(),
    maxRows: sh.getMaxRows(),
    maxColumns: sh.getMaxColumns(),
    frozenRows: sh.getFrozenRows(),
    hidden: sh.isSheetHidden(),
    charts: sh.getCharts().length,
  };
}

// range: 'Sheet!A1:C10' (quote names with spaces: "'Cash Flow'!A1"), or sheet + range, or just sheet (whole DataRange).
function adminRange_(ss, req) {
  if (!req.sheet) {
    if (!req.range) throw badRequest_('range or sheet is required');
    return ss.getRange(String(req.range));
  }
  const sh = ss.getSheetByName(String(req.sheet));
  if (!sh) throw badRequest_('No sheet ' + req.sheet);
  return req.range ? sh.getRange(String(req.range)) : sh.getDataRange();
}

// Returns values as displayed in the sheet by default; raw: numbers and dates as they are.
function readRange_(range, raw) {
  const cells = range.getNumRows() * range.getNumColumns();
  if (cells > ADMIN_MAX_CELLS) throw badRequest_('Range too large: ' + cells + ' cells');
  const values = raw
    ? range.getValues().map(row => row.map(v => (isDate_(v) ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm:ss') : v)))
    : range.getDisplayValues();
  const formulas = {};
  range.getFormulas().forEach((row, i) => row.forEach((f, j) => {
    if (f) formulas[a1_(range.getRow() + i, range.getColumn() + j)] = f;
  }));
  return { range: range.getSheet().getName() + '!' + range.getA1Notation(), values, formulas };
}

// values are written from the top-left corner of range; strings starting with '=' become formulas.
function writeRange_(anchor, values) {
  if (!Array.isArray(values) || !values.length || !Array.isArray(values[0])) throw badRequest_('values: a non-empty 2D array is required');
  const width = values[0].length;
  if (values.some(r => !Array.isArray(r) || r.length !== width)) throw badRequest_('values: rows differ in length');
  const range = anchor.getSheet().getRange(anchor.getRow(), anchor.getColumn(), values.length, width);
  range.setValues(values);
  SpreadsheetApp.flush();
  return { ok: true, range: range.getSheet().getName() + '!' + range.getA1Notation() };
}

// The code gets ss, SpreadsheetApp and log() and sees every global function of the script. Its return value goes into the response.
function execCode_(ss, code) {
  if (typeof code !== 'string' || !code) throw badRequest_('code: a string is required');
  const logs = [];
  const log = (...args) => { logs.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  try {
    const result = new Function('ss', 'SpreadsheetApp', 'log', code)(ss, SpreadsheetApp, log);
    SpreadsheetApp.flush();
    return { ok: true, result: result === undefined ? null : result, logs };
  } catch (err) {
    return { ok: false, error: 'exec_error', message: String(err && err.message ? err.message : err), stack: err && err.stack, logs };
  }
}

function withScriptLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function a1_(row, col) {
  let letters = '';
  for (let c = col; c > 0; c = Math.floor((c - 1) / 26)) letters = String.fromCharCode(65 + ((c - 1) % 26)) + letters;
  return letters + row;
}
