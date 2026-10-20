// Expense category screen opened from its coin on the board, like the account screen: what it took in the board's
// period as a big number (against the budget), Add expense, name and monthly budget, then its transactions.
// "All settings" opens the full category editor.
import { useState } from 'preact/hooks';
import { categoriesById, currencyOf, liveTransactions, rates, saveCategory } from '../../data/store';
import type { NumOrEmpty, Transaction } from '../../domain/types';
import { monthsInRange, rangeLabel } from '../../domain/dates';
import { budgetTone, txUsd } from '../../domain/metrics';
import { isBudgeted } from '../../domain/scope';
import { CatIcon, Empty, Field, NavBar, NavButton, NumberInput, Row, Section, TextInput, Usd, cx, showToast } from '../components';
import { TxDays } from '../TxList';
import { IconPlus } from '../icons';
import { resolvePeriod } from '../period';
import { boardPeriod } from '../prefs';
import { back, navigate } from '../router';

export function ExpenseCategoryScreen({ id }: { id: string }) {
  const cat = categoriesById.value.get(id);
  const [name, setName] = useState(cat?.name ?? '');
  const [budget, setBudget] = useState<NumOrEmpty>(cat?.budget_usd ?? '');
  const [busy, setBusy] = useState(false);

  if (!cat) {
    return (
      <main class="screen screen-modal">
        <NavBar left={<NavButton onClick={() => back('/board')}>Back</NavButton>} title="Category" />
        <Empty title="Category not found" />
      </main>
    );
  }

  const inCat = (t: Transaction) => t.category_id === id || categoriesById.value.get(t.category_id)?.parent_id === id;
  const txs = liveTransactions.value.filter((t) => t.type === 'expense' && inCat(t));
  const { from, to } = resolvePeriod(boardPeriod.value);
  const spent = txs.filter((t) => t.date >= from && t.date <= to).reduce((s, t) => s - txUsd(t, rates.value, currencyOf), 0);
  const budgeted = isBudgeted(cat);
  const limit = budgeted && typeof cat.budget_usd === 'number' ? cat.budget_usd * monthsInRange(from, to).length : 0;
  const tone = budgetTone(spent, limit);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      showToast('Enter a name');
      return;
    }
    setBusy(true);
    try {
      if (trimmed !== cat!.name || budget !== cat!.budget_usd) {
        await saveCategory({ ...cat!, name: trimmed, budget_usd: budget });
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
        title={cat.name}
        right={
          <NavButton bold onClick={() => !busy && void save()}>
            Done
          </NavButton>
        }
      />

      <div class="acc-view-head cat-card-head">
        <CatIcon cat={cat} size={48} />
        <span class={cx('acc-view-balance', tone === 'over' && 'neg')}>
          <Usd value={spent} />
        </span>
        <span class="acc-view-sub">
          {rangeLabel(from, to)}
          {limit > 0 && (
            <>
              {' · '}
              {Math.round((spent / limit) * 100)}% of <Usd value={limit} whole />
            </>
          )}
          {!budgeted && ' · not in the budget'}
        </span>
      </div>
      <button
        type="button"
        class="btn btn-tinted acc-view-transfer"
        onClick={() => navigate(`/entry?type=expense&cat=${encodeURIComponent(id)}`)}
      >
        <IconPlus size={18} />
        Add expense
      </button>

      <Section>
        <Field label="Name">
          <TextInput value={name} onInput={setName} />
        </Field>
        {budgeted && (
          <Field label="Budget a month">
            <NumberInput value={budget} suffix="$" onChange={setBudget} placeholder="—" />
          </Field>
        )}
        <Row title="All settings" chevron onClick={() => navigate(`/categories/${encodeURIComponent(id)}`)} />
      </Section>

      <div class="acc-view-title">
        Transactions{txs.length ? ` · ${txs.length.toLocaleString('en-US')}` : ''}
      </div>
      <TxDays txs={txs} empty={<Empty title="No expenses yet" text="Drag an account onto this category on the board" />} />
    </main>
  );
}
