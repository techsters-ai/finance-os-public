import { useErrorBoundary } from 'preact/hooks';
import { backUntil, navigate, parse, route, type Route } from './router';
import { ready, reconciledMonths } from '../data/store';
import { reconcileReminderDue } from '../domain/reconcile';
import { today } from '../domain/dates';
import { Toaster, cx } from './components';
import { PageSheet } from './PageSheet';
import { IconCoins, IconGear, IconHistory, IconHome, IconWallet } from './icons';
import { HomeScreen } from './screens/Home';
import { BoardScreen } from './screens/Board';
import { EntryScreen } from './screens/Entry';
import { HistoryScreen } from './screens/History';
import { AccountsScreen } from './screens/Accounts';
import { AccountEditScreen } from './screens/AccountEdit';
import { AccountViewScreen } from './screens/AccountView';
import { CategoriesScreen } from './screens/Categories';
import { CategoryEditScreen } from './screens/CategoryEdit';
import { CategoryRoute } from './screens/CategoryView';
import { ReconcileAccountScreen, ReconcileWizardScreen } from './screens/Reconcile';
import { SettingsScreen } from './screens/Settings';
import { AutomationEditScreen } from './screens/Automations';
import { ResidencyDaysScreen, ResidencyScreen } from './screens/Residency';

function Screen({ r }: { r: Route }) {
  const [a, b, c] = r.segments;
  switch (a) {
    case undefined:
      return <HomeScreen />;
    case 'board':
      return <BoardScreen />;
    case 'entry':
      return <EntryScreen key={r.query.toString()} query={r.query} />;
    case 'history':
      return <HistoryScreen query={r.query} />;
    case 'accounts':
      if (b && c === 'reconcile') return <ReconcileAccountScreen key={b} id={b} />;
      if (b && c === 'view') return <AccountViewScreen key={b} id={b} />;
      if (b) return <AccountEditScreen key={b} id={b} group={r.query.get('group') ?? undefined} />;
      return <AccountsScreen />;
    case 'categories':
      if (b && c === 'view') return <CategoryRoute key={b} id={b} board={r.query.get('board') ?? undefined} />;
      if (b) return <CategoryEditScreen key={b} id={b} kind={r.query.get('kind') ?? undefined} scope={r.query.get('scope') ?? undefined} />;
      return <CategoriesScreen />;
    case 'reconcile':
      return <ReconcileWizardScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'automations':
      return b ? <AutomationEditScreen key={b} id={b} /> : <SettingsScreen />;
    case 'residency':
      if (b === 'days') return <ResidencyDaysScreen />;
      return b ? <ResidencyScreen /> : <SettingsScreen />;
    default:
      return <HomeScreen />;
  }
}

const TABS: { path: string; match: (string | undefined)[]; label: string; Icon: typeof IconHome }[] = [
  { path: '/', match: [undefined], label: 'Home', Icon: IconHome },
  { path: '/accounts', match: ['accounts'], label: 'Accounts', Icon: IconWallet },
  { path: '/history', match: ['history'], label: 'History', Icon: IconHistory },
  { path: '/settings', match: ['settings', 'categories', 'automations', 'residency'], label: 'Settings', Icon: IconGear },
];

function TabBar({ first }: { first: string | undefined }) {
  const reminder = reconcileReminderDue(today(), reconciledMonths.value);
  const tab = (t: (typeof TABS)[number]) => (
    <a
      key={t.path}
      href={`#${t.path}`}
      class={cx('tab', t.match.includes(first) && 'active')}
      onClick={(e) => {
        e.preventDefault();
        navigate(t.path, { replace: true });
      }}
    >
      <span class="tab-icon">
        <t.Icon size={25} stroke-width={1.8} />
        {t.path === '/accounts' && reminder && <span class="tab-dot" />}
      </span>
      <span class="tab-label">{t.label}</span>
    </a>
  );
  return (
    <nav class="tabbar">
      {tab(TABS[0])}
      {tab(TABS[1])}
      <button
        type="button"
        class={cx('tab-plus', first === 'board' && 'active')}
        aria-label="Board: transactions and accounts"
        onClick={() => navigate('/board', { replace: true })}
      >
        <IconCoins size={26} stroke-width={2.2} />
      </button>
      {tab(TABS[2])}
      {tab(TABS[3])}
    </nav>
  );
}

const MODAL_ROUTES = new Set(['entry', 'reconcile']);

/** An account, category, automation or residency days screen opens as a sheet over the screen it came from. */
function isSheet(r: Route): boolean {
  const [a, b] = r.segments;
  return (a === 'accounts' || a === 'categories' || a === 'automations' || a === 'residency') && !!b;
}

/** The last full screen, shown under a sheet; full-screen modals (entry, reconcile) never sit under one. */
let base: Route | null = null;

/** A screen that failed to render: say so and offer a way out instead of leaving a blank page. */
function Crash({ error, reset }: { error: unknown; reset: () => void }) {
  return (
    <main class="screen crash">
      <div class="crash-title">Something broke on this screen</div>
      <div class="crash-text">{String((error as Error)?.message ?? error)}</div>
      <div class="crash-actions">
        <button type="button" class="btn btn-filled" onClick={() => location.reload()}>
          Reload
        </button>
        <button
          type="button"
          class="btn btn-tinted"
          onClick={() => {
            navigate('/', { replace: true });
            reset();
          }}
        >
          Open Home
        </button>
      </div>
    </main>
  );
}

export function App() {
  const [error, reset] = useErrorBoundary((e) => console.error(e));
  if (error) return <Crash error={error} reset={reset} />;
  if (!ready.value) return <div class="boot" />;
  const r = route.value;
  const sheet = isSheet(r);
  if (!sheet && !MODAL_ROUTES.has(r.segments[0])) base = r;
  const under = sheet ? base ?? parse(`#/${r.segments[0]}`) : r;
  const modal = MODAL_ROUTES.has(under.segments[0]);
  return (
    <div class={cx('app', modal ? 'app-modal' : 'app-tabs')}>
      <Screen r={under} />
      {!modal && <TabBar first={under.segments[0]} />}
      {sheet && (
        <PageSheet onClose={() => backUntil((x) => !isSheet(x), under.path)}>
          <Screen r={r} />
        </PageSheet>
      )}
      <Toaster />
    </div>
  );
}
