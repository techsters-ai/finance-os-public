import { useState } from 'preact/hooks';
import { categoryTree } from '../../data/store';
import type { CategoryKind } from '../../domain/types';
import { budgetTotal } from '../../domain/metrics';
import { CatIcon, LargeTitle, NavButton, Row, Section, Segmented, Usd, cx } from '../components';
import { IconBack, IconPlus } from '../icons';
import { back, navigate } from '../router';

export function CategoriesScreen() {
  const [kind, setKind] = useState<CategoryKind>('expense');
  const list = categoryTree(kind, true);
  const budget = budgetTotal(list);
  return (
    <main class="screen">
      <div class="back-row">
        <NavButton onClick={() => back('/settings')}>
          <IconBack size={20} /> Settings
        </NavButton>
      </div>
      <LargeTitle
        right={
          kind !== 'system' && (
            <NavButton onClick={() => navigate(`/categories/new?kind=${kind}`)} label="Add category">
              <IconPlus size={24} />
            </NavButton>
          )
        }
      >
        Categories
      </LargeTitle>
      <div class="pad">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'expense', label: 'Expenses' },
            { value: 'income', label: 'Income' },
            { value: 'system', label: 'System' },
          ]}
        />
      </div>
      <Section
        right={kind === 'expense' && budget > 0 ? <span>Total: <Usd value={budget} whole /></span> : undefined}
        title={kind === 'expense' ? 'Monthly budget' : undefined}
        footer={kind === 'system' ? 'Reconciliation uses system categories. You can rename them but not delete them.' : undefined}
      >
        {list.length === 0 && <Row title="Nothing here yet" />}
        {list.map((c) => (
          <Row
            key={c.id}
            class={cx(c.archived && 'archived', c.parent_id && 'row-child')}
            icon={<CatIcon cat={c} size={32} />}
            title={c.name}
            subtitle={
              [c.essential ? 'Essential' : '', c.archived ? 'Archived' : ''].filter(Boolean).join(' · ') || undefined
            }
            value={typeof c.budget_usd === 'number' && c.budget_usd > 0 ? <Usd value={c.budget_usd} whole /> : undefined}
            chevron
            onClick={() => navigate(`/categories/${c.id}`)}
          />
        ))}
      </Section>
    </main>
  );
}
