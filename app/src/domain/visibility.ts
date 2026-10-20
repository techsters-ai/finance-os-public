// Which accounts the lists show. Hidden accounts still count in every total; only archived ones don't.
import type { Account } from './types';

/** Hidden by hand, or automatically while the balance is 0 (a paid-off credit card stays visible). */
export function isHiddenAccount(a: Pick<Account, 'visibility' | 'type'>, balance: number): boolean {
  if (a.visibility === 'hide') return true;
  if (a.visibility === 'show') return false;
  return balance === 0 && a.type !== 'credit';
}
