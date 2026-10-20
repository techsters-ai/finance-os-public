// Tax residency: the countries you were in, one row a day (Locations sheet, synced like accounts; id loc_<date>).
// `countries` lists a day's countries (ISO 3166 codes, space-separated) in the order you were there: the last is
// where the day ended. The app counts a day for each of them and assumes a day without a row in the country the
// previous one ended in (app/src/domain/residency.ts).
// Check-ins: action 'checkin' with the place (lat, lon; the country is looked up with Google's geocoder) or a
// country, from the iPhone Shortcut on a schedule or the app; the country is added to that day's row.
// Residency: each country's rule (TaxRates: threshold_days in the calendar year or any 12 months) is checked at each
// check-in and daily. Meeting one sets Settings tax_residency to that country (once a country and year, so a change
// by hand stays); 14 days before the rule is met in the country you're in, a warning. Both are queued and go out
// with the next check-in's answer (`notify`), which the Shortcut shows as a notification.

const COUNTRY_RE_ = /^[A-Z]{2}$/;
const CHECKIN_SOURCES_ = ['shortcut', 'app', 'manual'];

/** A day's countries after a check-in: the country moves to the end (where the day ended so far), once. */
function mergeCountries_(countries, country) {
  const list = String(countries || '').split(/[\s,]+/).filter(c => c && c !== country);
  list.push(country);
  return list.join(' ');
}

/** { country, city } at a point, or null at sea and wherever the geocoder finds no country. */
function countryAt_(lat, lon) {
  const res = Maps.newGeocoder().setLanguage('en').reverseGeocode(lat, lon);
  const results = (res && res.results) || [];
  let country = '';
  let city = '';
  results.forEach(r => {
    (r.address_components || []).forEach(c => {
      if (!country && c.types.indexOf('country') >= 0) country = String(c.short_name || '').toUpperCase();
      if (!city && c.types.indexOf('locality') >= 0) city = String(c.long_name || '');
    });
  });
  return COUNTRY_RE_.test(country) ? { country, city } : null;
}

// Shortcuts on an iPhone set to a comma-decimal language may send "13,7563".
const coord_ = v => (v === undefined || v === null || v === '' ? NaN : Number(String(v).trim().replace(',', '.')));

/** req: { lat, lon } or { country }, optional date 'YYYY-MM-DD' (your local day; the sheet's today without it), source. */
function handleCheckin_(req) {
  const lat = coord_(req.lat);
  const lon = coord_(req.lon);
  let country = String(req.country || '').trim().toUpperCase();
  let city = String(req.city || '').trim();
  if (isFinite(lat) && isFinite(lon)) {
    const at = countryAt_(lat, lon);
    if (!at) throw badRequest_('No country at ' + lat + ', ' + lon);
    country = at.country;
    city = at.city;
  }
  if (!COUNTRY_RE_.test(country)) throw badRequest_('Send lat and lon, or a two-letter country code');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.date || '')) ? String(req.date) : Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  const source = CHECKIN_SOURCES_.indexOf(req.source) >= 0 ? req.source : 'shortcut';
  return withLock_(() => {
    const day = recordCheckin_(date, country, city, source);
    try {
      residencyJob_(date);
    } catch (err) {
      console.warn('Residency not checked: ' + err);
    }
    return { ok: true, country, city, day, notify: popResidencyNotices_() };
  });
}

/** Adds the country to the day's row (a new row for a new day) and returns the record as sync sends it. */
function recordCheckin_(date, country, city, source) {
  const sh = sheetFor_('locations');
  const { headers, rows } = readTable_(sh);
  const col = colIndex_(headers);
  const id = 'loc_' + date;
  const pos = rows.findIndex(r => String(r[col.id]) === id);
  const prev = pos >= 0 ? rowToRecord_('locations', headers, rows[pos]) : null;
  const live = prev && !prev.deleted;
  const now = new Date().toISOString();
  const rec = {
    id,
    date,
    countries: mergeCountries_(live ? prev.countries : '', country),
    city: city || (live ? prev.city : ''),
    source,
    note: live ? prev.note : '',
    deleted: false,
    created_at: prev && prev.created_at ? prev.created_at : now,
    updated_at: now,
  };
  const row = recordToRow_('locations', headers, rec, pos >= 0 ? rows[pos] : null, now);
  if (pos >= 0) sh.getRange(pos + 2, 1, 1, headers.length).setValues([row]);
  else appendRows_(sh, [row]);
  return Object.assign(rec, { server_ts: now });
}

// Tax rates by country of residence (TaxRates sheet, typed in by hand: headline rates as text): the app shows the
// row of the country you set as your tax residency (Settings tax_residency) and counts days against threshold_days.
// window: 'year' (the calendar year) or '12m' (any 12 months in a row); foreign_rate: the share of foreign income the
// app sets aside as a resident there (an estimate, typed in); residency_tests: every way to become a resident, one a
// line; source: where the figures come from; confidence: high (official sources) / medium (other guides) / low.
const TAX_RATE_FIELDS_ = ['country', 'domestic_income', 'foreign_income', 'capital_gains', 'residency_rule', 'threshold_days', 'window', 'foreign_rate', 'residency_tests', 'note', 'as_of', 'source', 'confidence'];
const TAX_RATE_NUMBERS_ = ['threshold_days', 'foreign_rate'];

function readTaxRates_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('TaxRates');
  if (!sh || sh.getLastRow() < 2) return [];
  const { headers, rows } = readTable_(sh);
  const col = colIndex_(headers);
  return rows
    .map(r => {
      const o = {};
      TAX_RATE_FIELDS_.forEach(f => {
        const v = col[f] === undefined ? '' : r[col[f]];
        o[f] = TAX_RATE_NUMBERS_.indexOf(f) >= 0 ? (v === '' || !isFinite(Number(v)) ? '' : Number(v)) : isDate_(v) ? formatDate_(v) : String(v).trim();
      });
      o.country = o.country.toUpperCase();
      o.window = o.window === '12m' ? '12m' : 'year';
      return o;
    })
    .filter(o => COUNTRY_RE_.test(o.country));
}

/** A short fingerprint of a value (MD5 of its JSON, base64): tells the app whether what it has is current. */
function hashOf_(value) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(value), Utilities.Charset.UTF_8));
}

// Settings the app may change (action 'set_setting'), each with its check. tax_residency: a country code, NONE
// (resident nowhere) or empty (not set).
const SETTABLE_ = {
  tax_residency: v => v === '' || v === 'NONE' || COUNTRY_RE_.test(v),
};

// writeSetting_ (Menu.js) writes a Settings row; call it under the lock.

/** req: { setting, value } (`key` is the API key). Writes the Settings row (a new one at the end if missing); answers with all settings. */
function handleSetSetting_(req) {
  const key = String(req.setting || '');
  const value = String(req.value === undefined || req.value === null ? '' : req.value).trim().toUpperCase();
  if (!SETTABLE_[key]) throw badRequest_('This setting is not changed from the app: ' + key);
  if (!SETTABLE_[key](value)) throw badRequest_('Bad value for ' + key + ': ' + value);
  withLock_(() => {
    writeSetting_(key, value);
    if (key === 'tax_residency') writeSetting_('tax_residency_set', 'manual ' + Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'));
  });
  return { ok: true, settings: readSettings_() };
}

// ── Residency rules ──

const RES_RISK_DAYS_ = 14;
const RES_FALLBACK_DAYS_ = { TH: 180 };

function addDaysStr_(date, n) {
  const t = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

const daysBetween_ = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);

/** 'year': since Jan 1; '12m': the 12 months up to today (as the app counts, domain/residency.ts). */
function windowStart_(win, today) {
  return win === '12m' ? addDaysStr_(String(Number(today.slice(0, 4)) - 1) + today.slice(4), 1) : today.slice(0, 4) + '-01-01';
}

/** The app's rule (domain/residency.ts): a day counts for each of its countries, a day without a row where the one before ended. */
function presenceCounts_(days, from, to) {
  const live = days.filter(d => !d.deleted && d.date && d.countries).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byDate = {};
  live.forEach(d => { byDate[d.date] = String(d.countries).split(/\s+/).filter(Boolean); });
  let last = '';
  live.forEach(d => { if (d.date < from) last = byDate[d.date][byDate[d.date].length - 1] || last; });
  const counts = {};
  for (let d = from; d <= to; d = addDaysStr_(d, 1)) {
    const c = byDate[d] || (last ? [last] : []);
    c.forEach(x => { counts[x] = (counts[x] || 0) + 1; });
    if (byDate[d]) last = c[c.length - 1] || last;
  }
  return { counts, last };
}

/**
 * Each country's days in its own window against its threshold; the country you're in today (where the last day up to
 * today ended); the countries whose rule is met; the risk: today's country `left` days from its rule (14 at most,
 * and still within the year for a calendar-year rule).
 */
function residencyCheck_(days, rates, today) {
  const rule = c => {
    const r = rates.filter(x => x.country === c)[0] || {};
    return { window: r.window === '12m' ? '12m' : 'year', threshold: Number(r.threshold_days) > 0 ? Number(r.threshold_days) : RES_FALLBACK_DAYS_[c] || 183 };
  };
  const year = presenceCounts_(days, windowStart_('year', today), today);
  const rolling = presenceCounts_(days, windowStart_('12m', today), today);
  const status = Object.keys(Object.assign({}, year.counts, rolling.counts)).map(c => {
    const r = rule(c);
    return { country: c, days: (r.window === '12m' ? rolling : year).counts[c] || 0, threshold: r.threshold, window: r.window };
  });
  const current = rolling.last;
  const here = status.filter(s => s.country === current)[0];
  let risk = null;
  if (here) {
    const left = here.threshold - here.days;
    const reachable = here.window === '12m' || left <= daysBetween_(today, today.slice(0, 4) + '-12-31');
    if (left > 0 && left <= RES_RISK_DAYS_ && reachable) risk = Object.assign({ left }, here);
  }
  return { current, status, crossed: status.filter(s => s.days >= s.threshold), risk };
}

function regionName_(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
  } catch (err) {
    return code;
  }
}

/** Checks the rules for `today` (under the lock): sets the residency, queues the notices. Returns the new notices. */
function residencyJob_(today) {
  const ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName(SHEETS.locations)) return [];
  const days = readRecords_('locations');
  if (!days.length) return [];
  const check = residencyCheck_(days, readTaxRates_(), today);
  const props = PropertiesService.getScriptProperties();
  const year = today.slice(0, 4);
  const set = String(readSettings_().tax_residency || '').toUpperCase();
  const span = s => (s.window === '12m' ? 'in 12 months' : 'this year');
  const notes = [];
  check.crossed.forEach(s => {
    const key = 'res_auto_' + s.country + '_' + year;
    if (props.getProperty(key)) return;
    props.setProperty(key, today);
    if (set !== s.country) {
      writeSetting_('tax_residency', s.country);
      writeSetting_('tax_residency_set', 'auto ' + today + ': ' + s.days + ' days ' + span(s) + ', the rule is ' + s.threshold);
    }
    notes.push('You are now a tax resident of ' + regionName_(s.country) + ': ' + s.days + ' days ' + span(s) + ' (' + s.threshold + ' make you one).');
  });
  const r = check.risk;
  if (r && !props.getProperty('res_risk_' + r.country + '_' + year)) {
    props.setProperty('res_risk_' + r.country + '_' + year, today);
    notes.push('Tax residency risk: ' + r.left + ' more days in ' + regionName_(r.country) + ' make you a tax resident there (' + r.days + ' of ' + r.threshold + ' ' + span(r) + ').');
  }
  if (notes.length) {
    const queued = JSON.parse(props.getProperty('res_notify') || '[]');
    props.setProperty('res_notify', JSON.stringify(queued.concat(notes)));
  }
  return notes;
}

/** The queued notices as one text for the check-in's answer (the Shortcut shows it), and the queue emptied. */
function popResidencyNotices_() {
  const props = PropertiesService.getScriptProperties();
  const queued = JSON.parse(props.getProperty('res_notify') || '[]');
  if (queued.length) props.deleteProperty('res_notify');
  return queued.join('\n');
}
