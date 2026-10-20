// Transaction entry: 2–3 taps. Our own calculator keypad instead of the system keyboard.
import { useMemo, useState } from 'preact/hooks';
import {
  accountHidden,
  accounts,
  accountsById,
  activeAccounts,
  balances,
  categories,
  categoriesById,
  categoryTree,
  currencyOf,
  defaultAccountFor,
  deleteTransaction,
  rates,
  rememberAccount,
  saveTransaction,
  suggestedTags,
  transactions,
} from '../../data/store';
import type { Account, Transaction, TxType } from '../../domain/types';
import {
  CURRENCIES,
  CURRENCY_NAMES,
  applyKey,
  decimals,
  evaluate,
  formatMoney,
  hasOperator,
  prettyExpr,
  rateLine,
  symbolOf,
  toExpr,
} from '../../domain/money';
import { convert, crossRate, hasRate } from '../../domain/fx';
import { buildTransaction } from '../../domain/transactions';
import { splitTax, taxCategory, taxIdOf, taxRuleFor, type TaxRule } from '../../domain/tax';
import { expectedMonthlyUsd } from '../../domain/interest';
import { INC_INTEREST } from '../../domain/reconcile';
import { roundMoney } from '../../domain/money';
import { shortDay, today } from '../../domain/dates';
import { uuid, nowIso } from '../../data/ids';
import { AccountIcon, CatIcon, Row, Section, Segmented, Sheet, cx, showToast, shownCurrency } from '../components';
import { IconArrowRight, IconCalendar, IconChevronDown, IconClose, IconCurrency, IconTag, IconTrash } from '../icons';
import { cleanTag, parseTags } from '../../domain/tags';
import { isDebt } from '../../domain/debts';
import { Keypad, type PadKey } from '../Keypad';
import { back } from '../router';
import { AccountPickerSheet } from '../AccountPicker';

type Mode = TxType;
type FlowMode = 'expense' | 'income';

interface State {
  mode: Mode;
  categoryId: string;
  accountId: string;
  toAccountId: string;
  date: string;
  note: string;
  /** Purchase currency when it differs from the account currency; '' means the account currency. */
  foreign: string;
  main: string;
  second: string;
  /** The second amount was edited by hand: don't recompute it from the rate. */
  secondTouched: boolean;
  active: 'main' | 'second';
  /** The next digit replaces the active field's value. */
  fresh: boolean;
  accountTouched: boolean;
  tags: string[];
}

/** Automatic tax on an income here (domain/tax.ts); none without a Taxes category to book it to. */
function autoTaxRule(accountId: string, categoryId: string): TaxRule | undefined {
  const account = accountsById.value.get(accountId);
  if (!account || !taxCategory(categories.value)) return undefined;
  const interest = categoryId === INC_INTEREST || categoriesById.value.get(categoryId)?.parent_id === INC_INTEREST;
  return taxRuleFor(account, interest, accounts.value, (a) => expectedMonthlyUsd(a, balances.value.get(a.id) ?? 0, rates.value));
}

/** The automatic tax recorded with an income, if any. */
const taxOf = (incomeId: string) => transactions.value.find((t) => t.id === taxIdOf(incomeId) && !t.deleted);

function initialState(editing: Transaction | undefined, q: URLSearchParams): State {
  if (editing) {
    const accCur = currencyOf(editing.account_id) ?? 'USD';
    const foreign = editing.orig_currency && editing.orig_currency !== accCur ? editing.orig_currency : '';
    const isTransfer = editing.type === 'transfer';
    // An income typed after tax shows what arrived again: the income minus its automatic tax.
    const tax = editing.type === 'income' ? taxOf(editing.id) : undefined;
    const net =
      tax && editing.amount && autoTaxRule(editing.account_id, editing.category_id)?.mode === 'net'
        ? (Math.abs(editing.amount) - Math.abs(tax.amount)) / Math.abs(editing.amount)
        : 1;
    const abs = (v: number | '', cur: string) => (v === '' ? '' : roundMoney(Math.abs(v) * net, cur));
    let main: string;
    let second = '';
    if (editing.type === 'adjustment') main = toExpr(editing.amount, accCur);
    else if (foreign && editing.orig_amount !== '') {
      main = toExpr(abs(editing.orig_amount, foreign), foreign);
      second = toExpr(abs(editing.amount, accCur), accCur);
    } else {
      main = toExpr(abs(editing.amount, accCur), accCur);
      if (isTransfer) second = toExpr(abs(editing.to_amount, currencyOf(editing.to_account_id) ?? accCur), currencyOf(editing.to_account_id) ?? accCur);
    }
    return {
      mode: editing.type,
      categoryId: editing.category_id,
      accountId: editing.account_id,
      toAccountId: editing.to_account_id,
      date: editing.date,
      note: editing.note,
      foreign,
      main,
      second,
      secondTouched: second !== '',
      active: 'main',
      fresh: false,
      accountTouched: true,
      tags: parseTags(editing.tags),
    };
  }
  const t = q.get('type');
  const mode: Mode = t === 'income' || t === 'transfer' ? t : 'expense';
  const categoryId = mode === 'transfer' ? '' : q.get('cat') ?? '';
  const qAcc = q.get('account');
  const accountId =
    (qAcc && activeAccounts.value.some((a) => a.id === qAcc) ? qAcc : undefined) ?? defaultAccountFor(categoryId)?.id ?? '';
  const qTo = q.get('to');
  const toAccountId = mode === 'transfer' && qTo && qTo !== accountId && activeAccounts.value.some((a) => a.id === qTo) ? qTo : '';
  // A prefilled amount in the source account's currency (settling a debt).
  const qAmount = Number(q.get('amount'));
  const main = Number.isFinite(qAmount) && qAmount > 0 ? toExpr(qAmount, currencyOf(accountId) ?? 'USD') : '';
  return {
    mode,
    categoryId,
    accountId,
    toAccountId,
    date: today(),
    note: '',
    foreign: '',
    main,
    second: '',
    secondTouched: false,
    active: 'main',
    fresh: false,
    accountTouched: !!qAcc,
    tags: [],
  };
}

/** The amount as typed (with a trailing dot and zeros): $12. · 1,250 ₽ */
export function typedAmount(expr: string, currency: string): string {
  const num = prettyExpr(expr) || '0';
  return currency === 'USD' ? `$${num}` : `${num}\u00a0${symbolOf(currency)}`;
}

function isOp(k: PadKey): boolean {
  return k === '+' || k === '-';
}

export function EntryScreen({ query }: { query: URLSearchParams }) {
  const editId = query.get('tx') ?? '';
  const editing = useMemo(
    () => (editId ? transactions.value.find((t) => t.id === editId) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editId],
  );
  const [s, setS] = useState<State>(() => initialState(editing, query));
  const [sheet, setSheet] = useState<null | 'account' | 'toAccount' | 'currency' | 'tags'>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<State>) => setS((prev) => ({ ...prev, ...patch }));

  if (editId && !editing) {
    return (
      <main class="screen screen-modal">
        <div class="empty">
          <div class="empty-title">Transaction not found</div>
          <button type="button" class="btn btn-tinted" onClick={() => back('/history')}>
            Back
          </button>
        </div>
      </main>
    );
  }

  const r = rates.value;
  const account = accountsById.value.get(s.accountId);
  const toAccount = accountsById.value.get(s.toAccountId);
  const accCur = account?.currency ?? 'USD';
  const isFlow = s.mode === 'expense' || s.mode === 'income';
  const isTransfer = s.mode === 'transfer';
  const mainCur = isFlow && s.foreign ? s.foreign : accCur;
  const secondCur = isTransfer ? toAccount?.currency ?? accCur : accCur;
  const needSecond = isFlow
    ? !!s.foreign && s.foreign !== accCur
    : isTransfer && !!toAccount && toAccount.currency !== accCur;
  const mainVal = evaluate(s.main) ?? 0;
  const autoSecond = needSecond ? convert(mainVal, mainCur, secondCur, r) : undefined;
  const secondVal = needSecond ? (s.secondTouched ? evaluate(s.second) ?? 0 : autoSecond ?? 0) : mainVal;
  const accountAmount = isFlow && needSecond ? secondVal : mainVal;
  const category = categoriesById.value.get(s.categoryId);
  // Tax the bank withheld: booked with the income as a Taxes expense on the same account.
  const taxRule = s.mode === 'income' && account ? autoTaxRule(account.id, s.categoryId) : undefined;
  const taxSplit = taxRule && accountAmount > 0 ? splitTax(accountAmount, taxRule, accCur) : undefined;

  function validate(): string | null {
    if (!account) return 'Pick an account';
    if (isFlow && !s.categoryId) return 'Pick a category';
    if (isTransfer && !toAccount) return 'Transfer to which account?';
    if (isTransfer && toAccount?.id === account.id) return 'Pick two different accounts';
    // A reconciliation may be zero: it records the date the balance was checked.
    if (s.mode !== 'adjustment' && mainVal <= 0) return 'Enter an amount';
    if (needSecond && secondVal <= 0) return 'No rate: enter the amount in the account currency';
    return null;
  }

  async function save() {
    if (saving) return;
    const err = validate();
    if (err) {
      showToast(err);
      return;
    }
    setSaving(true);
    try {
      // Typed after tax: the income is grossed up, and a foreign amount with it.
      const gross = taxSplit && accountAmount > 0 ? taxSplit.income / accountAmount : 1;
      const tx = buildTransaction(
        {
          type: s.mode,
          date: s.date || today(),
          account: account!,
          amount: s.mode === 'adjustment' ? mainVal : taxSplit ? taxSplit.income : accountAmount,
          category_id: s.categoryId,
          toAccount,
          toAmount: secondVal,
          orig: isFlow && needSecond ? { amount: mainVal * gross, currency: mainCur } : null,
          note: s.note,
          tags: s.mode === 'adjustment' ? [] : s.tags,
        },
        { id: uuid(), now: nowIso(), rates: r, base: editing },
        editing ? currencyOf(editing.account_id) : undefined,
      );
      await saveTransaction(tx);
      const oldTax = taxOf(tx.id);
      const taxCat = taxCategory(categories.value);
      if (taxSplit && taxRule && taxCat && taxSplit.tax > 0) {
        await saveTransaction(
          buildTransaction(
            {
              type: 'expense',
              date: tx.date,
              account: account!,
              amount: taxSplit.tax,
              category_id: taxCat.id,
              note: `Withheld ${Math.round(taxRule.rate * 1000) / 10}% · ${taxRule.from.name}`,
              tags: [],
            },
            { id: taxIdOf(tx.id), now: nowIso(), rates: r, base: oldTax },
            oldTax ? currencyOf(oldTax.account_id) : undefined,
          ),
        );
      } else if (oldTax) {
        await saveTransaction({ ...oldTax, deleted: true, updated_at: nowIso() });
      }
      await rememberAccount(isFlow ? s.categoryId : '', account!.id);
      showToast(editing ? 'Saved' : 'Added');
      back('/');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing || !confirm('Delete this transaction?')) return;
    await deleteTransaction(editing);
    showToast('Deleted');
    back('/history');
  }

  function onKey(k: PadKey) {
    if (k === 'ok') {
      void save();
      return;
    }
    setS((prev) => {
      const field = prev.active;
      const cur = field === 'main' ? mainCur : secondCur;
      let expr = field === 'main' ? prev.main : prev.second;
      if (prev.fresh && k !== 'back' && k !== '=' && !isOp(k)) expr = '';
      const next = applyKey(expr, k, decimals(cur), prev.mode === 'adjustment');
      if (field === 'main') return { ...prev, main: next, fresh: false, secondTouched: false };
      return { ...prev, second: next, fresh: false, secondTouched: true };
    });
  }

  function switchMode(mode: Mode) {
    if (mode === s.mode) return;
    const cat = categoriesById.value.get(s.categoryId);
    const keepCat = mode !== 'transfer' && cat?.kind === mode;
    set({
      mode,
      categoryId: keepCat ? s.categoryId : '',
      foreign: mode === 'transfer' ? '' : s.foreign,
      secondTouched: false,
      active: 'main',
    });
  }

  function pickCategory(id: string) {
    const patch: Partial<State> = { categoryId: id };
    if (!s.accountTouched && !editing) {
      const acc = defaultAccountFor(id);
      if (acc) {
        patch.accountId = acc.id;
        if (s.foreign === acc.currency) patch.foreign = '';
      }
    }
    set(patch);
  }

  function pickAccount(a: Account) {
    set({
      accountId: a.id,
      accountTouched: true,
      secondTouched: false,
      active: 'main',
      foreign: s.foreign === a.currency ? '' : s.foreign,
      toAccountId: s.toAccountId === a.id ? '' : s.toAccountId,
    });
    setSheet(null);
  }

  function pickToAccount(a: Account) {
    set({ toAccountId: a.id, secondTouched: false, active: 'main' });
    setSheet(null);
  }

  function pickCurrency(c: string) {
    set({ foreign: c === accCur ? '' : c, secondTouched: false, active: 'main' });
    setSheet(null);
  }

  function activateSecond() {
    if (s.active === 'second') return;
    set({
      active: 'second',
      fresh: true,
      second: s.secondTouched ? s.second : toExpr(autoSecond ?? 0, secondCur),
      secondTouched: true,
    });
  }

  const flowCats = isFlow ? categoryTree(s.mode as FlowMode) : [];
  const tone = s.mode === 'income' ? 'pos' : s.mode === 'transfer' ? 'accent' : '';
  const showExpr = hasOperator(s.main);
  const mainText = showExpr ? formatMoney(mainVal, mainCur, { exact: true }) : typedAmount(s.main, mainCur);
  const xr = needSecond ? crossRate(mainCur, secondCur, r) : undefined;
  // The amount also in the display currency (the $ / € / £ switch) when no field shows it.
  const shown = shownCurrency();
  const equivalent =
    shown !== mainCur && (!needSecond || shown !== secondCur) ? convert(mainVal, mainCur, shown, r) : undefined;
  const debtLine = isTransfer ? debtPreview(account, toAccount, mainVal, secondVal, editing) : undefined;

  return (
    <main class="screen screen-modal entry">
      <header class="entry-head">
        <button type="button" class="icon-btn" onClick={() => back('/')} aria-label="Close">
          <IconClose size={22} />
        </button>
        {s.mode === 'adjustment' ? (
          <div class="entry-title">Reconciliation</div>
        ) : (
          <Segmented
            value={s.mode}
            onChange={switchMode}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
              { value: 'transfer', label: 'Transfer' },
            ]}
          />
        )}
        {editing ? (
          <button type="button" class="icon-btn danger" onClick={remove} aria-label="Delete">
            <IconTrash size={21} />
          </button>
        ) : (
          <span class="icon-btn-spacer" />
        )}
      </header>

      <div class="amount-panel">
        {debtLine && <div class="debt-line">{debtLine}</div>}
        <div class="amount-expr">{showExpr ? prettyExpr(s.main) : ' '}</div>
        <button
          type="button"
          class={cx('amount-main', tone, needSecond && s.active === 'main' && 'active')}
          onClick={() => set({ active: 'main', fresh: false })}
        >
          {mainText}
        </button>
        {equivalent !== undefined && <div class="amount-eq">≈ {formatMoney(equivalent, shown)}</div>}
        {taxSplit && taxRule && (
          <div class="amount-tax">
            {taxRule.mode === 'net'
              ? `Before tax ${formatMoney(taxSplit.income, accCur)} · tax ${Math.round(taxRule.rate * 1000) / 10}% ${formatMoney(taxSplit.tax, accCur)}`
              : `Tax ${Math.round(taxRule.rate * 1000) / 10}% ${formatMoney(taxSplit.tax, accCur)} · arrives ${formatMoney(taxSplit.income - taxSplit.tax, accCur)}`}
          </div>
        )}
        {needSecond && (
          <button type="button" class={cx('amount-second', s.active === 'second' && 'active')} onClick={activateSecond}>
            <span class="amount-second-label">{isTransfer ? 'Arrives' : 'Charged to the account'}</span>
            <span class="amount-second-value">
              {s.active === 'second' && !s.fresh
                ? hasOperator(s.second)
                  ? prettyExpr(s.second)
                  : typedAmount(s.second, secondCur)
                : formatMoney(secondVal, secondCur, { exact: true })}
            </span>
            <span class="amount-second-rate">
              {xr !== undefined
                ? `${xr >= 1 ? rateLine(mainCur, secondCur, xr) : rateLine(secondCur, mainCur, 1 / xr)} · ${s.secondTouched ? 'by hand' : 'at the rate'}`
                : `no ${mainCur}/${secondCur} rate: enter it by hand`}
            </span>
          </button>
        )}
      </div>

      {isTransfer && (
        <div class="transfer-pair">
          <button type="button" class="chip chip-wide" onClick={() => setSheet('account')}>
            {account ? <AccountIcon account={account} size={20} /> : null}
            <span class="chip-text">{account ? account.name : 'From'}</span>
            <span class="chip-meta">{account ? symbolOf(account.currency) : ''}</span>
          </button>
          <IconArrowRight size={16} class="chip-arrow" />
          <button type="button" class={cx('chip chip-wide', !toAccount && 'chip-empty')} onClick={() => setSheet('toAccount')}>
            {toAccount ? <AccountIcon account={toAccount} size={20} /> : null}
            <span class="chip-text">{toAccount ? toAccount.name : 'To'}</span>
            <span class="chip-meta">{toAccount ? symbolOf(toAccount.currency) : ''}</span>
          </button>
        </div>
      )}
      <div class="chips">
        {!isTransfer && (
          <button type="button" class="chip" onClick={() => setSheet('account')}>
            {account ? <AccountIcon account={account} size={20} /> : null}
            <span class="chip-text">{account ? account.name : 'Account'}</span>
            <span class="chip-meta">{account ? symbolOf(account.currency) : ''}</span>
            <IconChevronDown size={14} />
          </button>
        )}
        <label class="chip chip-date">
          <IconCalendar size={16} />
          <span class="chip-text">{shortDay(s.date)}</span>
          <input
            type="date"
            class="chip-date-input"
            value={s.date}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              if (v) set({ date: v });
            }}
          />
        </label>
        {isFlow && (
          <button type="button" class={cx('chip', s.foreign && 'chip-on')} onClick={() => setSheet('currency')}>
            <IconCurrency size={16} />
            <span class="chip-text">{s.foreign ? `In ${s.foreign}` : 'Other currency'}</span>
          </button>
        )}
      </div>

      <div class="note-row">
        <input
          class="note-input"
          type="text"
          placeholder="Note"
          value={s.note}
          enterKeyHint="done"
          onInput={(e) => set({ note: (e.target as HTMLInputElement).value })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {s.mode !== 'adjustment' && (
          <button type="button" class={cx('note-tags', s.tags.length > 0 && 'on')} onClick={() => setSheet('tags')}>
            <IconTag size={16} />
            <span>{s.tags.length ? s.tags.map((t) => `#${t}`).join(' ') : 'Tags'}</span>
          </button>
        )}
      </div>

      {isFlow && (
        <div class="picker-grid" role="listbox" aria-label="Category">
          {flowCats.map((c) => (
            <button
              type="button"
              key={c.id}
              role="option"
              aria-selected={c.id === s.categoryId}
              class={cx('pick-tile', c.id === s.categoryId && 'selected', c.parent_id && 'child')}
              onClick={() => pickCategory(c.id)}
            >
              <CatIcon cat={c} size={40} />
              <span class="pick-tile-name">{c.name}</span>
            </button>
          ))}
          {!flowCats.length && <div class="picker-empty">No categories yet: add them in Settings</div>}
        </div>
      )}
      {isTransfer && (
        <div class="picker-grid" role="listbox" aria-label="To">
          {activeAccounts.value
            .filter((a) => a.id !== s.accountId && (a.id === s.toAccountId || !accountHidden(a)))
            .map((a) => (
              <button
                type="button"
                key={a.id}
                role="option"
                aria-selected={a.id === s.toAccountId}
                class={cx('pick-tile', a.id === s.toAccountId && 'selected')}
                onClick={() => pickToAccount(a)}
              >
                <AccountIcon account={a} size={40} />
                <span class="pick-tile-name">{a.name}</span>
              </button>
            ))}
        </div>
      )}
      {s.mode === 'adjustment' && (
        <div class="adj-info">
          <CatIcon cat={category} size={32} />
          <span>{category?.name ?? 'Reconciliation'} · the − key sets the sign, 0 means the balance matched</span>
        </div>
      )}

      <Keypad onKey={onKey} okDisabled={saving} />

      <AccountPickerSheet
        open={sheet === 'account'}
        title={isTransfer ? 'From' : 'Account'}
        selected={s.accountId}
        onPick={pickAccount}
        onClose={() => setSheet(null)}
      />
      <AccountPickerSheet
        open={sheet === 'toAccount'}
        title="To"
        selected={s.toAccountId}
        exclude={s.accountId}
        onPick={pickToAccount}
        onClose={() => setSheet(null)}
      />
      <TagSheet
        open={sheet === 'tags'}
        selected={s.tags}
        categoryId={s.categoryId}
        onChange={(tags) => set({ tags })}
        onClose={() => setSheet(null)}
      />
      <Sheet open={sheet === 'currency'} title="Purchase currency" onClose={() => setSheet(null)}>
        <Section footer="Enter the amount in the purchase currency; it converts to the account currency at the rate. You can correct the result.">
          <Row title={`Account currency (${accCur})`} checked={!s.foreign} onClick={() => pickCurrency(accCur)} />
          {CURRENCIES.filter((c) => c !== accCur).map((c) => {
            const x = crossRate(c, accCur, r);
            return (
              <Row
                key={c}
                title={`${c} · ${CURRENCY_NAMES[c] ?? c}`}
                subtitle={
                  hasRate(c, r) && x !== undefined
                    ? rateLine(c, accCur, x)
                    : 'no rate: you will enter the account amount by hand'
                }
                checked={s.foreign === c}
                onClick={() => pickCurrency(c)}
              />
            );
          })}
        </Section>
      </Sheet>
    </main>
  );
}

/** 'Alex will owe you $50' for a transfer to or from a person; the edited transaction is taken out first. */
function debtPreview(
  from: Account | undefined,
  to: Account | undefined,
  amount: number,
  toAmount: number,
  editing: Transaction | undefined,
): string | undefined {
  const person = isDebt(to) && !isDebt(from) ? to : isDebt(from) && !isDebt(to) ? from : undefined;
  if (!person) return undefined;
  let base = balances.value.get(person.id) ?? 0;
  if (editing && !editing.deleted) {
    if (editing.account_id === person.id) base -= editing.amount;
    if (editing.to_account_id === person.id && typeof editing.to_amount === 'number') base += -editing.to_amount;
  }
  const after = person === to ? base + toAmount : base - amount;
  const verb = person === to ? `Give to ${person.name}` : `Get from ${person.name}`;
  if (Math.abs(after) < 0.005) return `${verb} · settled after this`;
  const money = formatMoney(Math.abs(after), person.currency);
  return after > 0 ? `${verb} · they will owe you ${money}` : `${verb} · you will owe ${money}`;
}

function TagSheet({
  open,
  selected,
  categoryId,
  onChange,
  onClose,
}: {
  open: boolean;
  selected: string[];
  categoryId: string;
  onChange: (tags: string[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const { used, other } = suggestedTags(categoryId);
  // A tag picked that has never been used yet goes with this category.
  const fresh = selected.filter((t) => !used.includes(t) && !other.includes(t));
  const q = cleanTag(draft);
  const match = (list: string[]) => (q ? list.filter((t) => t.includes(q)) : list);
  const mine = match([...fresh, ...used]);
  const rest = match(other);
  const cat = categoriesById.value.get(categoryId);
  const toggle = (t: string) => onChange(selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t]);
  const add = () => {
    if (q && !selected.includes(q)) onChange([...selected, q]);
    setDraft('');
  };
  const cloud = (list: string[]) => (
    <div class="tag-cloud">
      {list.map((t) => (
        <button type="button" key={t} class={cx('tag-pill', selected.includes(t) && 'on')} onClick={() => toggle(t)}>
          #{t}
        </button>
      ))}
    </div>
  );
  return (
    <Sheet open={open} title="Tags" onClose={onClose}>
      <Section>
        <div class="tag-new">
          <input
            class="input"
            type="text"
            placeholder="Find or add a tag"
            value={draft}
            autocapitalize="off"
            enterKeyHint="done"
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button type="button" class="btn btn-tinted" disabled={!q} onClick={add}>
            Add
          </button>
        </div>
        {!mine.length && !rest.length && (
          <div class="tag-cloud">
            <span class="muted">{q ? `Add “${q}” as a new tag` : 'No tags yet'}</span>
          </div>
        )}
      </Section>
      {mine.length > 0 && <Section title={cat ? `Used with ${cat.name}` : 'Picked'}>{cloud(mine)}</Section>}
      {rest.length > 0 && (
        <Section
          title={mine.length || cat ? 'Other tags' : 'All tags'}
          footer="Tags work across categories: #bali on food, taxis and hotels shows what the trip cost."
        >
          {cloud(rest)}
        </Section>
      )}
    </Sheet>
  );
}
