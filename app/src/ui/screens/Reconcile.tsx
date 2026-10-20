// Reconciliation: a single account (opened from the account card) and the monthly wizard.
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  accountsById,
  activeAccounts,
  automations,
  balances,
  categoriesById,
  liveTransactions,
  markMonthReconciled,
  rates,
  saveAccount,
  saveTransaction,
} from '../../data/store';
import type { Account } from '../../domain/types';
import { applyKey, decimals, evaluate, formatMoney, hasOperator, prettyExpr } from '../../domain/money';
import { adjustmentCategory, balanceEdit, buildAdjustment, hasCountedTransactions, interestRecorded, reconcileCandidates, reconcileDelta } from '../../domain/reconcile';
import { currentMonth, monthLabel, plural, today } from '../../domain/dates';
import { toUsd } from '../../domain/fx';
import { nowIso, uuid } from '../../data/ids';
import { AccountIcon, Button, CatIcon, Money, NavBar, NavButton, Row, Section, Usd, cx, showToast, shownCurrency } from '../components';
import { Keypad, type PadKey } from '../Keypad';
import { typedAmount } from './Entry';
import { back } from '../router';

interface StepResult {
  account: Account;
  delta: number | null;
}

function ReconcilePanel({
  account,
  onDone,
  onSkip,
}: {
  account: Account;
  /** opening: the account had no transactions yet, so the balance went into its opening balance. */
  onDone: (delta: number, kind: 'adjustment' | 'opening') => void;
  onSkip?: () => void;
}) {
  const calc = balances.value.get(account.id) ?? 0;
  const debt = account.group === 'credit';
  const [expr, setExpr] = useState('');
  const [busy, setBusy] = useState(false);
  const entered = evaluate(expr);
  const actual = entered == null ? null : debt ? -entered : entered;
  const delta = actual == null ? null : reconcileDelta(calc, actual, account.currency);
  const recorded = interestRecorded(account, automations.value);
  const catId = adjustmentCategory(account.type, recorded);
  const cat = categoriesById.value.get(catId);
  // Nothing recorded on the account yet: a different balance is its opening balance, not a correction.
  const fresh = !hasCountedTransactions(account, liveTransactions.value);

  async function commit(d: number) {
    if (busy) return;
    setBusy(true);
    try {
      const edit = balanceEdit(account, calc, calc + d, liveTransactions.value);
      if (edit.opening !== account.opening_balance) {
        await saveAccount({ ...account, opening_balance: edit.opening });
        onDone(d, 'opening');
        return;
      }
      // Always save a reconciliation, even when it matches: the sheet uses it to track the last reconciliation date.
      await saveTransaction(buildAdjustment(account, d, { id: uuid(), now: nowIso(), date: today(), rates: rates.value, interestRecorded: recorded }));
      onDone(d, 'adjustment');
    } finally {
      setBusy(false);
    }
  }

  function onKey(k: PadKey) {
    if (k === 'ok') {
      if (delta == null) showToast('Enter the actual balance');
      else void commit(delta);
      return;
    }
    setExpr((e) => applyKey(e, k, decimals(account.currency), true));
  }

  const shownCalc = debt ? -calc : calc;
  return (
    <div class="reconcile">
      <div class="reconcile-head">
        <AccountIcon account={account} size={44} />
        <div>
          <div class="reconcile-name">{account.name}</div>
          <div class="reconcile-sub">{[account.institution, account.currency].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <div class="reconcile-grid">
        <div class="reconcile-cell">
          <div class="reconcile-label">{debt ? 'Expected debt' : 'Expected balance'}</div>
          <div class="reconcile-calc">
            <Money value={shownCalc} currency={account.currency} exact />
          </div>
          {account.currency !== shownCurrency() && (
            <div class="reconcile-usd">
              <Usd value={toUsd(calc, account.currency, rates.value)} />
            </div>
          )}
        </div>
        <button type="button" class="reconcile-cell reconcile-same" disabled={busy} onClick={() => void commit(0)}>
          <span class="reconcile-same-mark">✓</span>
          Matches
        </button>
      </div>
      <div class="reconcile-label pad-x">{debt ? 'Actual debt' : 'Actual balance'}</div>
      <div class="reconcile-input">
        {expr ? (hasOperator(expr) ? `${prettyExpr(expr)} = ${formatMoney(entered ?? 0, account.currency, { exact: true })}` : typedAmount(expr, account.currency)) : <span class="muted">0</span>}
      </div>
      <div class={cx('reconcile-delta', delta != null && delta !== 0 && (delta > 0 ? 'pos' : 'neg'))}>
        {delta == null ? (
          ' '
        ) : delta === 0 ? (
          'Matches — saves a reconciliation with no balance change'
        ) : fresh ? (
          <>
            Difference <Money value={delta} currency={account.currency} signed exact /> → opening balance (no
            transactions yet)
          </>
        ) : (
          <>
            Difference <Money value={delta} currency={account.currency} signed exact /> → adjustment
            <span class="reconcile-cat">
              {catId ? (
                <>
                  <CatIcon cat={cat} size={20} /> {cat?.name ?? catId}
                </>
              ) : (
                'No category: a balance correction (interest is recorded on its own)'
              )}
            </span>
          </>
        )}
      </div>
      <div class="reconcile-actions">
        {onSkip && (
          <Button kind="plain" onClick={onSkip} disabled={busy}>
            Skip
          </Button>
        )}
      </div>
      <Keypad onKey={onKey} okLabel="Save" okDisabled={busy || delta == null} />
    </div>
  );
}

export function ReconcileAccountScreen({ id }: { id: string }) {
  const account = accountsById.value.get(id);
  if (!account) {
    return (
      <main class="screen screen-modal">
        <NavBar left={<NavButton onClick={() => back('/accounts')}>Back</NavButton>} title="Reconcile" />
        <div class="empty">
          <div class="empty-title">Account not found</div>
        </div>
      </main>
    );
  }
  return (
    <main class="screen screen-modal reconcile-screen">
      <NavBar left={<NavButton onClick={() => back(`/accounts/${id}`)}>Cancel</NavButton>} title="Reconcile balance" />
      <ReconcilePanel
        account={account}
        onDone={(d, kind) => {
          showToast(d === 0 ? 'Balance matches' : kind === 'opening' ? 'Opening balance set' : 'Reconciliation saved');
          back(`/accounts/${id}`);
        }}
      />
    </main>
  );
}

export function ReconcileWizardScreen() {
  const month = currentMonth();
  // Freeze the list at the start: adjustments must not reorder the steps.
  const steps = useMemo(() => reconcileCandidates(activeAccounts.value), []);
  const [i, setI] = useState(0);
  const [results, setResults] = useState<StepResult[]>([]);
  const done = i >= steps.length;

  useEffect(() => {
    if (done && steps.length > 0) void markMonthReconciled(month);
  }, [done, steps.length, month]);

  const next = (r: StepResult) => {
    setResults((prev) => [...prev, r]);
    setI((x) => x + 1);
  };

  if (steps.length === 0) {
    return (
      <main class="screen screen-modal">
        <NavBar left={<NavButton onClick={() => back('/')}>Close</NavButton>} title="Monthly reconciliation" />
        <div class="empty">
          <div class="empty-title">Nothing to reconcile</div>
          <div class="empty-text">The wizard goes through every account that isn't archived.</div>
        </div>
      </main>
    );
  }

  if (done) {
    const adjusted = results.filter((r) => r.delta != null && r.delta !== 0);
    const totalUsd = adjusted.reduce((s, r) => s + (toUsd(r.delta!, r.account.currency, rates.value) ?? 0), 0);
    return (
      <main class="screen screen-modal">
        <NavBar title="Monthly reconciliation" right={<NavButton bold onClick={() => back('/')}>Done</NavButton>} />
        <div class="wizard-done">
          <div class="wizard-done-icon">✓</div>
          <div class="wizard-done-title">{monthLabel(month)} reconciled</div>
          <div class="wizard-done-text">
            {adjusted.length
              ? `${adjusted.length} ${plural(adjusted.length, 'difference', 'differences')} totaling `
              : 'All balances matched'}
            {adjusted.length > 0 && <Usd value={totalUsd} signed />}
          </div>
        </div>
        <Section>
          {results.map((r) => (
            <Row
              key={r.account.id}
              icon={<AccountIcon account={r.account} size={30} />}
              title={r.account.name}
              value={
                r.delta == null ? (
                  <span class="muted">Skipped</span>
                ) : r.delta === 0 ? (
                  <span class="muted">Matched</span>
                ) : (
                  <Money value={r.delta} currency={r.account.currency} signed tone exact />
                )
              }
            />
          ))}
        </Section>
      </main>
    );
  }

  const account = steps[i];
  return (
    <main class="screen screen-modal reconcile-screen">
      <NavBar
        left={<NavButton onClick={() => back('/')}>Close</NavButton>}
        title={`Reconcile · ${i + 1} of ${steps.length}`}
      />
      <div class="wizard-progress">
        <div class="wizard-progress-bar" style={{ width: `${(i / steps.length) * 100}%` }} />
      </div>
      <ReconcilePanel
        key={account.id}
        account={account}
        onDone={(delta) => next({ account, delta })}
        onSkip={() => next({ account, delta: null })}
      />
    </main>
  );
}
