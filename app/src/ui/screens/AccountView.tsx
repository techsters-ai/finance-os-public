// Account screen opened from the board: the balance as a big number (tap it to type the actual
// balance on a keypad, like a reconciliation), name and visibility, the account's transactions below.
// "All settings" opens the full account editor.
import { useState } from 'preact/hooks';
import { accountsById, balances, liveTransactions, rates, saveAccount } from '../../data/store';
import type { Account, AccountVisibility } from '../../domain/types';
import { toUsd } from '../../domain/fx';
import { debtStatus, isDebt } from '../../domain/debts';
import { AccountIcon, Empty, Field, Money, NavBar, NavButton, Row, Section, TextInput, Usd, showToast, shownCurrency } from '../components';
import { TxDays } from '../TxList';
import { IconArrowRight } from '../icons';
import { AccountPickerSheet } from '../AccountPicker';
import { back, navigate } from '../router';
import { AutoTaxField, HideAtZeroField } from './AccountEdit';

export function AccountViewScreen({ id }: { id: string }) {
  const acc = accountsById.value.get(id);
  const bal = balances.value.get(id) ?? 0;
  const [name, setName] = useState(acc?.name ?? '');
  const [visibility, setVisibility] = useState<AccountVisibility>(acc?.visibility ?? 'auto');
  const [autoTax, setAutoTax] = useState<Account['auto_tax']>(acc?.auto_tax ?? '');
  const [busy, setBusy] = useState(false);
  const [transfer, setTransfer] = useState(false);

  if (!acc) {
    return (
      <main class="screen screen-modal">
        <NavBar left={<NavButton onClick={() => back('/board')}>Back</NavButton>} title="Account" />
        <Empty title="Account not found" />
      </main>
    );
  }

  const txs = liveTransactions.value.filter((t) => t.account_id === id || t.to_account_id === id);
  const credit = acc.group === 'credit';

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      showToast('Enter a name');
      return;
    }
    setBusy(true);
    try {
      if (trimmed !== acc!.name || visibility !== acc!.visibility || autoTax !== acc!.auto_tax) {
        await saveAccount({ ...acc!, name: trimmed, visibility, auto_tax: autoTax });
        showToast('Saved');
      }
      back('/board');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="screen screen-modal account-view">
      <NavBar
        left={<NavButton onClick={() => back('/board')}>Cancel</NavButton>}
        title={acc.name}
        right={
          <NavButton bold onClick={() => !busy && void save()}>
            Done
          </NavButton>
        }
      />

      <button
        type="button"
        class="acc-view-head"
        aria-label="Change the balance"
        onClick={() => navigate(`/accounts/${encodeURIComponent(id)}/reconcile`)}
      >
        <AccountIcon account={acc} size={48} round />
        <span class="acc-view-balance">
          <Money value={credit ? -bal : bal} currency={acc.currency} class={bal < 0 && !credit ? 'neg' : undefined} />
        </span>
        <span class="acc-view-sub">
          {isDebt(acc) ? debtStatus(bal) : credit ? 'debt on the card' : [acc.institution, acc.currency].filter(Boolean).join(' · ')}
          {acc.currency !== shownCurrency() && (
            <>
              {' · '}
              <Usd value={toUsd(bal, acc.currency, rates.value)} />
            </>
          )}
        </span>
        <span class="acc-view-edit">Tap to change the balance</span>
      </button>
      {!isDebt(acc) && (
        <button type="button" class="btn btn-tinted acc-view-transfer" onClick={() => setTransfer(true)}>
          <IconArrowRight size={18} />
          Transfer to another account
        </button>
      )}

      <Section>
        <Field label="Name">
          <TextInput value={name} onInput={setName} />
        </Field>
        {!isDebt(acc) && (
          <HideAtZeroField value={visibility} onChange={setVisibility} />
        )}
        {(acc.auto_tax || (typeof acc.tax_rate === 'number' && acc.tax_rate > 0)) && (
          <AutoTaxField value={autoTax} rate={acc.tax_rate} onChange={setAutoTax} />
        )}
        <Row title="All settings" chevron onClick={() => navigate(`/accounts/${encodeURIComponent(id)}`)} />
      </Section>

      <AccountPickerSheet
        open={transfer}
        title={`From ${acc.name} to`}
        exclude={id}
        groups={['liquid', 'credit', 'business', 'investment']}
        onPick={(to) => {
          setTransfer(false);
          navigate(`/entry?type=transfer&account=${encodeURIComponent(id)}&to=${encodeURIComponent(to.id)}`);
        }}
        onClose={() => setTransfer(false)}
      />

      <div class="acc-view-title">
        Transactions{txs.length ? ` · ${txs.length.toLocaleString('en-US')}` : ''}
      </div>
      <TxDays txs={txs} empty={<Empty title="No transactions yet" text="Drag this account onto a category on the board" />} />
    </main>
  );
}
