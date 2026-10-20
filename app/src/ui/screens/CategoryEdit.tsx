import { useState } from 'preact/hooks';
import { categoriesById, categoryTree, saveCategory } from '../../data/store';
import { shortId } from '../../data/ids';
import type { Category, CategoryKind } from '../../domain/types';
import { joinScopes, parseScopes, type CategoryScope } from '../../domain/scope';
import { CatIcon, Field, NavBar, NavButton, NumberInput, Section, Select, Switch, TextInput, cx, showToast } from '../components';
import { back } from '../router';

const EMOJI = [
  '🍔', '🛒', '☕', '🍷', '🏠', '💡', '📱', '🚕', '🚗', '⛽', '✈️', '🏨',
  '💊', '🦷', '🏋️', '👕', '💇', '🎁', '🎬', '📚', '🎓', '🐶', '👶', '🧾',
  '💼', '💰', '🏦', '📈', '💸', '🪙', '🧑‍💻', '🛠', '📦', '❤️', '🎮', '🌍',
];

const COLORS = ['#FF9F0A', '#0A84FF', '#FFD60A', '#FF375F', '#64D2FF', '#8E8E93', '#AC8E68', '#30D158', '#BF5AF2', '#5E5CE6', '#FF453A', '#66D4CF'];

const SCOPE_ROWS: { scope: CategoryScope; label: string }[] = [
  { scope: 'liquid', label: 'Liquid' },
  { scope: 'investment', label: 'Investments' },
  { scope: 'business', label: 'Business' },
];

/** The icon is a single character: keep the last grapheme (a ZWJ emoji counts as one). */
function lastGrapheme(v: string): string {
  if (!v) return '';
  if (typeof Intl.Segmenter === 'function') {
    const segs = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(v)];
    return segs[segs.length - 1]?.segment ?? '';
  }
  return [...v].slice(-1).join('');
}

export function CategoryEditScreen({ id, kind, scope: scopeParam }: { id: string; kind?: string; scope?: string }) {
  const isNew = id === 'new';
  const existing = isNew ? undefined : categoriesById.value.get(id);
  const [c, setC] = useState<Category>(() =>
    existing
      ? { ...existing }
      : {
          id: shortId(kind === 'income' ? 'inc' : 'exp'),
          name: '',
          kind: (kind === 'income' ? 'income' : 'expense') as CategoryKind,
          parent_id: '',
          budget_usd: '',
          essential: false,
          icon: kind === 'income' ? '💰' : '📦',
          color: COLORS[0],
          archived: false,
          scope: scopeParam ?? '',
          sort: 100,
          updated_at: '',
          server_ts: '',
        },
  );
  const set = <K extends keyof Category>(k: K, v: Category[K]) => setC((prev) => ({ ...prev, [k]: v }));

  if (!isNew && !existing) {
    return (
      <main class="screen screen-modal">
        <NavBar left={<NavButton onClick={() => back('/categories')}>Back</NavButton>} title="Category" />
        <div class="empty">
          <div class="empty-title">Category not found</div>
        </div>
      </main>
    );
  }

  const system = c.kind === 'system';
  const parents = system ? [] : categoryTree(c.kind).filter((p) => !p.parent_id && p.id !== c.id);

  async function save(patch: Partial<Category> = {}) {
    const rec = { ...c, ...patch, name: c.name.trim() };
    // New category id: 'exp_' or 'inc_' based on the final kind + a short uuid.
    if (isNew) rec.id = `${rec.kind === 'income' ? 'inc' : 'exp'}_${rec.id.replace(/^[a-z]+_/, '')}`;
    if (!rec.name) {
      showToast('Enter a name');
      return false;
    }
    await saveCategory(rec);
    return true;
  }

  return (
    <main class="screen screen-modal form-screen">
      <NavBar
        left={<NavButton onClick={() => back('/categories')}>Cancel</NavButton>}
        title={isNew ? 'New category' : 'Category'}
        right={
          <NavButton
            bold
            onClick={async () => {
              if (await save()) {
                showToast('Saved');
                back('/categories');
              }
            }}
          >
            Done
          </NavButton>
        }
      />
      <div class="cat-preview">
        <CatIcon cat={c} size={72} />
      </div>
      <Section>
        <Field label="Name">
          <TextInput value={c.name} onInput={(v) => set('name', v)} placeholder="Eating out" />
        </Field>
        {!system && (
          <Field label="Type">
            <Select
              value={c.kind}
              options={[
                { value: 'expense', label: 'Expense' },
                { value: 'income', label: 'Income' },
              ]}
              onChange={(v) => setC((p) => ({ ...p, kind: v as CategoryKind, parent_id: '' }))}
            />
          </Field>
        )}
        {!system && (
          <Field label="Parent">
            <Select
              value={c.parent_id}
              options={[{ value: '', label: 'None' }, ...parents.map((p) => ({ value: p.id, label: p.name }))]}
              onChange={(v) => set('parent_id', v)}
            />
          </Field>
        )}
        <Field label="Icon">
          <TextInput value={c.icon} onInput={(v) => set('icon', lastGrapheme(v))} placeholder="🙂" />
        </Field>
        <div class="emoji-grid">
          {EMOJI.map((e) => (
            <button type="button" key={e} class={cx('emoji', c.icon === e && 'on')} onClick={() => set('icon', e)}>
              {e}
            </button>
          ))}
        </div>
        <div class="field field-stacked">
          <span class="field-label">Color</span>
          <div class="swatches">
            {COLORS.map((col) => (
              <button
                type="button"
                key={col}
                class={cx('swatch', c.color.toLowerCase() === col.toLowerCase() && 'on')}
                style={{ background: col }}
                aria-label={col}
                onClick={() => set('color', col)}
              />
            ))}
          </div>
        </div>
      </Section>

      {c.kind === 'expense' && (
        <Section footer="The sheet uses essential spending (housing, food, health) to calculate your runway.">
          <Field label="Monthly budget">
            <NumberInput value={c.budget_usd} suffix="$" onChange={(v) => set('budget_usd', v)} placeholder="—" />
          </Field>
          <Field label="Essential">
            <Switch checked={c.essential} onChange={(v) => set('essential', v)} />
          </Field>
        </Section>
      )}

      {c.kind === 'expense' && (
        <Section title="Show on the board" footer="Its coin appears on these boards; on the others it's one tap away under More. On all three it sits in the shared row with Debts, apart from day-to-day spending. A category of Business or Investments only is not budgeted: it stays out of the burn rate and runway.">
          {SCOPE_ROWS.map(({ scope, label }) => {
            const on = parseScopes(c.scope).includes(scope);
            return (
              <Field key={scope} label={label}>
                <Switch
                  checked={on}
                  onChange={(v) => {
                    const cur = parseScopes(c.scope);
                    const next = v ? [...cur, scope] : cur.filter((x) => x !== scope);
                    if (!next.length) return showToast('Keep it on at least one board');
                    set('scope', joinScopes(next));
                  }}
                />
              </Field>
            );
          })}
        </Section>
      )}

      <Section>
        <Field label="Sort order">
          <NumberInput value={c.sort} onChange={(v) => set('sort', v === '' ? 0 : v)} />
        </Field>
        {!system && (
          <Field label="Archived" hint="Hidden from entry; history is kept">
            <Switch checked={c.archived} onChange={(v) => set('archived', v)} />
          </Field>
        )}
      </Section>
      <div class="form-foot">{existing ? `id: ${existing.id}` : ''}</div>
    </main>
  );
}
