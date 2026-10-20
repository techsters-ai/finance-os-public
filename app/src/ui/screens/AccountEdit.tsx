import { useState } from 'preact/hooks';
import { accountsById, balances, rates, saveAccount } from '../../data/store';
import { shortId } from '../../data/ids';
import type { Account, AccountGroup, AccountType, AccountVisibility, NumOrEmpty, RiskKey } from '../../domain/types';
import { RISK_KEYS } from '../../domain/types';
import { CURRENCIES, CURRENCY_NAMES, formatMoney, roundMoney, roundTo } from '../../domain/money';
import { convert, toUsd } from '../../domain/fx';
import { AccountPickerSheet } from '../AccountPicker';
import { today } from '../../domain/dates';
import {
  Button,
  DateInput,
  Field,
  Money,
  NavBar,
  NavButton,
  NumberInput,
  Section,
  Segmented,
  Select,
  Switch,
  TextInput,
  Usd,
  cx,
  showToast,
  shownCurrency,
} from '../components';
import { back, navigate } from '../router';

export const GROUP_OPTIONS: { value: AccountGroup; label: string }[] = [
  { value: 'liquid', label: 'Liquid' },
  { value: 'investment', label: 'Investments' },
  { value: 'credit', label: 'Credit' },
  { value: 'business', label: 'Business' },
  { value: 'debt', label: 'Debts (people)' },
];

export const TYPE_OPTIONS: { value: AccountType; label: string }[] = [
  { value: 'card', label: 'Card' },
  { value: 'current', label: 'Current account' },
  { value: 'business', label: 'Business account' },
  { value: 'cash', label: 'Cash' },
  { value: 'flexible', label: 'Savings' },
  { value: 'deposit', label: 'Term deposit' },
  { value: 'bonds', label: 'Bonds / bond fund' },
  { value: 'stocks', label: 'Stocks / broker' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'commodity', label: 'Metal / commodity' },
  { value: 'credit', label: 'Credit' },
  { value: 'loan', label: 'Loan (a person)' },
];

const DEFAULT_GROUP: Record<AccountType, AccountGroup> = {
  card: 'liquid',
  current: 'liquid',
  business: 'business',
  cash: 'liquid',
  flexible: 'liquid',
  deposit: 'investment',
  bonds: 'investment',
  stocks: 'investment',
  crypto: 'investment',
  commodity: 'investment',
  credit: 'credit',
  loan: 'debt',
};

export const RISKS: Record<RiskKey, { title: string; hint: string }> = {
  risk_price: { title: 'Price', hint: 'How much the value of the asset swings' },
  risk_country: { title: 'Country', hint: 'Politics and sanctions where the money sits' },
  risk_legal: { title: 'Legal', hint: 'Property rights protection, risk of blocks and freezes' },
  risk_custody: { title: 'Custody', hint: 'Risk of losing access at the custodian: bank, broker, exchange, wallet' },
  risk_credit: { title: 'Credit', hint: 'Risk of the bank or counterparty going bust' },
  risk_currency: { title: 'Currency', hint: 'Risk of the account currency losing value against the dollar' },
  risk_liquidity: { title: 'Liquidity', hint: 'How much time and loss it takes to get the money out' },
};

const LEVEL = ['', 'minimal', 'low', 'below average', 'average', 'above average', 'high', 'maximum'];

const COLORS = ['#0A84FF', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2', '#FFD60A', '#64D2FF', '#5E5CE6', '#FF375F', '#AC8E68', '#8E8E93', '#26A17B'];

/**
 * "Hide with 0 balance": on = hidden from the board and lists while the balance is 0 (visibility auto), off = always
 * shown. Hiding an account for good is the separate Hide account action (visibility hide).
 */
export function HideAtZeroField({ value, onChange }: { value: AccountVisibility; onChange: (v: AccountVisibility) => void }) {
  const hint = value === 'hide' ? 'Hidden by hand right now' : value === 'show' ? 'Stays visible even at 0' : 'Out of the board and lists while empty';
  return (
    <Field label="Hide with 0 balance" hint={hint}>
      <Switch checked={value !== 'show'} onChange={(on) => onChange(on ? 'auto' : 'show')} />
    </Field>
  );
}

/**
 * "Automatic tax": the bank withholds the tax (domain/tax.ts). On = each income here, and interest this deposit pays
 * out elsewhere, gets a Taxes expense at the account's tax rate; the second control says whether the amount typed
 * is what arrived (after tax) or the income before tax.
 */
export function AutoTaxField({ value, rate, onChange }: { value: Account['auto_tax']; rate: NumOrEmpty; onChange: (v: Account['auto_tax']) => void }) {
  const pct = typeof rate === 'number' && rate > 0 ? `${Math.round(rate * 1000) / 10}%` : '';
  return (
    <>
      <Field
        label="Automatic tax"
        hint={!pct ? 'Set the tax rate first' : value ? `${pct} of each income goes to Taxes` : 'The bank withholds the tax'}
      >
        <Switch checked={!!value} onChange={(on) => onChange(on ? 'net' : '')} />
      </Field>
      {value && (
        <Field label="I enter the amount">
          <Segmented
            value={value}
            onChange={onChange}
            options={[
              { value: 'net', label: 'After tax' },
              { value: 'gross', label: 'Before tax' },
            ]}
          />
        </Field>
      )}
    </>
  );
}

/** Settling a debt: the whole balance goes back, person → account or account → person. */
function settleEntry(person: Account, balance: number, account: Account): string {
  const owed = Math.abs(balance);
  const enc = encodeURIComponent;
  if (balance > 0) return `/entry?type=transfer&account=${enc(person.id)}&to=${enc(account.id)}&amount=${owed}`;
  const amount = convert(owed, person.currency, account.currency, rates.value) ?? owed;
  return `/entry?type=transfer&account=${enc(account.id)}&to=${enc(person.id)}&amount=${roundMoney(amount, account.currency)}`;
}

function blankAccount(group: AccountGroup = 'liquid'): Account {
  return {
    id: shortId(group === 'debt' ? 'debt' : 'acc'),
    name: '',
    group,
    type: group === 'debt' ? 'loan' : group === 'business' ? 'business' : 'card',
    currency: 'USD',
    institution: '',
    country: '',
    kyc_country: '',
    opening_balance: 0,
    opening_date: today(),
    apr_gross: '',
    tax_rate: '',
    maturity_date: '',
    insured_limit: '',
    risk_price: '',
    risk_country: '',
    risk_legal: '',
    risk_custody: '',
    risk_credit: '',
    risk_currency: '',
    risk_liquidity: '',
    in_emergency_fund: false,
    archived: false,
    visibility: 'auto',
    interest_to: '',
    auto_tax: '',
    sort: 100,
    color: COLORS[0],
    note: '',
    updated_at: '',
    server_ts: '',
  };
}

/** Fraction ↔ percent for the APR and tax fields. */
function toPct(v: number | ''): number | '' {
  return v === '' ? '' : roundTo(v * 100, 4);
}
function fromPct(v: number | ''): number | '' {
  return v === '' ? '' : roundTo(v / 100, 6);
}

function RiskSlider({ k, value, onChange }: { k: RiskKey; value: number | ''; onChange: (v: number | '') => void }) {
  const meta = RISKS[k];
  const set = value !== '';
  return (
    <div class="risk">
      <div class="risk-head">
        <span class="risk-title">{meta.title}</span>
        <span class={cx('risk-value', set && `risk-${value}`)}>
          {set ? `${value} · ${LEVEL[value as number]}` : 'not set'}
        </span>
        {set && (
          <button type="button" class="clear-btn" onClick={() => onChange('')} aria-label="Reset">
            ×
          </button>
        )}
      </div>
      <div class="risk-hint">{meta.hint}</div>
      <input
        type="range"
        min={1}
        max={7}
        step={1}
        class={cx('slider', !set && 'unset')}
        value={set ? value : 4}
        onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
        onClick={(e) => !set && onChange(Number((e.target as HTMLInputElement).value))}
      />
      <div class="risk-scale">
        <span>1 · low</span>
        <span>7 · high</span>
      </div>
    </div>
  );
}

export function AccountEditScreen({ id, group }: { id: string; group?: string }) {
  const isNew = id === 'new';
  const existing = isNew ? undefined : accountsById.value.get(id);
  const initialGroup = GROUP_OPTIONS.find((g) => g.value === group)?.value;
  const [a, setA] = useState<Account>(() => (existing ? { ...existing } : blankAccount(initialGroup)));
  const set = <K extends keyof Account>(k: K, v: Account[K]) => setA((prev) => ({ ...prev, [k]: v }));
  const [settle, setSettle] = useState(false);
  const [transferTo, setTransferTo] = useState(false);
  const [payoutPick, setPayoutPick] = useState(false);

  if (!isNew && !existing) {
    return (
      <main class="screen screen-modal">
        <NavBar left={<NavButton onClick={() => back('/accounts')}>Back</NavButton>} title="Account" />
        <div class="empty">
          <div class="empty-title">Account not found</div>
        </div>
      </main>
    );
  }

  const bal = existing ? balances.value.get(existing.id) ?? 0 : 0;
  const yieldy = ['flexible', 'deposit', 'bonds', 'stocks', 'crypto', 'commodity'].includes(a.type) || a.apr_gross !== '';
  // A debt account is a person: only name, currency, opening balance, due date and a note matter.
  const loan = a.group === 'debt' || a.type === 'loan';

  async function save(patch: Partial<Account> = {}) {
    const rec = { ...a, ...patch, name: a.name.trim() };
    if (!rec.name) {
      showToast('Enter a name');
      return false;
    }
    if (!rec.currency) {
      showToast('Pick a currency');
      return false;
    }
    await saveAccount(rec);
    return true;
  }

  return (
    <main class="screen screen-modal form-screen">
      <NavBar
        left={<NavButton onClick={() => back('/accounts')}>Cancel</NavButton>}
        title={loan ? (isNew ? 'New person' : 'Debt') : isNew ? 'New account' : 'Account'}
        right={
          <NavButton
            bold
            onClick={async () => {
              if (await save()) {
                showToast(isNew ? 'Account added' : 'Saved');
                back('/accounts');
              }
            }}
          >
            Done
          </NavButton>
        }
      />

      {existing && (
        <div class="balance-head">
          <div class="balance-head-label">Balance</div>
          <div class="balance-head-value">
            <Money value={bal} currency={existing.currency} />
          </div>
          {existing.currency !== shownCurrency() && (
            <div class="balance-head-sub">
              <Usd value={toUsd(bal, existing.currency, rates.value)} />
            </div>
          )}
          {loan && <div class="balance-head-sub">{bal > 0 ? `${existing.name} owes you` : bal < 0 ? `You owe ${existing.name}` : 'Settled'}</div>}
          <div class="balance-head-actions">
            {loan && bal !== 0 && (
              <Button kind="tinted" onClick={() => setSettle(true)}>
                {bal > 0 ? 'Get repaid' : 'Repay'}
              </Button>
            )}
            <Button kind={loan && bal !== 0 ? 'plain' : 'tinted'} onClick={() => navigate(`/accounts/${existing.id}/reconcile`)}>
              Reconcile balance
            </Button>
            {!loan && (
              <Button kind="plain" onClick={() => setTransferTo(true)}>
                Transfer
              </Button>
            )}
            <Button kind="plain" onClick={() => navigate(`/history?account=${existing.id}`)}>
              Transactions
            </Button>
          </div>
        </div>
      )}

      <Section title="General">
        <Field label="Name">
          <TextInput value={a.name} onInput={(v) => set('name', v)} placeholder={loan ? 'Alex' : 'Everyday Card'} />
        </Field>
        <Field label="Type">
          <Select
            value={a.type}
            options={TYPE_OPTIONS}
            onChange={(v) => setA((p) => ({ ...p, type: v, group: isNew && !initialGroup ? DEFAULT_GROUP[v] : p.group }))}
          />
        </Field>
        <Field label="Group">
          <Select value={a.group} options={GROUP_OPTIONS} onChange={(v) => set('group', v)} />
        </Field>
        <Field label="Currency">
          <Select
            value={a.currency}
            options={[
              ...CURRENCIES.map((c) => ({ value: c, label: `${c} · ${CURRENCY_NAMES[c]}` })),
              ...(CURRENCIES.includes(a.currency as never) ? [] : [{ value: a.currency, label: a.currency }]),
            ]}
            onChange={(v) => set('currency', v)}
          />
        </Field>
        <div class="field field-stacked">
          <span class="field-label">Color</span>
          <div class="swatches">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                class={cx('swatch', a.color.toLowerCase() === c.toLowerCase() && 'on')}
                style={{ background: c }}
                aria-label={c}
                onClick={() => set('color', c)}
              />
            ))}
          </div>
        </div>
      </Section>

      <Section
        title="Opening balance"
        footer={
          loan
            ? 'Positive: they owe you. Negative: you owe them (the ± button). Then lend and borrow on the board: drag an account onto Debts to give money, Debts onto an account to get it.'
            : 'Balance = opening + transactions from the opening date on; older ones are history only. Credit card debt goes with a minus (the ± button).'
        }
      >
        <Field label="Amount">
          <NumberInput
            value={a.opening_balance}
            allowNegative
            suffix={a.currency}
            onChange={(v) => set('opening_balance', v === '' ? 0 : v)}
          />
        </Field>
        <Field label="Opening date">
          <DateInput value={a.opening_date} onChange={(v) => set('opening_date', v)} />
        </Field>
      </Section>

      {loan ? (
        <Section title="Due" footer="Shows up in the spreadsheet alerts as the date gets close.">
          <Field label="Due date">
            <DateInput value={a.maturity_date} allowEmpty onChange={(v) => set('maturity_date', v)} />
          </Field>
        </Section>
      ) : (
        <>
          <Section title="Where the money is">
            <Field label="Bank / broker">
              <TextInput value={a.institution} onInput={(v) => set('institution', v)} placeholder="My Bank" />
            </Field>
            <Field label="Country">
              <TextInput value={a.country} onInput={(v) => set('country', v.toUpperCase())} placeholder="US" />
            </Field>
            <Field label="KYC country">
              <TextInput value={a.kyc_country} onInput={(v) => set('kyc_country', v.toUpperCase())} placeholder="GE" />
            </Field>
          </Section>

          <Section title="Yield" footer={yieldy ? undefined : 'Usually not needed for cards and cash.'}>
            <Field label="Rate, % per year">
              <NumberInput value={toPct(a.apr_gross)} suffix="%" onChange={(v) => set('apr_gross', fromPct(v))} placeholder="13.5" />
            </Field>
            <Field label="Tax on income, %">
              <NumberInput value={toPct(a.tax_rate)} suffix="%" onChange={(v) => set('tax_rate', fromPct(v))} placeholder="13" />
            </Field>
            <AutoTaxField value={a.auto_tax} rate={a.tax_rate} onChange={(v) => set('auto_tax', v)} />
            <Field label="Maturity date">
              <DateInput value={a.maturity_date} allowEmpty onChange={(v) => set('maturity_date', v)} />
            </Field>
            {(['deposit', 'flexible', 'bonds'].includes(a.type) || a.interest_to) && (
              <Field label="Interest paid to" hint="Interest income booked there counts as this deposit's">
                <button type="button" class="field-pick" onClick={() => setPayoutPick(true)}>
                  {a.interest_to ? accountsById.value.get(a.interest_to)?.name ?? a.interest_to : 'This account'}
                </button>
                {a.interest_to && (
                  <button type="button" class="field-clear" aria-label="Into this account" onClick={() => set('interest_to', '')}>
                    ×
                  </button>
                )}
              </Field>
            )}
            <Field label="Insured limit">
              <NumberInput value={a.insured_limit} suffix={a.currency} onChange={(v) => set('insured_limit', v)} placeholder="—" />
            </Field>
          </Section>

          <Section title="Risks" footer="1 is the lowest risk, 7 the highest. Used by the spreadsheet dashboard.">
            {RISK_KEYS.map((k) => (
              <RiskSlider key={k} k={k} value={a[k]} onChange={(v) => set(k, v)} />
            ))}
          </Section>
        </>
      )}

      <Section>
        {!loan && (
          <Field label="Emergency fund" hint="Counts toward the emergency fund">
            <Switch checked={a.in_emergency_fund} onChange={(v) => set('in_emergency_fund', v)} />
          </Field>
        )}
        <HideAtZeroField value={a.visibility} onChange={(v) => set('visibility', v)} />
        <Field label="Sort order">
          <NumberInput value={a.sort} onChange={(v) => set('sort', v === '' ? 0 : v)} />
        </Field>
        <div class="field field-stacked">
          <span class="field-label">Note</span>
          <textarea
            class="input textarea"
            rows={2}
            value={a.note}
            onInput={(e) => set('note', (e.target as HTMLTextAreaElement).value)}
          />
        </div>
      </Section>

      {existing && (
        <Section>
          <button
            type="button"
            class="row row-tap row-action"
            onClick={async () => {
              const visibility = a.visibility === 'hide' ? 'auto' : 'hide';
              set('visibility', visibility);
              if (await save({ visibility })) {
                showToast(visibility === 'hide' ? 'Hidden from every screen' : 'Shown again');
                back('/accounts');
              }
            }}
          >
            {a.visibility === 'hide' ? 'Show account' : 'Hide account'}
          </button>
          <button
            type="button"
            class={cx('row', 'row-tap', 'row-action', !a.archived && 'danger')}
            onClick={async () => {
              const archived = !a.archived;
              if (archived && bal !== 0 && !confirm('The account has a non-zero balance. Archive anyway?')) return;
              set('archived', archived);
              if (await save({ archived })) {
                showToast(archived ? 'Account archived' : 'Account restored');
                back('/accounts');
              }
            }}
          >
            {a.archived ? 'Restore from archive' : 'Archive account'}
          </button>
        </Section>
      )}
      <div class="form-foot">{existing ? `id: ${existing.id}` : ''}</div>

      {existing && !loan && (
        <AccountPickerSheet
          open={transferTo}
          title={`From ${existing.name} to`}
          exclude={existing.id}
          groups={['liquid', 'credit', 'business', 'investment']}
          onPick={(to) => {
            setTransferTo(false);
            navigate(`/entry?type=transfer&account=${encodeURIComponent(existing.id)}&to=${encodeURIComponent(to.id)}`);
          }}
          onClose={() => setTransferTo(false)}
        />
      )}
      <AccountPickerSheet
        open={payoutPick}
        title="Interest paid to"
        selected={a.interest_to}
        exclude={existing?.id}
        groups={['liquid', 'credit', 'business', 'investment']}
        footer="Record the interest there as Interest income, in that account's currency."
        onPick={(to) => {
          setPayoutPick(false);
          set('interest_to', to.id);
        }}
        onClose={() => setPayoutPick(false)}
      />
      {existing && loan && (
        <AccountPickerSheet
          open={settle}
          title={bal > 0 ? 'Get repaid to' : 'Repay from'}
          groups={['liquid', 'credit', 'business', 'investment']}
          footer={`The whole ${formatMoney(Math.abs(bal), existing.currency)} is filled in; change it for a partial return.`}
          onPick={(acc) => {
            setSettle(false);
            navigate(settleEntry(existing, bal, acc));
          }}
          onClose={() => setSettle(false)}
        />
      )}
    </main>
  );
}
