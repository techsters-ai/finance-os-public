// Transactions board: income sources, accounts and expense categories as coins,
// plus a Debts coin among the categories. Drag income → account, account → category / account / Debts,
// Debts → account to start an entry; tap a coin for the quick path. Holding a coin still switches to edit
// mode: coins can be rearranged inside their row or removed.
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  accountHidden,
  accountsById,
  activeAccounts,
  balances,
  capital,
  categories,
  categoriesById,
  categoryTree,
  currencyOf,
  debtBoardOf,
  liveTransactions,
  rates,
  saveAccount,
  saveCategory,
} from '../../data/store';
import { shortId } from '../../data/ids';
import type { Account, AccountGroup, Category } from '../../domain/types';
import { monthsInRange, rangeLabel, today } from '../../domain/dates';
import { budgetTone, periodStats } from '../../domain/metrics';
import { toUsd } from '../../domain/fx';
import { debtStatus, personAccount } from '../../domain/debts';
import { reorderSorts, sectionOf } from '../../domain/order';
import { inScope, isShared, parseScopes, type CategoryScope } from '../../domain/scope';
import { TYPE_TITLE } from './Accounts';
import { AccountIcon, CatIcon, CurrencySwitch, Money, Ring, Row, Section, Sheet, cx, fromUsd, showToast, useScrollMemory } from '../components';
import { IconChevronDown, IconEye, IconEyeOff, IconPlus } from '../icons';
import { boardGroup, boardPeriod, setBoardGroup, setBoardPeriod, showHidden, toggleShowHidden, type BoardGroup } from '../prefs';
import { PeriodSheet, resolvePeriod } from '../period';
import { navigate } from '../router';

export const GROUPS: { id: BoardGroup; label: string; hint: string; members: AccountGroup[] }[] = [
  { id: 'total', label: 'Total', hint: 'All accounts: liquid, investments and business', members: ['liquid', 'credit', 'investment', 'business'] },
  { id: 'liquid', label: 'Liquid', hint: 'Cards, cash, savings and credit cards', members: ['liquid', 'credit'] },
  { id: 'investment', label: 'Investments', hint: 'Deposits, stocks, crypto, gold', members: ['investment'] },
  { id: 'business', label: 'Business', hint: 'Business accounts', members: ['business'] },
];

type TileKind = 'income' | 'account' | 'debts' | 'expense' | 'more';

interface Drag {
  kind: TileKind;
  id: string;
  x: number;
  y: number;
  target?: { kind: TileKind; id: string };
  /** Edit mode: moving the coin to another place in its row. */
  reorder?: boolean;
}

const drag = signal<Drag | null>(null);
/** Coins jiggle: drag to rearrange inside a row, × to remove. */
const editMode = signal(false);
const removing = signal<{ kind: 'account' | 'category'; id: string } | null>(null);

const groupDef = () => GROUPS.find((g) => g.id === boardGroup.value) ?? GROUPS[1];

/**
 * The accounts row: the group's accounts, the hidden ones only with "Show hidden", in the Accounts screen's order
 * (domain/order.ts: section, then sort; a credit card can sit anywhere among the liquid accounts).
 */
function boardAccounts(): Account[] {
  const members = groupDef().members;
  return activeAccounts.value.filter((a) => members.includes(a.group) && (showHidden.value || !accountHidden(a)));
}

/** Coins reorder within a section of the Accounts screen: on Total, a business account stays among business ones. */
const sameSection = (a: string, b: string) => {
  const x = accountsById.value.get(a);
  const y = accountsById.value.get(b);
  return !!x && !!y && sectionOf(x.group) === sectionOf(y.group);
};
const incomeCats = () => categoryTree('income').filter((c) => !c.parent_id);
const topExpense = () => categoryTree('expense').filter((c) => !c.parent_id);
/** The board's own expense categories (see Category.scope); Total shows them all. */
const expenseCats = () => topExpense().filter((c) => !isShared(c) && inScope(c, groupDef().id));
/** Expense categories of the other boards: behind the More coin. */
const otherCats = () => topExpense().filter((c) => !isShared(c) && !inScope(c, groupDef().id));
/** Categories on every board (Taxes): the shared row with Debts, apart from day-to-day spending. */
const sharedCats = () => topExpense().filter((c) => isShared(c));

/** What people owe and are owed on a board: people whose latest transfer was with its accounts; Total = all. */
function boardDebts(board: BoardGroup): { receivable: number; payable: number } {
  if (board === 'total') return { receivable: capital.value.receivable, payable: capital.value.payable };
  let receivable = 0;
  let payable = 0;
  for (const p of activeAccounts.value) {
    if (p.group !== 'debt' || (debtBoardOf.value.get(p.id) ?? 'liquid') !== board) continue;
    const usd = toUsd(balances.value.get(p.id) ?? 0, p.currency, rates.value) ?? 0;
    if (usd > 0) receivable += usd;
    else payable += usd;
  }
  return { receivable, payable };
}

function canDrop(src: Pick<Drag, 'kind' | 'id' | 'reorder'>, kind: string | undefined, id: string | undefined): boolean {
  if (!kind || !id) return false;
  if (src.reorder) return kind === src.kind && id !== src.id && (kind !== 'account' || sameSection(src.id, id));
  if (src.kind === 'income' || src.kind === 'debts') return kind === 'account';
  return kind === 'expense' || kind === 'debts' || kind === 'more' || (kind === 'account' && id !== src.id);
}

/**
 * Which way money moves with a person: 'give' (account → Debts: lend or repay), 'get' (Debts → account: borrow
 * or get repaid), or 'view' (a tap on the coin).
 */
type DebtMode = { dir: 'give' | 'get'; accountId: string } | { dir: 'view' };

/** Opens the person picker when a drop involves the Debts coin. */
const debtPick = signal<DebtMode | null>(null);
/** Opens the other boards' categories (the More coin): with the account dropped on it, if any. */
const morePick = signal<{ accountId?: string } | null>(null);

function dropTo(src: Drag, target: { kind: TileKind; id: string }): void {
  if (src.reorder) void reorder(src.kind, src.id, target.id);
  else if (src.kind === 'income') navigate(`/entry?type=income&cat=${enc(src.id)}&account=${enc(target.id)}`);
  else if (src.kind === 'debts') debtPick.value = { dir: 'get', accountId: target.id };
  else if (target.kind === 'debts') debtPick.value = { dir: 'give', accountId: src.id };
  else if (target.kind === 'more') morePick.value = { accountId: src.id };
  else if (target.kind === 'expense') navigate(`/entry?type=expense&cat=${enc(target.id)}&account=${enc(src.id)}`);
  else navigate(`/entry?type=transfer&account=${enc(src.id)}&to=${enc(target.id)}`);
}

/** Moves a coin to the target's place in its row and stores the new order (the `sort` field). */
async function reorder(kind: TileKind, srcId: string, targetId: string): Promise<void> {
  if (kind === 'account') {
    const list = boardAccounts().filter((a) => sameSection(a.id, srcId));
    for (const a of reorderSorts(list, srcId, targetId)) await saveAccount(a);
  } else if (kind === 'income' || kind === 'expense') {
    for (const c of reorderSorts(kind === 'income' ? incomeCats() : expenseCats(), srcId, targetId)) await saveCategory(c);
  }
}

/** The person's side of a debt transfer: give = account → person, get = person → account. */
function debtEntry(mode: { dir: 'give' | 'get'; accountId: string }, personId: string): string {
  return mode.dir === 'give'
    ? `/entry?type=transfer&account=${enc(mode.accountId)}&to=${enc(personId)}`
    : `/entry?type=transfer&account=${enc(personId)}&to=${enc(mode.accountId)}`;
}

const enc = encodeURIComponent;

/** Amounts on coins: in full up to 9,999,999, then compact (200M ₸). One font size for every amount. */
function CoinMoney({ value, currency, class: cls }: { value: number; currency: string; class?: string }) {
  const big = Math.abs(value) >= 10_000_000;
  return <Money value={value} currency={currency} whole={big} compact={big} class={cls} />;
}

/** A USD total on the board, in the display currency. */
function CoinUsd({ value, class: cls }: { value: number; class?: string }) {
  const d = fromUsd(value);
  return <CoinMoney value={d.value} currency={d.currency} class={cls} />;
}

const HOLD_MS = 260;
const EDIT_MS = 650;
const REORDER_MS = 160;
const STILL_PX = 8;
const EDGE_PX = 28;

/**
 * Press and hold to pick a coin up (a quick swipe still scrolls), then drop it on a target. Keep holding it
 * still and the board switches to edit mode; there a coin is picked up after a short hold and dropped on
 * another coin of its row to take that place. With a mouse a drag starts after a few pixels of movement.
 */
function useCoinDrag(root: { current: HTMLElement | null }) {
  const suppressClick = useRef(false);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let press: {
      kind: TileKind;
      id: string;
      x0: number;
      y0: number;
      x: number;
      y: number;
      pointerId: number;
      mouse: boolean;
      draggable: boolean;
      timer?: number;
      editTimer?: number;
    } | null = null;
    let edge: { row: HTMLElement; dir: number; timer: number } | null = null;

    const stopEdge = () => {
      if (edge) clearInterval(edge.timer);
      edge = null;
    };
    const clearTimers = () => {
      if (press?.timer) clearTimeout(press.timer);
      if (press?.editTimer) clearTimeout(press.editTimer);
    };
    const guardClick = () => {
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 400);
    };
    const start = (reorder: boolean) => {
      if (!press) return;
      drag.value = { kind: press.kind, id: press.id, x: press.x, y: press.y, reorder };
      navigator.vibrate?.(8);
    };
    const enterEdit = () => {
      clearTimers();
      press = null;
      stopEdge();
      drag.value = null;
      editMode.value = true;
      navigator.vibrate?.(15);
      guardClick();
    };
    const finish = (drop: boolean) => {
      clearTimers();
      press = null;
      stopEdge();
      const d = drag.value;
      if (!d) return;
      drag.value = null;
      guardClick();
      if (drop && d.target) dropTo(d, d.target);
    };
    // Hovering near the edge of a paged row flips it to the next page.
    const autoScroll = (x: number, y: number) => {
      const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('.board-row');
      const r = row?.getBoundingClientRect();
      const dir = !row || !r ? 0 : x < r.left + EDGE_PX ? -1 : x > r.right - EDGE_PX ? 1 : 0;
      if (edge && edge.row === row && edge.dir === dir) return;
      stopEdge();
      if (row && dir) {
        const flip = () => row.scrollBy({ left: dir * row.clientWidth, behavior: 'smooth' });
        edge = { row, dir, timer: window.setInterval(flip, 650) };
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.button > 0) return;
      const target = e.target as Element;
      if (target.closest('.coin-x')) return;
      const tile = target.closest<HTMLElement>('[data-kind]');
      if (!tile) return;
      const draggable = tile.dataset.drag !== undefined;
      const editable = tile.dataset.edit !== undefined;
      if (editMode.value ? !editable : !draggable && !editable) return;
      const mouse = e.pointerType === 'mouse';
      press = {
        kind: tile.dataset.kind as TileKind,
        id: tile.dataset.id!,
        x0: e.clientX,
        y0: e.clientY,
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
        mouse,
        draggable,
      };
      if (editMode.value) {
        if (!mouse) press.timer = window.setTimeout(() => start(true), REORDER_MS);
        return;
      }
      if (draggable && !mouse) press.timer = window.setTimeout(() => start(false), HOLD_MS);
      if (editable) {
        press.editTimer = window.setTimeout(() => {
          if (press && Math.hypot(press.x - press.x0, press.y - press.y0) < STILL_PX) enterEdit();
        }, EDIT_MS);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.pointerId) return;
      press.x = e.clientX;
      press.y = e.clientY;
      const moved = Math.hypot(press.x - press.x0, press.y - press.y0);
      if (moved >= STILL_PX && press.editTimer) {
        clearTimeout(press.editTimer);
        press.editTimer = undefined;
      }
      const d = drag.value;
      if (!d) {
        if (press.mouse && moved > 6 && (editMode.value || press.draggable)) start(editMode.value);
        else if (!press.mouse && moved > 10) finish(false);
        return;
      }
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-drop], [data-edit]');
      const ok = hit && (d.reorder ? hit.dataset.edit !== undefined : hit.dataset.drop !== undefined);
      const target =
        ok && canDrop(d, hit.dataset.kind, hit.dataset.id) ? { kind: hit.dataset.kind as TileKind, id: hit.dataset.id! } : undefined;
      drag.value = { ...d, x: e.clientX, y: e.clientY, target };
      autoScroll(e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent) => {
      if (press && e.pointerId === press.pointerId) finish(e.type === 'pointerup');
    };
    // Once a coin is picked up, the page and the rows must not scroll under the finger.
    const onTouchMove = (e: TouchEvent) => {
      if (drag.value) e.preventDefault();
    };
    const onContextMenu = (e: Event) => {
      if (press || drag.value) e.preventDefault();
    };

    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('contextmenu', onContextMenu);
    return () => {
      finish(false);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, [root]);
  return suppressClick;
}

function Coin({
  kind,
  id,
  name,
  icon,
  amount,
  sub,
  draggable,
  droppable,
  editable,
  title,
  dim,
  onTap,
  onRemove,
  tapGuard,
}: {
  kind: TileKind;
  id: string;
  name: string;
  icon: ComponentChildren;
  amount: ComponentChildren;
  sub?: ComponentChildren;
  draggable?: boolean;
  droppable?: boolean;
  /** Can be rearranged and removed in edit mode. */
  editable?: boolean;
  /** Full name for screen readers and the remove action, when the label is shorter (account coins). */
  title?: string;
  /** A hidden account shown with "Show hidden". */
  dim?: boolean;
  onTap: () => void;
  onRemove?: () => void;
  tapGuard: { current: boolean };
}) {
  const d = drag.value;
  const editing = editMode.value && editable;
  const state = !d
    ? undefined
    : d.kind === kind && d.id === id
      ? 'drag-src'
      : d.target?.kind === kind && d.target.id === id
        ? 'drop-on'
        : canDrop(d, kind, id)
          ? 'drop-ok'
          : 'drop-dim';
  return (
    <button
      type="button"
      class={cx('coin', state, editing && 'coin-editing', dim && 'coin-hidden')}
      data-kind={kind}
      data-id={id}
      data-drag={draggable ? '' : undefined}
      data-drop={droppable ? '' : undefined}
      data-edit={editable ? '' : undefined}
      aria-label={title}
      onClick={() => {
        if (!tapGuard.current && !editMode.value) onTap();
      }}
    >
      <span class="coin-name">{name}</span>
      <span class="coin-icon">
        {icon}
        {editing && onRemove && (
          <span
            class="coin-x"
            role="button"
            aria-label={`Remove ${title ?? name}`}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            ×
          </span>
        )}
      </span>
      <span class="coin-amount">{amount}</span>
      {sub !== undefined && <span class="coin-sub">{sub}</span>}
    </button>
  );
}

function AddCoin({ label, icon, onTap }: { label: string; icon?: ComponentChildren; onTap: () => void }) {
  return (
    <button type="button" class="coin coin-add" onClick={onTap}>
      <span class="coin-name">{label}</span>
      <span class="coin-icon">
        <span class="coin-add-circle">{icon ?? <IconPlus size={20} />}</span>
      </span>
    </button>
  );
}

/** A row of coins, four per page, swiped horizontally. */
function PagedRow({ children, count, class: cls }: { children: ComponentChildren; count: number; class?: string }) {
  const [page, setPage] = useState(0);
  const row = useRef<HTMLDivElement>(null);
  const pages = Math.max(1, Math.ceil(count / 4));
  // Coins added or removed (data loading, edit mode) would make the browser re-snap mid-page: keep whole pages.
  useLayoutEffect(() => {
    const el = row.current;
    if (!el || !el.clientWidth) return;
    const p = Math.min(pages - 1, Math.round(el.scrollLeft / el.clientWidth));
    el.scrollLeft = p * el.clientWidth;
  }, [count, pages]);
  return (
    <div class={cx('board-band', cls)}>
      <div
        class="board-row"
        ref={row}
        onScroll={(e) => {
          const el = e.currentTarget as HTMLElement;
          setPage(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {children}
      </div>
      <div class="board-dots" aria-hidden="true">
        {pages > 1 && Array.from({ length: pages }, (_, i) => <span key={i} class={cx('board-dot', i === page && 'on')} />)}
      </div>
    </div>
  );
}

function DragGhost({ icon }: { icon: ComponentChildren }) {
  const d = drag.value;
  if (!d) return null;
  return (
    <div class="coin-ghost" style={{ left: d.x, top: d.y }}>
      {icon}
    </div>
  );
}

const ICON = 44;
const RING = 50;

export function BoardScreen() {
  const root = useScrollMemory<HTMLElement>('board');
  const tapGuard = useCoinDrag(root);
  const [switcher, setSwitcher] = useState(false);
  const group = groupDef();
  const [periodSheet, setPeriodSheet] = useState(false);
  const { from, to } = resolvePeriod(boardPeriod.value);
  // Budgets are monthly: a longer period gets that many months of them.
  const months = monthsInRange(from, to).length;
  const r = rates.value;

  const accounts = boardAccounts();
  const groupAll = activeAccounts.value.filter((a) => group.members.includes(a.group));
  const hiddenCount = groupAll.filter((a) => accountHidden(a)).length;
  const ids = new Set(groupAll.map((a) => a.id));
  const monthStats = (inBoard: Set<string>) =>
    periodStats({
      txs: liveTransactions.value,
      history: [],
      categories: categories.value,
      from,
      to,
      rates: r,
      currencyOf,
      accountFilter: (id) => inBoard.has(id),
    });
  const stats = monthStats(ids);
  // Income doesn't depend on the board: always every account's, as on Total.
  const totalIds = new Set(activeAccounts.value.filter((a) => GROUPS[0].members.includes(a.group)).map((a) => a.id));
  const incomeStats = group.id === 'total' ? stats : monthStats(totalIds);
  const groupBalance = (members: AccountGroup[]) =>
    activeAccounts.value
      .filter((a) => members.includes(a.group))
      .reduce((s, a) => s + (toUsd(balances.value.get(a.id) ?? 0, a.currency, r) ?? 0), 0);

  const incomes = incomeCats();
  const expenses = expenseCats();
  const shared = sharedCats();
  const debts = boardDebts(group.id);
  // Taxes and the rest of the shared row aren't day-to-day spending: the Expenses total leaves them out.
  const dayToDay = stats.expense - shared.reduce((s, c) => s + (stats.expenseByCategory.get(c.id) ?? 0), 0);

  const d = drag.value;
  const ghost = !d ? null : d.kind === 'debts' ? (
    <DebtIcon />
  ) : d.kind === 'account' ? (
    <AccountIcon account={accounts.find((a) => a.id === d.id)} size={ICON} round />
  ) : d.kind === 'income' ? (
    <IncomeIcon cat={incomes.find((c) => c.id === d.id)} />
  ) : (
    <span class="tone-none">
      <span class="coin-cat">{expenses.find((c) => c.id === d.id)?.icon}</span>
    </span>
  );

  const removeAccount = (id: string) => (removing.value = { kind: 'account', id });
  const removeCategory = (id: string) => (removing.value = { kind: 'category', id });

  return (
    <main
      class={cx('screen', 'board', d && 'board-dragging', editMode.value && 'board-editing')}
      ref={root}
      onClick={(e) => {
        // In edit mode a tap on empty space ends it.
        if (editMode.value && !(e.target as Element).closest('.coin, .board-head')) editMode.value = false;
      }}
    >
      <header class="board-head">
        <div class="board-head-top">
          <CurrencySwitch />
          <button type="button" class="board-switch" onClick={() => setSwitcher(true)}>
            {group.label}
            <IconChevronDown size={16} stroke-width={2.4} />
          </button>
          {editMode.value ? (
            <button type="button" class="nav-btn bold board-done" onClick={() => (editMode.value = false)}>
              Done
            </button>
          ) : (
            <button type="button" class="board-period" onClick={() => setPeriodSheet(true)}>
              {rangeLabel(from, to)}
            </button>
          )}
        </div>
        {editMode.value && <div class="board-month">Drag a coin onto another to move it, × to remove</div>}
        {/* Four columns like the coins below: Expenses over the first, Income over the last. */}
        <div class="board-totals">
          <div>
            <span>Expenses</span>
            <b>
              <CoinUsd value={dayToDay} />
            </b>
          </div>
          <div class="board-total-mid">
            <span>Balance</span>
            <b>
              <CoinUsd value={groupBalance(group.members)} />
            </b>
          </div>
          <div>
            <span>Income</span>
            <b>
              <CoinUsd value={incomeStats.income} />
            </b>
          </div>
        </div>
      </header>

      <PagedRow count={incomes.length + 1}>
        {incomes.map((c) => (
          <Coin
            key={c.id}
            kind="income"
            id={c.id}
            name={c.name}
            icon={<IncomeIcon cat={c} />}
            amount={<CoinUsd value={incomeStats.incomeByCategory.get(c.id) ?? 0} />}
            draggable
            editable
            tapGuard={tapGuard}
            onTap={() => navigate(`/categories/${enc(c.id)}/view?board=total`)}
            onRemove={() => removeCategory(c.id)}
          />
        ))}
        <AddCoin label="Source" onTap={() => navigate('/categories/new?kind=income')} />
      </PagedRow>

      <PagedRow count={accounts.length + 1 + (hiddenCount > 0 ? 1 : 0)}>
        {accounts.map((a) => (
          <AccountCoin key={a.id} a={a} tapGuard={tapGuard} onRemove={() => removeAccount(a.id)} />
        ))}
        <AddCoin label="Account" onTap={() => navigate(group.id === 'total' ? '/accounts/new' : `/accounts/new?group=${group.id}`)} />
        {hiddenCount > 0 && (
          <AddCoin
            label={showHidden.value ? 'Hide hidden' : `Hidden · ${hiddenCount}`}
            icon={showHidden.value ? <IconEyeOff size={20} /> : <IconEye size={20} />}
            onTap={toggleShowHidden}
          />
        )}
      </PagedRow>

      <div class="board-grid">
        {expenses.map((c) => (
          <ExpenseCoin
            key={c.id}
            c={c}
            spent={stats.expenseByCategory.get(c.id) ?? 0}
            months={months}
            tapGuard={tapGuard}
            onRemove={() => removeCategory(c.id)}
          />
        ))}
        {otherCats().length > 0 && <MoreCoin tapGuard={tapGuard} />}
        <AddCoin
          label="Category"
          onTap={() => navigate(`/categories/new?kind=expense${group.id === 'business' || group.id === 'investment' ? `&scope=${group.id}` : ''}`)}
        />
      </div>

      {/* Not day-to-day spending: shared by every board, each board with its own numbers. */}
      <PagedRow count={shared.length + 1} class="board-shared">
        {shared.map((c) => (
          <ExpenseCoin key={c.id} c={c} spent={stats.expenseByCategory.get(c.id) ?? 0} months={months} tapGuard={tapGuard} />
        ))}
        <DebtsCoin tapGuard={tapGuard} receivable={debts.receivable} payable={debts.payable} />
      </PagedRow>

      {ghost && <DragGhost icon={ghost} />}

      <PersonSheet mode={debtPick.value} onClose={() => (debtPick.value = null)} />
      <MoreSheet pick={morePick.value} onClose={() => (morePick.value = null)} />
      <RemoveSheet />

      <PeriodSheet open={periodSheet} onClose={() => setPeriodSheet(false)} value={boardPeriod.value} onChange={setBoardPeriod} />

      <Sheet open={switcher} title="Show accounts" onClose={() => setSwitcher(false)}>
        <Section>
          {GROUPS.map((g) => (
            <Row
              key={g.id}
              title={g.label}
              subtitle={g.hint}
              value={<CoinUsd value={groupBalance(g.members)} />}
              checked={g.id === group.id}
              onClick={() => {
                setBoardGroup(g.id);
                setSwitcher(false);
              }}
            />
          ))}
        </Section>
      </Sheet>
    </main>
  );
}

/** All income sources share one light blue: they are inflows, not things to tell apart by color. */
function IncomeIcon({ cat }: { cat?: Category }) {
  return <span class="coin-income">{cat?.icon || '•'}</span>;
}

function AccountCoin({ a, tapGuard, onRemove }: { a: Account; tapGuard: { current: boolean }; onRemove: () => void }) {
  const bal = balances.value.get(a.id) ?? 0;
  return (
    <Coin
      kind="account"
      id={a.id}
      name={TYPE_TITLE[a.type] ?? a.name}
      title={a.name}
      icon={<AccountIcon account={a} size={ICON} round />}
      amount={<CoinMoney value={bal} currency={a.currency} class={bal < 0 && a.type !== 'credit' ? 'neg' : undefined} />}
      draggable
      droppable
      editable
      dim={accountHidden(a)}
      tapGuard={tapGuard}
      onTap={() => navigate(`/accounts/${enc(a.id)}/view`)}
      onRemove={onRemove}
    />
  );
}

function ExpenseCoin({
  c,
  spent,
  months,
  tapGuard,
  onRemove,
}: {
  c: Category;
  spent: number;
  /** The period's length in months: the monthly budget times that. */
  months: number;
  tapGuard: { current: boolean };
  /** Grid coins can be rearranged and removed in edit mode; the shared row's can't. */
  onRemove?: () => void;
}) {
  const budget = typeof c.budget_usd === 'number' ? c.budget_usd * months : 0;
  const tone = budgetTone(spent, budget);
  return (
    <Coin
      kind="expense"
      id={c.id}
      name={c.name}
      icon={
        <span class={`tone-${tone}`}>
          <Ring value={budget > 0 ? spent / budget : 0} color="var(--tone)" size={RING}>
            <span class="coin-cat">{c.icon || '•'}</span>
          </Ring>
        </span>
      }
      amount={<CoinUsd value={spent} class={tone === 'over' ? 'neg' : undefined} />}
      sub={budget > 0 ? <CoinUsd value={budget} /> : ''}
      droppable
      editable={!!onRemove}
      tapGuard={tapGuard}
      onTap={() => navigate(`/categories/${enc(c.id)}/view`)}
      onRemove={onRemove}
    />
  );
}

function DebtIcon() {
  return (
    <span class="coin-debt" aria-hidden="true">
      🤝
    </span>
  );
}

/** One coin for all debts: what people owe you in green, what you owe in red. */
function DebtsCoin({ tapGuard, receivable, payable }: { tapGuard: { current: boolean }; receivable: number; payable: number }) {
  return (
    <Coin
      kind="debts"
      id="debts"
      name="Debts"
      icon={
        <Ring value={0} color="var(--label-3)" size={RING}>
          <DebtIcon />
        </Ring>
      }
      amount={receivable || !payable ? <CoinUsd value={receivable} class={receivable ? 'pos' : undefined} /> : ''}
      sub={payable ? <CoinUsd value={Math.abs(payable)} class="neg" /> : ''}
      draggable
      droppable
      tapGuard={tapGuard}
      onTap={() => (debtPick.value = { dir: 'view' })}
    />
  );
}

/** The other boards' categories, one tap away, so the grid stays short (business can still pay for food). */
function MoreCoin({ tapGuard }: { tapGuard: { current: boolean } }) {
  return (
    <Coin
      kind="more"
      id="more"
      name="More"
      icon={
        <Ring value={0} color="var(--label-3)" size={RING}>
          <span class="coin-debt" aria-hidden="true">
            ⋯
          </span>
        </Ring>
      }
      amount=""
      droppable
      tapGuard={tapGuard}
      onTap={() => (morePick.value = {})}
    />
  );
}

const SCOPE_TITLE: Record<CategoryScope, string> = { liquid: 'Liquid', investment: 'Investments', business: 'Business' };

/** Category picker behind More: the other boards' categories, grouped by the board they belong to. */
function MoreSheet({ pick, onClose }: { pick: { accountId?: string } | null; onClose: () => void }) {
  if (!pick) return null;
  const account = pick.accountId ? accountsById.value.get(pick.accountId) : undefined;
  const cats = otherCats();
  const groups = (['liquid', 'investment', 'business'] as CategoryScope[])
    .map((s) => [s, cats.filter((c) => parseScopes(c.scope)[0] === s)] as const)
    .filter(([, list]) => list.length);
  const choose = (catId: string) => {
    onClose();
    navigate(`/entry?type=expense&cat=${enc(catId)}${account ? `&account=${enc(account.id)}` : ''}`);
  };
  return (
    <Sheet open title={account ? `Expense from ${account.name}` : 'More categories'} onClose={onClose}>
      {groups.map(([scope, list]) => (
        <Section key={scope} title={SCOPE_TITLE[scope]}>
          {list.map((c) => (
            <Row key={c.id} icon={<CatIcon cat={c} size={32} />} title={c.name} chevron onClick={() => choose(c.id)} />
          ))}
        </Section>
      ))}
      <div class="section-footer sheet-foot">
        Categories of the other boards. To keep one on this board, open it in Settings → Categories and turn this board
        on under "Show on the board".
      </div>
    </Sheet>
  );
}

/** Edit mode × on a coin: hide or archive an account, archive a category. */
function RemoveSheet() {
  const r = removing.value;
  if (!r) return null;
  const close = () => (removing.value = null);
  if (r.kind === 'account') {
    const a = accountsById.value.get(r.id);
    if (!a) return null;
    const bal = balances.value.get(a.id) ?? 0;
    return (
      <Sheet open title={a.name} onClose={close}>
        <Section footer="A hidden account still counts in every total; an archived one doesn't. Both come back from the account card.">
          <button
            type="button"
            class="row row-tap row-action"
            onClick={async () => {
              await saveAccount({ ...a, visibility: 'hide' });
              showToast(`${a.name} hidden`);
              close();
            }}
          >
            Hide account
          </button>
          <button
            type="button"
            class="row row-tap row-action danger"
            onClick={async () => {
              if (bal !== 0 && !confirm(`${a.name} still has money on it. Archive it anyway? It leaves net worth.`)) return;
              await saveAccount({ ...a, archived: true });
              showToast(`${a.name} archived`);
              close();
            }}
          >
            Archive account
          </button>
        </Section>
      </Sheet>
    );
  }
  const c = categoriesById.value.get(r.id);
  if (!c) return null;
  return (
    <Sheet open title={c.name} onClose={close}>
      <Section footer="Its transactions keep the category. Bring it back in Settings → Categories.">
        <button
          type="button"
          class="row row-tap row-action danger"
          onClick={async () => {
            await saveCategory({ ...c, archived: true });
            showToast(`${c.name} removed`);
            close();
          }}
        >
          {c.kind === 'income' ? 'Remove income source' : 'Remove category'}
        </button>
      </Section>
    </Sheet>
  );
}

const PICK_TEXT = {
  give: { title: 'Lend or repay', footer: (acc: string) => `Money goes from ${acc} to the person: a loan, or paying back what you owe.` },
  get: { title: 'Borrow or get repaid', footer: (acc: string) => `Money comes to ${acc} from the person: borrowing, or getting your loan back.` },
  view: { title: 'Debts', footer: () => 'Drag an account onto Debts to lend or repay, or Debts onto an account to borrow or get repaid.' },
};

/** People (debt accounts) to pick after a drop on or from the Debts coin; a new one can be added right here. */
function PersonSheet({ mode, onClose }: { mode: DebtMode | null; onClose: () => void }) {
  const [draft, setDraft] = useState('');
  const [all, setAll] = useState(false);
  if (!mode) return null;
  const account = mode.dir === 'view' ? undefined : activeAccounts.value.find((a) => a.id === mode.accountId);
  const r = rates.value;
  const usd = (a: Account) => Math.abs(toUsd(balances.value.get(a.id) ?? 0, a.currency, r) ?? 0);
  const everyone = activeAccounts.value.filter((a) => a.group === 'debt');
  const settled = everyone.filter((a) => accountHidden(a)).length;
  const people = everyone
    .filter((a) => all || !accountHidden(a))
    .sort((a, b) => usd(b) - usd(a) || a.name.localeCompare(b.name));
  const text = PICK_TEXT[mode.dir];
  const close = () => {
    setDraft('');
    setAll(false);
    onClose();
  };
  const pick = (personId: string) => {
    close();
    navigate(mode.dir === 'view' ? `/accounts/${enc(personId)}/view` : debtEntry(mode, personId));
  };
  const add = async () => {
    const name = draft.trim();
    if (!name) return;
    const existing = everyone.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) return pick(existing.id);
    const person = personAccount({ id: shortId('debt'), name, currency: account?.currency || 'USD', date: today() });
    await saveAccount(person);
    if (mode.dir === 'view') {
      showToast(`${name} added`);
      return close();
    }
    pick(person.id);
  };
  return (
    <Sheet open title={text.title} onClose={close}>
      {people.length > 0 && (
        <Section>
          {people.map((p) => {
            const bal = balances.value.get(p.id) ?? 0;
            return (
              <Row
                key={p.id}
                icon={<AccountIcon account={p} size={36} round />}
                title={p.name}
                subtitle={debtStatus(bal)}
                value={<Money value={Math.abs(bal)} currency={p.currency} class={bal > 0 ? 'pos' : bal < 0 ? 'neg' : 'muted'} />}
                chevron
                onClick={() => pick(p.id)}
              />
            );
          })}
        </Section>
      )}
      {settled > 0 && (
        <div class="more">
          <button type="button" class="btn btn-plain" onClick={() => setAll(!all)}>
            {all ? `Hide settled (${settled})` : `Show settled (${settled})`}
          </button>
        </div>
      )}
      <Section footer={text.footer(account?.name ?? 'the account')}>
        <div class="tag-new">
          <input
            class="input"
            type="text"
            placeholder="New person"
            value={draft}
            enterKeyHint="done"
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
          <button type="button" class="btn btn-tinted" disabled={!draft.trim()} onClick={() => void add()}>
            Add
          </button>
        </div>
      </Section>
    </Sheet>
  );
}
