import { render } from 'preact';
import { App } from './ui/App';
import { reloadFromDb } from './data/store';
import { startSync } from './data/sync';
import './styles.css';

async function boot() {
  // Updates first, without waiting on them: whatever happens below, a fixed version can still arrive.
  void registerUpdates().catch(() => undefined);
  render(<App />, document.getElementById('app')!);
  // Ask the browser not to evict IndexedDB when storage runs low.
  navigator.storage?.persist?.().catch(() => undefined);
  await reloadFromDb();
  startSync();
}

async function registerUpdates() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({
      immediate: true,
      // iOS resumes the installed app without reloading the page, so look for a new version every time the app
      // comes back and once an hour; autoUpdate then reloads into it.
      onRegisteredSW(_url, reg) {
        if (!reg) return;
        const check = () => void reg.update().catch(() => undefined);
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
        setInterval(check, 60 * 60 * 1000);
      },
    });
  }
}

void boot();
