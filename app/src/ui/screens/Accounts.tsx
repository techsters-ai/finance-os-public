import { useState } from 'preact/hooks';
import { accountHidden, balances, capital, rates, reconciledMonths, saveAccount, sortedAccounts } from '../../data/store';
import type { Account, AccountGroup } from '../../domain/types';
import { toUsd } from '../../domain/fx';
import { reconcileReminderDue } from '../../domain/reconcile';
import { shortDay, today } from '../../domain/dates';
import { debtStatus, isDebt } from '../../domain/debts';
import { ACCOUNT_SECTIONS, moveTo, reorderSorts } from '../../domain/order';
import { AccountIcon, LargeTitle, Money, NavButton, Row, Section, Usd, cx, shownCurrency, useScrollMemory } from '../components';
import { IconPlus, IconScale } from '../icons';
import { showArchived, showHidden, toggleShowArchived, toggleShowHidden } from '../prefs';
import { navigate } from '../router';
import { useListReorder } from '../useListReorder';

export const GROUP_TITLE: Record<AccountGroup, string> = {
  liquid: 'Liquid',
  credit: 'Credit',
  debt: 'Debts',
  business: 'Business',
  investment: 'Investments',
};

/** The sections in the board's order (credit cards with Liquid); debts come last: people, not places money sits. */
const SECTION_TITLE: Record<string, string> = { liquid: 'Liquid', investment: 'Investments', business: 'Business', debt: 'Debts' };

const TYPE_LABEL: Record<string, string> = {
  card: 'card',
  current: 'current account',
  business: 'business account',
  cash: 'cash',
  flexible: 'savings',
  deposit: 'deposit',
  bonds: 'bonds',
  stocks: 'stocks',
  crypto: 'crypto',
  commodity: 'metal',
  credit: 'credit',
  loan: 'loan',
};

/** Short type names: the board labels account coins with them (the logo and currency say the rest). */
export const TYPE_TITLE: Record<string, string> = {
  card: 'Card',
  current: 'Current account',
  business: 'Business account',
  cash: 'Cash',
  flexible: 'Savings',
  deposit: 'Deposit',
  bonds: 'Bonds',
  stocks: 'Stocks',
  crypto: 'Crypto',
  commodity: 'Metal',
  credit: 'Credit card',
  loan: 'Loan',
};

export function accountSubtitle(a: Account): string {
  if (isDebt(a)) {
    const bal = balances.value.get(a.id) ?? 0;
    return [debtStatus(bal), a.maturity_date && `due ${shortDay(a.maturity_date)}`].filter(Boolean).join(' · ');
  }
  return [a.institution, TYPE_LABEL[a.type] ?? a.type].filter(Boolean).join(' · ');
}

export function AccountsScreen() {
  const root = useScrollMemory<HTMLElement>('accounts');
  const all = sortedAccounts.value;
  const archivedCount = all.filter((a) => a.archived).length;
  const hiddenCount = all.filter((a) => !a.archived && accountHidden(a)).length;
  const visible = all.filter((a) => (a.archived ? showArchived.value : showHidden.value || !accountHidden(a)));
  const reminder = reconcileReminderDue(today(), reconciledMonths.value);
  const shown = shownCurrency();
  // A dropped row shows in its new place at once; the saved sort values catch up a moment later.
  const [moved, setMoved] = useState<{ section: string; ids: string[] } | null>(null);
  const sectionList = (id: string) => {
    const groups = ACCOUNT_SECTIONS.find((s) => s.id === id)?.groups ?? [];
    const list = visible.filter((a) => groups.includes(a.group));
    if (moved?.section !== id) return list;
    const at = new Map(moved.ids.map((x, i) => [x, i]));
    return [...list].sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
  };
  useListReorder(root, (section, srcId, targetId) => {
    const list = sectionList(section);
    setMoved({ section, ids: moveTo(list, srcId, targetId).map((a) => a.id) });
    void Promise.all(reorderSorts(list, srcId, targetId).map(saveAccount)).finally(() => setMoved(null));
  });
  return (
    <main class="screen" ref={root}>
      <LargeTitle
        right={
          <NavButton onClick={() => navigate('/accounts/new')} label="Add account">
            <IconPlus size={24} />
          </NavButton>
        }
      >
        Accounts
      </LargeTitle>

      <Section>
        <Row
          icon={<span class="icon-tile" style={{ background: 'var(--accent)' }}><IconScale size={18} /></span>}
          title="Monthly reconciliation"
          subtitle={reminder ? "Time to check this month's balances" : 'All accounts: investments, liquid, credit, business'}
          value={reminder ? <span class="badge">!</span> : undefined}
          chevron
          onClick={() => navigate('/reconcile')}
        />
      </Section>

      {ACCOUNT_SECTIONS.map((s) => {
        const list = sectionList(s.id);
        if (!list.length) return null;
        const total = s.groups.reduce((sum, g) => sum + capital.value.byGroup[g], 0);
        return (
          <Section key={s.id} title={SECTION_TITLE[s.id]} right={<Usd value={total} whole />}>
            {list.map((a) => {
              const bal = balances.value.get(a.id) ?? 0;
              const hidden = !a.archived && accountHidden(a);
              const tags = [a.archived && 'archived', hidden && 'hidden'].filter(Boolean).join(' · ');
              return (
                <Row
                  key={a.id}
                  class={cx((a.archived || hidden) && 'archived')}
                  icon={<AccountIcon account={a} size={34} />}
                  title={a.name}
                  subtitle={`${accountSubtitle(a)}${tags ? ` · ${tags}` : ''}`}
                  value={<Money value={bal} currency={a.currency} tone={isDebt(a)} />}
                  valueSub={a.currency !== shown ? <Usd value={toUsd(bal, a.currency, rates.value)} /> : undefined}
                  chevron
                  data={{ 'reorder-id': a.id, 'reorder-section': s.id }}
                  onClick={() => navigate(`/accounts/${a.id}`)}
                />
              );
            })}
          </Section>
        );
      })}

      {(hiddenCount > 0 || archivedCount > 0) && (
        <div class="more more-row">
          {hiddenCount > 0 && (
            <button type="button" class="btn btn-plain" onClick={toggleShowHidden}>
              {showHidden.value ? `Hide hidden (${hiddenCount})` : `Show hidden (${hiddenCount})`}
            </button>
          )}
          {archivedCount > 0 && (
            <button type="button" class="btn btn-plain" onClick={toggleShowArchived}>
              {showArchived.value ? 'Hide archived' : `Show archived (${archivedCount})`}
            </button>
          )}
        </div>
      )}
    </main>
  );
}
