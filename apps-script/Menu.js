// The 'Finance OS' spreadsheet menu and first-time setup.

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Finance OS')
    .addItem('App connection (URL and key)', 'showConnectionInfo')
    .addSeparator()
    .addItem('Update rates and gold price now', 'dailyJob')
    .addItem('Snapshot balances for the 1st of the month', 'snapshotNow')
    .addItem('Recalculate taxes and income by month', 'refreshTaxesJob')
    .addSeparator()
    .addItem('First-time setup (sheets, key and triggers)', 'setup')
    .addItem('Rotate access key', 'rotateKey')
    .addSeparator()
    .addItem('Turn on admin access (remote edits)', 'enableAdmin')
    .addItem('Turn off admin access', 'disableAdmin')
    .addToUi();
}

// Run once from the script editor: grants permissions, creates the sheets that are missing, the key and triggers.
function setup() {
  const added = ensureSheets_();
  if (added.length) console.log('Sheets added: ' + added.join(', '));
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_KEY')) props.setProperty('API_KEY', newKey_());

  const ss = SpreadsheetApp.getActive();
  const handlers = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
  if (handlers.indexOf('dailyJob') < 0) {
    ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(6).create();
  }
  if (handlers.indexOf('onEditStamp') < 0) {
    ScriptApp.newTrigger('onEditStamp').forSpreadsheet(ss).onEdit().create();
  }
  updateRatesHistory_();
  const status = selfTest_();
  writeSetting_('api_status', status + ' · ' + Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'));
  console.log('Self-test: ' + status);
  try { showConnectionInfo(); } catch (err) { /* run from the editor without a UI: the key is in the spreadsheet menu */ }
}

// Runs the same path as a PWA request (doPost → sync) with the real key, changing nothing.
function selfTest_() {
  const key = PropertiesService.getScriptProperties().getProperty('API_KEY');
  const out = doPost({ postData: { contents: JSON.stringify({ key, action: 'sync', since: null, ops: [] }) } });
  const res = JSON.parse(out.getContent());
  if (!res.ok) return 'error: ' + res.error + ' ' + (res.message || '');
  return 'ok: accounts ' + res.changes.accounts.length + ', categories ' + res.changes.categories.length +
    ', transactions ' + res.changes.transactions.length + ', rates ' + Object.keys(res.rates).length;
}

function writeSetting_(key, value) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Settings');
  const keys = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(r => r[0]);
  const row = keys.indexOf(key) + 1 || sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, 2).setValues([[key, value]]);
}

function showConnectionInfo() {
  const key = PropertiesService.getScriptProperties().getProperty('API_KEY') || '(run "First-time setup")';
  const url = readSettings_().webapp_url || ScriptApp.getService().getUrl() || '(the web app is not deployed yet)';
  const html = HtmlService.createHtmlOutput(
    '<div style="font:14px -apple-system,Roboto,sans-serif;line-height:1.5">' +
    '<p>Paste these into the PWA → Settings. The key gives full access to your data: keep it like a password.</p>' +
    '<p><b>URL</b><br><textarea readonly style="width:100%;height:56px" onclick="this.select()">' + escapeHtml_(url) + '</textarea></p>' +
    '<p><b>Key</b><br><textarea readonly style="width:100%;height:40px" onclick="this.select()">' + escapeHtml_(key) + '</textarea></p>' +
    '</div>'
  ).setWidth(520).setHeight(300);
  SpreadsheetApp.getUi().showModalDialog(html, 'Finance OS: connection');
}

function snapshotNow() {
  const now = new Date();
  const monthStart = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth(), 1), tz_(), 'yyyy-MM-dd');
  const ui = SpreadsheetApp.getUi();
  if (snapshotExists_(monthStart)) {
    ui.alert('A snapshot for ' + monthStart + ' already exists.');
    return;
  }
  const txs = readRecords_('transactions').filter(t => !t.deleted);
  const n = createSnapshot_(monthStart, txs, 'manual');
  ui.alert('Snapshot for ' + monthStart + ' saved: ' + n + ' accounts.');
}

function rotateKey() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('Rotate the key?', 'The app stops syncing until you paste the new key in its Settings.', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  PropertiesService.getScriptProperties().setProperty('API_KEY', newKey_());
  showConnectionInfo();
}

function newKey_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
