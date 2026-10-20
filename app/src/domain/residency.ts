// Tax residency: days per country from the Locations days (apps-script/Locations.js).
// A day counts for every country you were in that day: a flight day for both ends, a same-day connection not at all.
// A day without a record is assumed in the country the previous recorded day ended in (its last country);
// days before the first record count nowhere.
import type { Account, LocationDay, TaxRate, TaxSummary, Transaction } from './types';
import { addDays } from './dates';

export const countriesOf = (d: Pick<LocationDay, 'countries'>): string[] => d.countries.split(' ').filter(Boolean);

export interface PresenceDay {
  date: string;
  countries: string[];
  /** No record: where the previous recorded day ended. */
  assumed: boolean;
  record?: LocationDay;
}

/** Every day from `from` to `to` (inclusive) that falls on or after the first record. */
export function presenceDays(days: LocationDay[], from: string, to: string): PresenceDay[] {
  const live = days.filter((d) => !d.deleted && d.date && d.countries).sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(live.map((d) => [d.date, d]));
  let last = '';
  for (const d of live) {
    if (d.date >= from) break;
    last = countriesOf(d).at(-1) ?? last;
  }
  const out: PresenceDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const record = byDate.get(date);
    if (record) {
      const countries = countriesOf(record);
      out.push({ date, countries, assumed: false, record });
      last = countries.at(-1) ?? last;
    } else if (last) out.push({ date, countries: [last], assumed: true });
  }
  return out;
}

/** The whole years before this one that have days recorded, newest first (last year at least). */
export function pastYears(days: LocationDay[], now: string): number[] {
  const y = Number(now.slice(0, 4));
  const first = days.reduce((m, d) => (!d.deleted && d.countries && d.date && Number(d.date.slice(0, 4)) < m ? Number(d.date.slice(0, 4)) : m), y - 1);
  return Array.from({ length: y - first }, (_, i) => y - 1 - i);
}

export interface CountryDays {
  country: string;
  days: number;
}

/** Days per country, most first. */
export function countDays(days: LocationDay[], from: string, to: string): CountryDays[] {
  const counts = new Map<string, number>();
  for (const p of presenceDays(days, from, to)) for (const c of p.countries) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts].map(([country, n]) => ({ country, days: n })).sort((a, b) => b.days - a.days || a.country.localeCompare(b.country));
}

export type ResidencyWindow = 'ytd' | 'y1' | 'year';

/** YTD: since Jan 1; y1: the 12 months up to today (a 12m window's count); year: a whole past year, last year by default. */
export function residencyRange(w: ResidencyWindow, now: string, year = Number(now.slice(0, 4)) - 1): { from: string; to: string } {
  const y = Number(now.slice(0, 4));
  if (w === 'year') return { from: `${year}-01-01`, to: `${year}-12-31` };
  if (w === 'y1') return { from: addDays(`${y - 1}${now.slice(4)}`, 1), to: now };
  return { from: `${y}-01-01`, to: now };
}

/** Days that make you a tax resident: the TaxRates sheet's, or 183 (Thailand 180) without a row. */
const THRESHOLDS: Record<string, number> = { TH: 180 };
export function thresholdOf(country: string, rates: TaxRate[] = []): number {
  const days = rates.find((r) => r.country === country)?.threshold_days;
  return typeof days === 'number' && days > 0 ? days : THRESHOLDS[country] ?? 183;
}

/** Tax resident nowhere (a choice, unlike not set). */
export const NOWHERE = 'NONE';

/** The country set as your tax residency (Settings tax_residency): a code, NOWHERE, or '' when not set. */
export function residencyOf(settings: Record<string, unknown>): string {
  const v = String(settings.tax_residency ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) || v === NOWHERE ? v : '';
}

/** 'Thailand', 'Nowhere' or 'Not set'. */
export const residencyName = (code: string): string => (code === NOWHERE ? 'Nowhere' : code ? countryName(code) : 'Not set');

/** How the residency was set (Settings tax_residency_set, written by the server): 'Set by hand on Oct 20', … `when`
 * turns a date into 'today' or 'on Oct 20'. */
export function residencySetNote(settings: Record<string, unknown>, when: (date: string) => string): string {
  const m = /^(manual|auto) (\d{4}-\d{2}-\d{2})(?:: (.*))?$/.exec(String(settings.tax_residency_set ?? '').trim());
  if (!m) return '';
  return m[1] === 'manual' ? `Set by hand ${when(m[2])}` : `Set automatically ${when(m[2])}${m[3] ? `: ${m[3]}` : ''}`;
}

export interface CountryRule {
  country: string;
  /** Days in its own window up to today. */
  days: number;
  threshold: number;
  window: 'year' | '12m';
}

export interface ResidencyStatus {
  /** Where the last day up to today ended. */
  current: string;
  rules: CountryRule[];
  /** Today's country 14 days or less from its rule (and still within the year for a calendar-year rule). */
  risk?: CountryRule & { left: number };
}

export const RISK_DAYS = 14;

/** Each country against its own rule (TaxRates window and threshold), as the server checks it (apps-script/Locations.js). */
export function residencyStatus(days: LocationDay[], rates: TaxRate[], now: string): ResidencyStatus {
  const year = countDays(days, `${now.slice(0, 4)}-01-01`, now);
  const rolling = countDays(days, residencyRange('y1', now).from, now);
  const countries = [...new Set([...year, ...rolling].map((c) => c.country))];
  const rules = countries.map((country) => {
    const window = rates.find((r) => r.country === country)?.window === '12m' ? '12m' : 'year';
    const n = (window === '12m' ? rolling : year).find((c) => c.country === country)?.days ?? 0;
    return { country, days: n, threshold: thresholdOf(country, rates), window } as CountryRule;
  });
  const today = presenceDays(days, now, now)[0];
  const current = today?.countries.at(-1) ?? '';
  const here = rules.find((r) => r.country === current);
  let risk: ResidencyStatus['risk'];
  if (here) {
    const left = here.threshold - here.days;
    const yearLeft = Math.round((Date.UTC(Number(now.slice(0, 4)), 11, 31) - Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 1, Number(now.slice(8, 10)))) / 86_400_000);
    if (left > 0 && left <= RISK_DAYS && (here.window === '12m' || left <= yearLeft)) risk = { ...here, left };
  }
  return { current, rules, risk };
}

/** The rule closest to being met: the most days for its threshold. */
export const closestRule = (rules: CountryRule[]): CountryRule | undefined =>
  [...rules].sort((a, b) => b.days / b.threshold - a.days / a.threshold)[0];

const ALIASES: Record<string, string> = { uae: 'AE', uk: 'GB', usa: 'US', 'united states of america': 'US', turkey: 'TR', 'south korea': 'KR', korea: 'KR' };
let codesByName: Map<string, string> | undefined;
/** An account's country as typed ('Russia', 'UAE', 'RU') → its code; '' for Global and the unknown. */
export function countryCode(name: string): string {
  const n = name.trim().toLowerCase();
  if (!n) return '';
  if (ALIASES[n]) return ALIASES[n];
  if (/^[a-z]{2}$/.test(n)) return n.toUpperCase();
  codesByName ??= new Map(COUNTRY_CODES.map((c) => [countryName(c).toLowerCase(), c]));
  return codesByName.get(n) ?? '';
}

export interface ResidentTax {
  country: string;
  /** TaxRates foreign_rate; null when the sheet gives none. */
  rate: number | null;
  /** Income since Jan 1 on accounts outside the country of residence (USD). */
  foreignUsd: number;
  /** Taxes due where that income was earned, this year: the rules' accrual and what was withheld (USD). */
  paidAbroadUsd: number;
  owedUsd: number;
}

/**
 * What the country of residence would want on foreign income this year, an estimate: income since Jan 1 on accounts
 * in other countries (an account's country is where its income comes from; none = abroad) × the country's
 * foreign_rate, less the taxes due where it was earned (each tax rule's accrual this year and the tax withheld from
 * that income). Null when resident nowhere or not set.
 */
export function residentTax(p: {
  residency: string;
  rates: TaxRate[];
  accounts: Account[];
  transactions: Transaction[];
  /** The tax rules (the server's Taxes): one with a `country` is due there, `business` where the business accounts are. */
  rules: TaxSummary['rules'];
  toUsd: (amount: number, currency: string) => number;
  now: string;
}): ResidentTax | null {
  const country = p.residency;
  if (!/^[A-Z]{2}$/.test(country)) return null;
  const from = `${p.now.slice(0, 4)}-01-01`;
  const where = new Map(p.accounts.map((a) => [a.id, countryCode(a.country)]));
  const abroad = (accountId: string) => where.get(accountId) !== country;
  const inYear = (t: Transaction) => !t.deleted && t.date >= from && t.date <= p.now;
  const usd = (t: Transaction) => (typeof t.amount_usd === 'number' ? t.amount_usd : 0);
  const foreignUsd = p.transactions.filter((t) => inYear(t) && t.type === 'income' && abroad(t.account_id)).reduce((s, t) => s + Math.max(0, usd(t)), 0);
  const withheld = p.transactions.filter((t) => inYear(t) && t.id.endsWith('-tax') && abroad(t.account_id)).reduce((s, t) => s + Math.abs(usd(t)), 0);
  const business = p.accounts.filter((a) => a.group === 'business' && !a.archived).map((a) => countryCode(a.country)).filter(Boolean);
  const bizCountry = business.sort((a, b) => business.filter((x) => x === b).length - business.filter((x) => x === a).length)[0] ?? '';
  const ruleCountry = (r: TaxSummary['rules'][number]) => (r.country ? countryCode(r.country) : r.id === 'business' ? bizCountry : '');
  const accrued = p.rules
    .filter((r) => ruleCountry(r) !== country)
    .reduce((s, r) => s + r.periods.filter((x) => x.key.startsWith(p.now.slice(0, 4))).reduce((a, x) => a + p.toUsd(x.accrued, r.owed.currency), 0), 0);
  const row = p.rates.find((r) => r.country === country);
  const rate = typeof row?.foreign_rate === 'number' ? row.foreign_rate : null;
  const paidAbroadUsd = withheld + accrued;
  return { country, rate, foreignUsd, paidAbroadUsd, owedUsd: rate === null ? 0 : Math.max(0, foreignUsd * rate - paidAbroadUsd) };
}

/** 'TH' → 🇹🇭 */
export function flagOf(country: string): string {
  if (!/^[A-Z]{2}$/.test(country)) return '🏳️';
  return String.fromCodePoint(...[...country].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

let regionNames: Intl.DisplayNames | null | undefined;
/** 'TH' → 'Thailand' (the code itself where the browser doesn't know it). */
export function countryName(country: string): string {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(country) ?? country;
  } catch {
    return country;
  }
}

/** ISO 3166-1 alpha-2, plus XK (Kosovo, as Google's geocoder has it). */
export const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO ' +
  'FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE ' +
  'JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO ' +
  'MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW ' +
  'PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM ' +
  'TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
).split(' ');
