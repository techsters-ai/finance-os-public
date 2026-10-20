import {
  accountsById,
  activeAccounts,
  categoriesById,
  categoryTree,
  currencyOf,
  liveTransactions,
  rates,
  sortedAccounts,
  tagStats,
} from '../../data/store';
import { hasTag } from '../../domain/tags';
import { monthLabel, currentMonth } from '../../domain/dates';
import { monthTotals } from '../../domain/metrics';
import { Empty, LargeTitle, Usd, cx, useScrollMemory } from '../components';
import { TxDays } from '../TxList';
import { navigate } from '../router';

export function HistoryScreen({ query }: { query: URLSearchParams }) {
  const account = query.get('account') ?? '';
  const category = query.get('category') ?? '';
  const month = query.get('month') ?? '';
  const tag = query.get('tag') ?? '';
  const root = useScrollMemory<HTMLElement>(`history?${query.toString()}`);

  const setFilter = (key: string, value: string) => {
    const q = new URLSearchParams(query);
    if (value) q.set(key, value);
    else q.delete(key);
    const s = q.toString();
    navigate(`/history${s ? `?${s}` : ''}`, { replace: true });
  };

  const all = liveTransactions.value;
  const months = new Set<string>([currentMonth()]);
  const used = new Set<string>();
  for (const t of all) {
    if (t.date) months.add(t.date.slice(0, 7));
    used.add(t.account_id);
    if (t.to_account_id) used.add(t.to_account_id);
  }
  const monthList = [...months].sort().reverse();
  // Archived accounts (e.g. closed ones from an imported history) stay filterable while they have transactions.
  const accountOptions = [
    ...activeAccounts.value.map((a) => ({ value: a.id, label: a.name })),
    ...sortedAccounts.value
      .filter((a) => a.archived && used.has(a.id))
      .map((a) => ({ value: a.id, label: `${a.name} (archived)` })),
  ];

  const filtered = all.filter(
    (t) =>
      (!account || t.account_id === account || t.to_account_id === account) &&
      (!category || t.category_id === category || categoriesById.value.get(t.category_id)?.parent_id === category) &&
      (!month || t.date.startsWith(month)) &&
      (!tag || hasTag(t.tags, tag)),
  );
  const totals = month ? monthTotals(filtered, month, rates.value, currencyOf) : null;
  const cats = [...categoryTree('expense'), ...categoryTree('income'), ...categoryTree('system')];

  return (
    <main class="screen" ref={root}>
      <LargeTitle>History</LargeTitle>
      <div class="filters">
        <FilterSelect
          value={account}
          onChange={(v) => setFilter('account', v)}
          placeholder="All accounts"
          options={accountOptions}
          extra={account && !accountOptions.some((o) => o.value === account) ? accountsById.value.get(account)?.name : undefined}
        />
        <FilterSelect
          value={category}
          onChange={(v) => setFilter('category', v)}
          placeholder="All categories"
          options={cats.map((c) => ({ value: c.id, label: `${c.icon ? `${c.icon} ` : ''}${c.parent_id ? '  ' : ''}${c.name}` }))}
        />
        {tagStats.value.length > 0 && (
          <FilterSelect
            value={tag}
            onChange={(v) => setFilter('tag', v)}
            placeholder="All tags"
            options={tagStats.value.map((x) => ({ value: x.tag, label: `#${x.tag}` }))}
          />
        )}
        <FilterSelect
          value={month}
          onChange={(v) => setFilter('month', v)}
          placeholder="All months"
          options={monthList.map((m) => ({ value: m, label: monthLabel(m) }))}
        />
      </div>
      {totals && (
        <div class="history-totals">
          <span>
            Expenses <Usd value={totals.expense} whole />
          </span>
          <span>
            Income <Usd value={totals.income} whole class="pos" />
          </span>
        </div>
      )}
      <TxDays
        key={query.toString()}
        txs={filtered}
        empty={<Empty title="No transactions" text={account || category || month || tag ? 'Try clearing the filters' : 'Tap + to add the first one'} />}
      />
    </main>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
  extra,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
  extra?: string;
}) {
  const label = options.find((o) => o.value === value)?.label ?? extra ?? placeholder;
  return (
    <label class={cx('filter-chip', value && 'on')}>
      <span class="filter-chip-text">{value ? label.trim() : placeholder}</span>
      <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
        <option value="">{placeholder}</option>
        {extra && value && !options.some((o) => o.value === value) && <option value={value}>{extra}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
