// Daily exchange rates for the realized returns of Capital allocation. Every day comes from one source, so a
// return compares like with like: the free currency API on jsDelivr (a daily snapshot of USD rates, gold
// included), its Cloudflare mirror as a fallback. GOOGLEFINANCE history can't be read from a script.

const FX_SOURCES_ = [
  day => 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@' + day + '/v1/currencies/usd.json',
  day => 'https://' + day + '.currency-api.pages.dev/v1/currencies/usd.json',
];
const FX_BATCH_ = 40;

// Currencies with a market price: a formula in Rates!C (GOOGLEFINANCE, or the gold lookup). Prices typed by
// hand (USDT) are pegs and keep their Rates value.
function quotedCurrencies_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Rates');
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const names = sh.getRange(2, 1, n, 1).getValues();
  const formulas = sh.getRange(2, 3, n, 1).getFormulas();
  return names.map((r, i) => (formulas[i][0] ? String(r[0]).trim() : '')).filter(c => c && c !== 'USD');
}

// One day of the source ('YYYY-MM-DD' or 'latest') → { date, rates: { CUR: usd_per_unit } }, or null.
function parseFxDay_(text, currencies) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return null;
  }
  const usd = json && json.usd;
  if (!usd || !/^\d{4}-\d{2}-\d{2}$/.test(String(json.date))) return null;
  const rates = {};
  currencies.forEach(c => {
    const v = Number(usd[c.toLowerCase()]);
    if (isFinite(v) && v > 0) rates[c] = 1 / v;
  });
  return { date: String(json.date), rates };
}

// Days → { day: { date, rates } }; a day the source doesn't answer for is left out.
function fetchFxDays_(days, currencies) {
  const out = {};
  for (let i = 0; i < days.length; i += FX_BATCH_) {
    const batch = days.slice(i, i + FX_BATCH_);
    const res = UrlFetchApp.fetchAll(batch.map(d => ({ url: FX_SOURCES_[0](d), muteHttpExceptions: true })));
    batch.forEach((day, j) => {
      let parsed = res[j].getResponseCode() === 200 ? parseFxDay_(res[j].getContentText(), currencies) : null;
      if (!parsed) {
        try {
          const r = UrlFetchApp.fetch(FX_SOURCES_[1](day), { muteHttpExceptions: true });
          if (r.getResponseCode() === 200) parsed = parseFxDay_(r.getContentText(), currencies);
        } catch (err) {
          console.warn('FX ' + day + ' unavailable: ' + err);
        }
      }
      if (parsed) out[day] = parsed;
    });
  }
  return out;
}

function isoDay_(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayMs_(day) {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

/**
 * Rewrites RatesHistory for the quoted currencies from `from` to yesterday with the daily source, so the whole
 * range comes from one place. Other rows (pegs, older days, days the source missed) stay. Run by hand (admin exec):
 * backfillRatesHistory_('2026-01-01').
 */
function backfillRatesHistory_(from) {
  const quoted = quotedCurrencies_();
  const today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  const days = [];
  for (let ms = dayMs_(from); isoDay_(ms) < today; ms += 86400000) days.push(isoDay_(ms));
  const got = fetchFxDays_(days, quoted);

  const sh = SpreadsheetApp.getActive().getSheetByName('RatesHistory');
  const old = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues() : [];
  const replaced = r => {
    const d = formatDate_(r[0]);
    return quoted.indexOf(r[1]) >= 0 && got[d] && got[d].rates[r[1]] !== undefined;
  };
  const rows = old.filter(r => !replaced(r)).map(r => [formatDate_(r[0]), r[1], r[2]]);
  Object.keys(got).forEach(day => {
    Object.keys(got[day].rates).forEach(cur => rows.push([day, cur, got[day].rates[cur]]));
  });
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  if (old.length) sh.getRange(2, 1, old.length, 3).clearContent();
  if (rows.length) {
    if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
    sh.getRange(2, 1, rows.length, 3).setValues(rows.map(r => [parseDate_(r[0]), r[1], r[2]]));
  }
  dropFxCache_();
  return { days: days.length, fetched: Object.keys(got).length, missed: days.filter(d => !got[d]), rows: rows.length };
}

// The median of the days within 2 of a day ([[day, value]]; the latest day has only the ones before it): a thin
// currency's weekend quote (some jump ~1.5% on Sundays) or a one-day swing doesn't move a return, and
// unlike a trailing window it doesn't lag a trend (gold fell ~4% in the last days of 2025).
function medianAround_(series, day) {
  const from = isoDay_(dayMs_(day) - 2 * 86400000);
  const to = isoDay_(dayMs_(day) + 2 * 86400000);
  const vals = series.filter(p => p[0] >= from && p[0] <= to).map(p => p[1]).sort((a, b) => a - b);
  const m = vals.length >> 1;
  return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
}

/**
 * Rates for the realized returns, from RatesHistory: per currency the 5-day median around the last day on or before the
 * start of each window (Jan 1 of this year; the same day a year ago) — the first day when the history begins
 * later — and up to the latest day. Pegs typed by hand in Rates keep their value at both ends.
 */
function readFxWindows_() {
  const today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  // They change only when RatesHistory does: a sync reuses them for the day (computing takes ~1.5 s).
  const cache = CacheService.getScriptCache();
  const hit = cache.get(fxCacheKey_(today));
  if (hit) return JSON.parse(hit);
  const out = computeFxWindows_(today);
  cache.put(fxCacheKey_(today), JSON.stringify(out), 21600);
  return out;
}

function fxCacheKey_(today) {
  return 'fx_windows:' + (today || Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'));
}

// After RatesHistory changes.
function dropFxCache_() {
  CacheService.getScriptCache().remove(fxCacheKey_());
}

function computeFxWindows_(today) {
  const starts = { ytd: today.slice(0, 4) + '-01-01', y1: (Number(today.slice(0, 4)) - 1) + today.slice(4) };
  const out = { ytd: { start: starts.ytd, rates: {} }, y1: { start: starts.y1, rates: {} }, now: {} };

  const series = {};
  const sh = SpreadsheetApp.getActive().getSheetByName('RatesHistory');
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(r => {
      const d = formatDate_(r[0]);
      const cur = String(r[1] || '').trim();
      const v = Number(r[2]);
      if (d && cur && isFinite(v) && v > 0) (series[cur] = series[cur] || []).push([d, v]);
    });
  }
  const quoted = quotedCurrencies_();
  Object.keys(series).forEach(cur => {
    if (quoted.indexOf(cur) < 0) return;
    const s = series[cur].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const point = p => ({ date: p[0], usd: medianAround_(s, p[0]) });
    out.now[cur] = point(s[s.length - 1]);
    ['ytd', 'y1'].forEach(w => {
      let at = null;
      s.forEach(p => { if (p[0] <= starts[w]) at = p; });
      out[w].rates[cur] = point(at || s[0]);
    });
  });
  const rates = readRates_();
  Object.keys(rates).forEach(cur => {
    if (quoted.indexOf(cur) >= 0) return;
    out.now[cur] = { date: today, usd: rates[cur] };
    out.ytd.rates[cur] = { date: starts.ytd, usd: rates[cur] };
    out.y1.rates[cur] = { date: starts.y1, usd: rates[cur] };
  });
  return out;
}
