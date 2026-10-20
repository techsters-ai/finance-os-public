// Automations in the app: when the next accrual is due and about how much it will be. The server records them
// (apps-script/Automations.js, the same rules): balance at the start of the day × the card's rate × days / 365.
import type { Account, Automation } from './types';
import { addDays } from './dates';
import { roundMoney } from './money';

/** The day `day` of a month ('YYYY-MM'), or its last day when shorter. */
function monthDay(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function dayOf(a: Pick<Automation, 'day' | 'start_date'>): number {
  const d = typeof a.day === 'number' ? a.day : Number(a.start_date.slice(8, 10));
  return Math.min(31, Math.max(1, d || 1));
}

/** The next run on or after `from` (not before the start), and the days it covers. */
export function nextDue(a: Pick<Automation, 'frequency' | 'day' | 'start_date'>, from: string): { date: string; days: number } {
  const start = a.start_date && a.start_date > from ? a.start_date : from;
  if (a.frequency === 'weekly') {
    const anchor = a.start_date || start;
    const ahead = ((daysBetween(anchor, start) % 7) + 7) % 7;
    return { date: ahead ? addDays(start, 7 - ahead) : start, days: 7 };
  }
  if (a.frequency === 'yearly') {
    const anchor = a.start_date || start;
    const [, m, d] = anchor.split('-').map(Number);
    const mm = String(m).padStart(2, '0');
    let date = monthDay(`${start.slice(0, 4)}-${mm}`, d);
    if (date < start) date = monthDay(`${Number(start.slice(0, 4)) + 1}-${mm}`, d);
    return { date, days: daysBetween(monthDay(`${Number(date.slice(0, 4)) - 1}-${mm}`, d), date) };
  }
  if (a.frequency !== 'monthly') return { date: start, days: 1 };
  const day = dayOf(a);
  let month = start.slice(0, 7);
  let date = monthDay(month, day);
  if (date < start) {
    month = shiftMonth(month, 1);
    date = monthDay(month, day);
  }
  return { date, days: daysBetween(monthDay(shiftMonth(month, -1), day), date) };
}

/** About what an accrual of `days` brings at today's balance; 0 without a rate. */
export function estimate(account: Account | undefined, balance: number, days: number): number {
  const apr = typeof account?.apr_gross === 'number' ? account.apr_gross : 0;
  return apr > 0 && balance > 0 ? roundMoney((balance * apr * days) / 365, account!.currency) : 0;
}

/**
 * A new rule starts with the next due date: tomorrow for a daily one (today may be recorded by hand already), the
 * next such day for a monthly one, today for a weekly or yearly one (its start sets the weekday or the date).
 */
export function defaultStart(frequency: Automation['frequency'], day: number, today: string): string {
  if (frequency === 'daily') return addDays(today, 1);
  if (frequency === 'monthly') return nextDue({ frequency, day, start_date: '' }, today).date;
  return today;
}
