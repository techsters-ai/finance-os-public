// Builds transactions records following the sign rules of the data model.
import type { Account, Rates, Transaction } from './types';
import { roundMoney, roundTo } from './money';
import { rateOf } from './fx';
import { joinTags } from './tags';

export interface TxContext {
  id: string;
  now: string;
  rates: Rates;
  /** Record being edited: keep its id, created_at and historical rate. */
  base?: Transaction;
}

export interface TxDraft {
  type: 'expense' | 'income' | 'transfer' | 'adjustment';
  date: string;
  account: Account;
  /** Absolute amount in the account currency; signed for adjustment. */
  amount: number;
  category_id?: string;
  toAccount?: Account;
  /** Absolute amount in the destination account currency. */
  toAmount?: number;
  orig?: { amount: number; currency: string } | null;
  note?: string;
  tags?: string[];
}

export function emptyTransaction(): Transaction {
  return {
    id: '',
    date: '',
    type: 'expense',
    account_id: '',
    amount: 0,
    to_account_id: '',
    to_amount: '',
    category_id: '',
    orig_amount: '',
    orig_currency: '',
    note: '',
    tags: '',
    usd_rate: '',
    amount_usd: '',
    created_at: '',
    updated_at: '',
    deleted: false,
    server_ts: '',
  };
}

/** USD per unit of the account currency: the historical rate when editing without a currency change. */
function usdRateFor(account: Account, ctx: TxContext, baseAccountCurrency?: string): number | '' {
  const base = ctx.base;
  if (base && typeof base.usd_rate === 'number' && base.usd_rate > 0 && baseAccountCurrency === account.currency) {
    return base.usd_rate;
  }
  return rateOf(account.currency, ctx.rates) ?? '';
}

export function buildTransaction(draft: TxDraft, ctx: TxContext, baseAccountCurrency?: string): Transaction {
  const cur = draft.account.currency;
  const abs = roundMoney(Math.abs(draft.amount), cur);
  let amount: number;
  switch (draft.type) {
    case 'expense':
    case 'transfer':
      amount = -abs;
      break;
    case 'income':
      amount = abs;
      break;
    case 'adjustment':
      amount = roundMoney(draft.amount, cur);
      break;
  }
  const usd_rate = usdRateFor(draft.account, ctx, baseAccountCurrency);
  const isTransfer = draft.type === 'transfer';
  const sign = amount < 0 ? -1 : 1;
  const orig = !isTransfer && draft.orig && draft.orig.currency !== cur ? draft.orig : null;
  return {
    ...emptyTransaction(),
    id: ctx.base?.id ?? ctx.id,
    date: draft.date,
    type: draft.type,
    account_id: draft.account.id,
    amount,
    to_account_id: isTransfer ? draft.toAccount?.id ?? '' : '',
    to_amount:
      isTransfer && draft.toAccount ? roundMoney(Math.abs(draft.toAmount ?? 0), draft.toAccount.currency) : '',
    category_id: isTransfer ? '' : draft.category_id ?? '',
    orig_amount: orig ? sign * roundMoney(Math.abs(orig.amount), orig.currency) : '',
    orig_currency: orig ? orig.currency : '',
    note: draft.note?.trim() ?? '',
    tags: joinTags(draft.tags ?? []),
    usd_rate,
    amount_usd: usd_rate === '' ? '' : roundTo(amount * usd_rate, 2),
    created_at: ctx.base?.created_at || ctx.now,
    updated_at: ctx.now,
    deleted: false,
    server_ts: ctx.base?.server_ts ?? '',
  };
}
