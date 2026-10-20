// Automations (Settings): rules the server runs every day to record transactions by itself
// (domain/automation.ts, apps-script/Automations.js):
// - interest: income on an account's balance at the rate on its card, daily or monthly on a day;
// - expense: a fixed amount off an account into a category, weekly, monthly on a day or yearly.
// Settings lists them (each rule's next run); the editor opens as a sheet like an account's: the next run as a big
// number on top, then the settings. "Paid to" is the account's own setting (interest_to): changing it here changes it there.
import { useState } from 'preact/hooks';
import { accountsById, automations, balances, categoriesById, categoryTree, saveAccount, saveAutomation } from '../../data/store';
import { shortId } from '../../data/ids';
import type { Account, Automation } from '../../domain/types';
import { dayOf, defaultStart, estimate, nextDue } from '../../domain/automation';
import { formatMoney } from '../../domain/money';
import { shortDay, today } from '../../domain/dates';
import { INC_INTEREST } from '../../domain/reconcile';
import {
  AccountIcon,
  Button,
  CatIcon,
  DateInput,
  Field,
  NavBar,
  NavButton,
  NumberInput,
  Row,
  Section,
  Segmented,
  Select,
  Switch,
  TextInput,
  cx,
  showToast,
} from '../components';
import { IconPlus } from '../icons';
import { AccountPickerSheet } from '../AccountPicker';
import { back, navigate } from '../router';

const pct = (v: number | '' | undefined) => (typeof v === 'number' ? `${Math.round(v * 10000) / 100}%` : '—');
const utc = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { ...o, timeZone: 'UTC' });

/** "Daily", "Weekly on Wednesdays", "Monthly on the 28th", "Yearly on Mar 5". */
function schedule(a: Pick<Automation, 'frequency' | 'day' | 'start_date'>): string {
  if (a.frequency === 'weekly') return a.start_date ? `Weekly on ${utc(a.start_date, { weekday: 'long' })}s` : 'Weekly';
  if (a.frequency === 'yearly') return a.start_date ? `Yearly on ${utc(a.start_date, { month: 'short', day: 'numeric' })}` : 'Yearly';
  if (a.frequency !== 'monthly') return 'Daily';
  const d = dayOf(a);
  const suffix = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th';
  return `Monthly on the ${d}${suffix}`;
}

const hasRate = (acc: Account | undefined) => typeof acc?.apr_gross === 'number' && acc.apr_gross > 0;

/** What the next run records: the interest estimate at today's balance, or the fixed expense. */
function nextAmount(a: Automation, acc: Account | undefined): number {
  if (a.kind === 'expense') return typeof a.amount === 'number' ? Math.abs(a.amount) : 0;
  return estimate(acc, balances.value.get(acc?.id ?? '') ?? 0, nextDue(a, today()).days);
}

function money(a: Automation, acc: Account | undefined): string {
  const v = formatMoney(nextAmount(a, acc), acc?.currency ?? 'USD', { exact: true });
  return a.kind === 'expense' ? `−${v}` : `≈ +${v}`;
}

/** The rules right in Settings: one row each (a tap opens the editor as a sheet), interest first, and Add. */
export function AutomationsSection() {
  const live = automations.value
    .filter((a) => !a.deleted)
    .sort((x, y) => (x.kind === y.kind ? x.name.localeCompare(y.name) : x.kind === 'interest' ? -1 : 1));
  return (
    <Section
      title="Automations"
      footer="The server runs them every morning and a minute after a change, for every due day since the start; the transactions come with the next sync, tagged #auto. Interest: balance at the start of the day × the rate on the account card × days ÷ 365. Deleting a recorded transaction doesn't bring it back."
    >
      {live.map((a) => {
        const acc = accountsById.value.get(a.account_id);
        const cat = categoriesById.value.get(a.category_id);
        const where = a.kind === 'expense' ? `${acc?.name ?? '?'} → ${cat?.name ?? '?'}` : `${pct(acc?.apr_gross)} a year`;
        const when = !a.active ? 'paused' : a.kind === 'interest' && !hasRate(acc) ? 'no rate on the account card' : `next ${shortDay(nextDue(a, today()).date)}`;
        return (
          <Row
            key={a.id}
            class={cx(!a.active && 'archived')}
            icon={a.kind === 'expense' ? <CatIcon cat={cat} size={32} /> : <AccountIcon account={acc} size={32} />}
            title={a.name || (a.kind === 'expense' ? cat?.name ?? 'Expense' : 'Interest')}
            subtitle={`${schedule(a)} · ${where} · ${when}`}
            value={a.active && (a.kind === 'expense' || hasRate(acc)) ? <span class={cx(a.kind === 'interest' && 'pos')}>{money(a, acc)}</span> : undefined}
            chevron
            onClick={() => navigate(`/automations/${encodeURIComponent(a.id)}`)}
          />
        );
      })}
      <Row
        icon={
          <span class="icon-tile" style={{ background: 'var(--accent)' }}>
            <IconPlus size={18} />
          </span>
        }
        title="Add automation"
        subtitle={live.length ? undefined : 'Interest on an account or a regular expense'}
        onClick={() => navigate('/automations/new')}
      />
    </Section>
  );
}

function blank(kind: Automation['kind']): Automation {
  const frequency = kind === 'expense' ? 'monthly' : 'daily';
  const day = Number(today().slice(8, 10));
  return {
    id: shortId('auto'),
    name: '',
    kind,
    account_id: '',
    frequency,
    day: kind === 'expense' ? day : '',
    category_id: '',
    amount: '',
    start_date: defaultStart(frequency, day, today()),
    last_run: '',
    active: true,
    note: '',
    deleted: false,
    created_at: '',
    updated_at: '',
    server_ts: '',
  };
}

export function AutomationEditScreen({ id }: { id: string }) {
  const isNew = id === 'new';
  const existing = isNew ? undefined : automations.value.find((a) => a.id === id);
  const [a, setA] = useState<Automation>(() => (existing ? { ...existing } : blank('interest')));
  const [named, setNamed] = useState(!!existing?.name);
  const [pick, setPick] = useState<null | 'account' | 'payout'>(null);
  // Where interest goes: the account's own setting, saved to the account with the rule.
  const [payTo, setPayTo] = useState(() => (existing ? accountsById.value.get(existing.account_id)?.interest_to ?? '' : ''));
  const set = <K extends keyof Automation>(k: K, v: Automation[K]) => setA((prev) => ({ ...prev, [k]: v }));

  if (!isNew && !existing) {
    return (
      <main class="screen screen-modal">
        <NavBar left={<NavButton onClick={() => back('/settings')}>Back</NavButton>} title="Automation" />
        <div class="empty">
          <div class="empty-title">Automation not found</div>
        </div>
      </main>
    );
  }

  const interest = a.kind === 'interest';
  const acc = accountsById.value.get(a.account_id);
  const payout = payTo ? accountsById.value.get(payTo) : undefined;
  const cat = categoriesById.value.get(a.category_id || (interest ? INC_INTEREST : ''));
  const next = nextDue(a, today());
  const defaultName = interest ? (acc ? `Interest · ${acc.name}` : '') : cat?.name ?? '';
  const frequencies: Automation['frequency'][] = interest ? ['daily', 'monthly'] : ['weekly', 'monthly', 'yearly'];
  const label: Record<Automation['frequency'], string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

  const setKind = (kind: Automation['kind']) => {
    setA({ ...blank(kind), id: a.id, account_id: a.account_id });
    setNamed(false);
  };
  const setFrequency = (f: Automation['frequency']) =>
    setA((prev) => {
      const day = f === 'monthly' ? (typeof prev.day === 'number' ? prev.day : Number(today().slice(8, 10))) : prev.day;
      return { ...prev, frequency: f, day, start_date: isNew ? defaultStart(f, typeof day === 'number' ? day : 1, today()) : prev.start_date };
    });
  const setDay = (v: number | '') =>
    setA((prev) => ({ ...prev, day: v, start_date: isNew && typeof v === 'number' ? defaultStart('monthly', v, today()) : prev.start_date }));

  async function save(patch: Partial<Automation> = {}) {
    const rec = { ...a, ...patch, name: a.name.trim() || defaultName || (interest ? 'Interest' : 'Expense') };
    if (!patch.deleted) {
      if (!rec.account_id) return showToast('Pick an account');
      if (rec.frequency === 'monthly' && !(typeof rec.day === 'number' && rec.day >= 1 && rec.day <= 31)) return showToast('Day of the month: 1–31');
      if (!interest && !(typeof rec.amount === 'number' && rec.amount > 0)) return showToast('Enter the amount');
      if (!interest && !rec.category_id) return showToast('Pick a category');
    }
    if (interest && acc && !patch.deleted && payTo !== (acc.interest_to ?? '')) await saveAccount({ ...acc, interest_to: payTo });
    await saveAutomation(rec);
    showToast(patch.deleted ? 'Deleted' : isNew ? 'Added' : 'Saved');
    back('/settings');
  }

  return (
    <main class="screen screen-modal account-view auto-view">
      <NavBar
        left={<NavButton onClick={() => back('/settings')}>Cancel</NavButton>}
        title={isNew ? 'New automation' : a.name || defaultName || 'Automation'}
        right={
          <NavButton bold onClick={() => void save()}>
            Done
          </NavButton>
        }
      />

      {isNew && (
        <div class="pad auto-kind">
          <Segmented
            value={a.kind}
            onChange={setKind}
            options={[
              { value: 'interest', label: 'Interest' },
              { value: 'expense', label: 'Expense' },
            ]}
          />
        </div>
      )}

      <div class="acc-view-head">
        {interest ? <AccountIcon account={acc} size={48} round /> : <CatIcon cat={cat} size={48} />}
        <span class="acc-view-balance">
          {acc && (!interest || hasRate(acc)) ? (
            <span class={cx(interest && 'pos')}>{money(a, acc)}</span>
          ) : (
            <span class="muted">{acc ? 'No rate' : interest ? 'Pick an account' : 'New expense'}</span>
          )}
        </span>
        <span class="acc-view-sub">
          {a.active ? `Next ${shortDay(next.date)}` : 'Paused'} · {schedule(a)}
          {interest && acc && hasRate(acc) && ` · ${pct(acc.apr_gross)} a year`}
        </span>
        {interest && acc && <span class="acc-view-sub">{a.frequency === 'monthly' ? `${next.days} days at today's balance` : "at today's balance"}</span>}
      </div>

      {interest ? (
        <Section footer="The rate comes from the account card. Paid to is the account's setting too: changing it here changes it there.">
          <Field label="Account">
            <button type="button" class="field-pick" onClick={() => setPick('account')}>
              {acc ? acc.name : 'Pick'}
            </button>
          </Field>
          <Field label="Paid to">
            <button type="button" class="field-pick" disabled={!acc} onClick={() => setPick('payout')}>
              {payout ? payout.name : 'This account'}
            </button>
          </Field>
          <Field label="Category">
            <Select
              value={a.category_id || INC_INTEREST}
              onChange={(v) => set('category_id', v === INC_INTEREST ? '' : v)}
              options={categoryTree('income').map((c) => ({ value: c.id, label: `${c.icon ? `${c.icon} ` : ''}${c.name}` }))}
            />
          </Field>
        </Section>
      ) : (
        <Section>
          <Field label="Amount">
            <NumberInput value={a.amount} suffix={acc?.currency ?? ''} onChange={(v) => set('amount', v)} placeholder="0" />
          </Field>
          <Field label="From">
            <button type="button" class="field-pick" onClick={() => setPick('account')}>
              {acc ? acc.name : 'Pick an account'}
            </button>
          </Field>
          <Field label="Category">
            <Select
              value={a.category_id}
              onChange={(v) => set('category_id', v)}
              options={[{ value: '', label: 'Pick' }, ...categoryTree('expense').map((c) => ({ value: c.id, label: `${c.icon ? `${c.icon} ` : ''}${c.name}` }))]}
            />
          </Field>
        </Section>
      )}

      <Section>
        <Field label="Name">
          <TextInput
            value={named ? a.name : a.name || defaultName}
            placeholder={interest ? 'Interest' : 'Netflix'}
            onInput={(v) => {
              setNamed(true);
              set('name', v);
            }}
          />
        </Field>
        <Field label="How often">
          <Segmented value={a.frequency} onChange={setFrequency} options={frequencies.map((f) => ({ value: f, label: label[f] }))} />
        </Field>
        {a.frequency === 'monthly' && (
          <Field label="Day of the month" hint="The last day in shorter months">
            <NumberInput value={a.day} onChange={setDay} placeholder="28" />
          </Field>
        )}
        <Field
          label={interest ? 'Starts' : 'First time'}
          hint={a.frequency === 'weekly' ? 'Sets the weekday' : a.frequency === 'yearly' ? 'Sets the date each year' : 'Due days before it are skipped'}
        >
          <DateInput value={a.start_date} onChange={(v) => set('start_date', v)} />
        </Field>
        <Field label="Active" hint={a.active ? 'The server runs it every day' : 'Paused: nothing is recorded'}>
          <Switch checked={a.active} onChange={(v) => set('active', v)} />
        </Field>
        {a.last_run && <Row title="Last recorded" value={shortDay(a.last_run)} />}
      </Section>

      {!isNew && (
        <div class="field-actions">
          <Button kind="danger" onClick={() => confirm('Delete this automation? What it recorded stays.') && void save({ deleted: true, active: false })}>
            Delete automation
          </Button>
        </div>
      )}

      <AccountPickerSheet
        open={pick !== null}
        title={pick === 'payout' ? 'Interest paid to' : interest ? 'Interest on' : 'Pay from'}
        selected={pick === 'payout' ? payTo || a.account_id : a.account_id}
        groups={['liquid', 'credit', 'investment', 'business']}
        footer={pick === 'payout' ? 'Pick the account itself to keep the interest in it.' : undefined}
        onPick={(picked) => {
          if (pick === 'payout') setPayTo(picked.id === a.account_id ? '' : picked.id);
          else {
            set('account_id', picked.id);
            setPayTo(picked.interest_to ?? '');
          }
          setPick(null);
        }}
        onClose={() => setPick(null)}
      />
    </main>
  );
}
