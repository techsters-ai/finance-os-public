// Dates as 'YYYY-MM-DD', months as 'YYYY-MM', English labels.
import { localDate } from './normalize';

export function today(): string {
  return localDate(new Date());
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

export function currentMonth(): string {
  return today().slice(0, 7);
}

/** '2026-10' + n months → 'YYYY-MM'. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return localDate(new Date(y, m, 0));
}

/** Every month touched by the range, oldest first. */
export function monthsInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const last = to.slice(0, 7);
  for (let m = from.slice(0, 7); m <= last && out.length < 600; m = addMonths(m, 1)) out.push(m);
  return out;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const short = (m: number) => MONTHS[m - 1].slice(0, 3);

/** 'October 2026' */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** 'Oct' within the current year, otherwise 'Oct 25'. */
export function monthShort(month: string, now = today()): string {
  const [y, m] = month.split('-').map(Number);
  return String(y) === now.slice(0, 4) ? short(m) : `${short(m)} ${String(y).slice(2)}`;
}

/** 'in October' */
export function monthPrep(month: string): string {
  return `in ${MONTHS[Number(month.slice(5, 7)) - 1]}`;
}

/** 'Today', 'Yesterday', 'Friday, October 16', 'Saturday, May 3, 2025' */
export function dayLabel(date: string, now = today()): string {
  if (date === now) return 'Today';
  if (date === addDays(now, -1)) return 'Yesterday';
  if (date === addDays(now, 1)) return 'Tomorrow';
  const [y, m, d] = date.split('-').map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  const year = String(y) === now.slice(0, 4) ? '' : `, ${y}`;
  return `${wd}, ${MONTHS[m - 1]} ${d}${year}`;
}

/** Short date for chips: 'Today', 'Yesterday', 'Oct 16', 'Oct 16, 2025' */
export function shortDay(date: string, now = today()): string {
  if (date === now) return 'Today';
  if (date === addDays(now, -1)) return 'Yesterday';
  const [y, m, d] = date.split('-').map(Number);
  return String(y) === now.slice(0, 4) ? `${short(m)} ${d}` : `${short(m)} ${d}, ${y}`;
}

/** Time from ISO: '12:30' today, otherwise 'Oct 16, 12:30'. */
export function timeLabel(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = localDate(d);
  return day === today() ? hm : `${shortDay(day)}, ${hm}`;
}

/** 'October 2026', 'Aug – Oct 2026', 'Dec 2025 – Feb 2026', 'Sep 15 – Oct 10, 2026' */
export function rangeLabel(from: string, to: string, now = today()): string {
  const fm = from.slice(0, 7);
  const tm = to.slice(0, 7);
  const wholeMonths = from === monthStart(fm) && to === monthEnd(tm);
  if (wholeMonths && fm === tm) return monthLabel(fm);
  const [fy, fmo] = fm.split('-').map(Number);
  const [ty, tmo] = tm.split('-').map(Number);
  if (wholeMonths) {
    return fy === ty ? `${short(fmo)} – ${short(tmo)} ${ty}` : `${short(fmo)} ${fy} – ${short(tmo)} ${ty}`;
  }
  const left = `${short(fmo)} ${Number(from.slice(8))}${fy === ty ? '' : `, ${fy}`}`;
  const right = `${short(tmo)} ${Number(to.slice(8))}${String(ty) === now.slice(0, 4) && fy === ty ? '' : `, ${ty}`}`;
  return `${left} – ${right}`;
}

/** 'account' / 'accounts' */
export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
