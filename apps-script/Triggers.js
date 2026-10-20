// Background jobs: daily rates snapshot (and the gold price), balance snapshot on the 1st,
// server_ts stamp on manual edits of the data sheets.

// Then, until the freeze day, the month close: the snapshot of the 1st and last month's row in Closes (Closes.js);
// then the tax residency rules (Locations.js), whose notices go out with the next check-in.
function dailyJob() {
  updateRatesHistory_();
  withLock_(() => {
    const ledger = loadLedger_();
    runAutomations_(ledger);
    refreshTaxes_(ledger);
    refreshIncome_(ledger);
    SpreadsheetApp.flush();
    monthClose_(ledger);
    try {
      residencyJob_(Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'));
    } catch (err) {
      console.warn('Residency not checked: ' + err);
    }
  });
}

function updateRatesHistory_() {
  const ss = SpreadsheetApp.getActive();
  const hist = ss.getSheetByName('RatesHistory');
  const today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  const values = hist.getLastRow() > 1 ? hist.getRange(2, 1, hist.getLastRow() - 1, 3).getValues() : [];
  const have = {};
  values.forEach((r, i) => { have[formatDate_(r[0]) + '|' + r[1]] = i + 2; });

  const rows = [];
  const add = (day, cur, v) => {
    if (!v || have[day + '|' + cur]) return;
    have[day + '|' + cur] = true;
    rows.push([parseDate_(day), cur, v]);
  };
  // Quoted currencies: the daily source (Fx.js) for its latest day and the 3 before it, over what a fallback wrote
  // there, so the history stays one series.
  const quoted = quotedCurrencies_();
  const recent = [3, 2, 1].map(n => isoDay_(dayMs_(today) - n * 86400000));
  const got = fetchFxDays_(recent.concat(['latest']), quoted);
  Object.keys(got).forEach(k => {
    const day = got[k];
    Object.keys(day.rates).forEach(cur => {
      const row = have[day.date + '|' + cur];
      if (typeof row === 'number') hist.getRange(row, 3).setValue(day.rates[cur]);
      else add(day.date, cur, day.rates[cur]);
    });
  });
  const latest = got.latest;

  // What the source didn't give: gold from its API, the rest (and pegs typed by hand) from the Rates sheet.
  const rates = readRates_();
  Object.keys(rates).forEach(cur => {
    if (cur === 'USD' || (latest && latest.rates[cur] !== undefined)) return;
    add(today, cur, cur === 'XAU' ? fetchGoldPrice_() : rates[cur]);
  });
  appendRows_(hist, rows);
  dropFxCache_();
}

function fetchGoldPrice_() {
  try {
    const res = UrlFetchApp.fetch('https://api.gold-api.com/price/XAU', { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const price = Number(JSON.parse(res.getContentText()).price);
    return isFinite(price) && price > 500 && price < 100000 ? price : null;
  } catch (err) {
    console.warn('Gold price unavailable: ' + err);
    return null;
  }
}

// Balance snapshot on the 1st of the current month. Taken only if this month has none yet
// and there are transactions before the 1st (otherwise balances would just repeat opening_balance).
function maybeMonthlySnapshot_() {
  const now = new Date();
  const monthStart = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth(), 1), tz_(), 'yyyy-MM-dd');
  if (snapshotExists_(monthStart)) return;
  const txs = readRecords_('transactions').filter(t => !t.deleted);
  if (!txs.some(t => t.date && t.date < monthStart)) return;
  createSnapshot_(monthStart, txs, 'auto');
}

function snapshotExists_(dateStr) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Snapshots');
  if (sh.getLastRow() < 2) return false;
  return sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().some(r => formatDate_(r[0]) === dateStr);
}

// Same rule as Calc!H and the app: a transaction counts from the account's opening_date on;
// older ones (imported history) are already in the opening balance.
function createSnapshot_(dateStr, txs, source) {
  const accounts = readRecords_('accounts');
  const balances = {};
  const since = {};
  accounts.forEach(a => {
    balances[a.id] = Number(a.opening_balance) || 0;
    since[a.id] = a.opening_date || '';
  });
  const counts = (id, date) => balances[id] !== undefined && date >= since[id];
  txs.forEach(t => {
    if (!t.date || t.date >= dateStr) return;
    if (counts(t.account_id, t.date)) balances[t.account_id] += Number(t.amount) || 0;
    if (t.to_account_id && counts(t.to_account_id, t.date)) balances[t.to_account_id] += Number(t.to_amount) || 0;
  });

  const rows = [];
  accounts.forEach(a => {
    const bal = balances[a.id];
    if (a.archived && !bal) return;
    if (since[a.id] > dateStr) return; // the account's balance isn't known before its opening date
    const rate = rateOn_(a.currency, dateStr);
    rows.push([parseDate_(dateStr), a.id, a.name, bal, rate, Math.round(bal * rate * 100) / 100, source]);
  });
  appendRows_(SpreadsheetApp.getActive().getSheetByName('Snapshots'), rows);
  return rows.length;
}

// Rate on a date: the latest RatesHistory value not after the date, otherwise the current one.
function rateOn_(cur, dateStr) {
  if (!cur || cur === 'USD') return 1;
  const sh = SpreadsheetApp.getActive().getSheetByName('RatesHistory');
  let best = null;
  let bestDate = '';
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(r => {
      const d = formatDate_(r[0]);
      if (r[1] === cur && d && d <= dateStr && d >= bestDate) { best = Number(r[2]); bestDate = d; }
    });
  }
  return best || readRates_()[cur] || 0;
}

// Installable onEdit: a manual edit in Accounts / Categories / Transactions gets a new
// updated_at and server_ts so the PWA picks it up on the next sync. An empty id is generated.
function onEditStamp(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  const entity = Object.keys(SHEETS).filter(k => SHEETS[k] === sh.getName())[0];
  if (!entity) return;
  const first = Math.max(2, e.range.getRow());
  const last = e.range.getRow() + e.range.getNumRows() - 1;
  if (last < first) return;

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const col = colIndex_(headers);
  const block = sh.getRange(first, 1, last - first + 1, headers.length).getValues();
  const now = new Date().toISOString();

  block.forEach((row, i) => {
    if (row.every(v => v === '' || v === null)) return;
    const r = first + i;
    if (!row[col.id]) sh.getRange(r, col.id + 1).setValue(newId_(entity, row, col));
    sh.getRange(r, col.updated_at + 1).setValue(now);
    sh.getRange(r, col.server_ts + 1).setValue(now);
    if (col.created_at !== undefined && !row[col.created_at]) sh.getRange(r, col.created_at + 1).setValue(now);
  });
  if (entity === 'locations') return; // days in countries don't touch the money
  try {
    markTaxesDirty_();
  } catch (err) {
    console.warn('Taxes not scheduled: ' + err);
  }
}

function newId_(entity, row, col) {
  const short = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  if (entity === 'accounts') return 'acc_' + short;
  if (entity === 'categories') return (row[col.kind] === 'income' ? 'inc_' : 'exp_') + short;
  return Utilities.getUuid();
}
