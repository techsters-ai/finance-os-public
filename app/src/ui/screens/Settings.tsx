import { useEffect, useState } from 'preact/hooks';
import {
  config,
  lastSyncAt,
  pending,
  rates,
  ratesAt,
  saveConfig,
  serverSettings,
  syncStatus,
} from '../../data/store';
import { AutomationsSection } from './Automations';
import { ResidencySection } from './Residency';
import { ping, syncNow, SyncError } from '../../data/sync';
import { exportAll } from '../../data/db';
import { CURRENCIES, formatRate } from '../../domain/money';
import { timeLabel, today } from '../../domain/dates';
import { Button, Field, LargeTitle, Row, Section, TextInput, cx, showToast, syncLabel } from '../components';
import { IconEye, IconEyeOff } from '../icons';
import { navigate } from '../router';

declare const __BUILD_TIME__: string;

type PingState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'ok'; text: string } | { kind: 'error'; text: string };

async function downloadExport() {
  const data = await exportAll();
  const name = `finance-os-${today()}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (iOS && nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function StorageInfo() {
  const [info, setInfo] = useState<{ persisted?: boolean; usage?: number }>({});
  useEffect(() => {
    void (async () => {
      const persisted = await navigator.storage?.persisted?.().catch(() => undefined);
      const est = await navigator.storage?.estimate?.().catch(() => undefined);
      setInfo({ persisted, usage: est?.usage });
    })();
  }, []);
  const mb = info.usage != null ? `${(info.usage / 1024 / 1024).toFixed(1)} MB` : '—';
  return (
    <Row
      title="Storage"
      subtitle={info.persisted ? "Persistent: iOS won't delete your data" : 'Standard: add the app to your Home Screen'}
      value={<span class="muted">{mb}</span>}
    />
  );
}

export function SettingsScreen() {
  const [url, setUrl] = useState(config.value.url);
  const [key, setKey] = useState(config.value.key);
  const [showKey, setShowKey] = useState(false);
  const [pingState, setPing] = useState<PingState>({ kind: 'idle' });
  const s = syncStatus.value;

  // Save on every keystroke so the key isn't lost if you leave the screen without tapping a button.
  const updateUrl = (v: string) => {
    setUrl(v);
    void saveConfig({ url: v, key });
  };
  const updateKey = (v: string) => {
    setKey(v);
    void saveConfig({ url, key: v });
  };

  async function check() {
    if (!url.trim() || !key.trim()) {
      setPing({ kind: 'error', text: 'Enter the URL and key' });
      return;
    }
    setPing({ kind: 'busy' });
    try {
      const ts = await ping({ url: url.trim(), key: key.trim() });
      setPing({ kind: 'ok', text: `Connected. Server time: ${ts ? timeLabel(ts) : '—'}` });
      void syncNow();
    } catch (e) {
      setPing({ kind: 'error', text: e instanceof SyncError ? e.message : String(e) });
    }
  }

  async function reloadAll() {
    if (!confirm("Reload all data from the sheet? Local records that aren't in the sheet will be removed (unsent changes are kept).")) return;
    const ok = await syncNow({ full: true });
    showToast(ok ? 'Data reloaded' : syncStatus.value.message ?? 'Reload failed');
  }

  const rateList = CURRENCIES.filter((c) => c !== 'USD' && rates.value[c]);
  const second = typeof serverSettings.value.second_currency === 'string' ? serverSettings.value.second_currency : '';

  return (
    <main class="screen">
      <LargeTitle>Settings</LargeTitle>

      <Section title="Sync">
        <Row
          title="Status"
          subtitle={s.message && s.phase !== 'ok' ? s.message : undefined}
          value={<span class={cx('status-text', `sync-${s.phase}`)}>{syncLabel()}</span>}
        />
        <Row title="Last sync" value={<span class="muted">{timeLabel(lastSyncAt.value)}</span>} />
        <Row
          title="Pending changes"
          value={<span class={cx(pending.value > 0 ? 'badge' : 'muted')}>{pending.value}</span>}
        />
        <div class="field-actions">
          <Button kind="tinted" onClick={() => void syncNow()} disabled={s.phase === 'syncing'}>
            Sync now
          </Button>
          <Button kind="plain" onClick={reloadAll} disabled={s.phase === 'syncing'}>
            Reload all data
          </Button>
        </div>
      </Section>

      <ResidencySection />

      <AutomationsSection />

      <Section
        title="Rates · USD per unit"
        footer={ratesAt.value ? `Updated ${timeLabel(ratesAt.value)} via sync` : 'Rates come from the sheet when you sync'}
      >
        {rateList.length === 0 && <Row title="No rates yet" />}
        {rateList.map((c) => (
          <Row
            key={c}
            title={c}
            subtitle={c === second ? 'Second currency' : undefined}
            value={<span class="mono">${formatRate(rates.value[c])}</span>}
          />
        ))}
      </Section>

      <Section title="Data">
        <Row title="Categories" chevron onClick={() => navigate('/categories')} />
        <Row title="Monthly reconciliation" chevron onClick={() => navigate('/reconcile')} />
        <Row title="Export JSON" subtitle="All on-device data in a single file" chevron onClick={() => void downloadExport()} />
        <StorageInfo />
      </Section>

      <Section
        title="Sheet connection"
        footer="Apps Script web app URL (…/exec) and the secret key from the Settings tab. Stored only on this device."
      >
        <div class="field field-stacked">
          <span class="field-label">Web app URL</span>
          <textarea
            class="input textarea mono"
            rows={2}
            value={url}
            placeholder="https://script.google.com/macros/s/…/exec"
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            onInput={(e) => updateUrl((e.target as HTMLTextAreaElement).value)}
          />
        </div>
        <Field label="Key">
          <span class="key-input">
            <TextInput
              value={key}
              type={showKey ? 'text' : 'password'}
              autocomplete="off"
              onInput={updateKey}
              placeholder="secret"
            />
            <button type="button" class="icon-btn small" onClick={() => setShowKey(!showKey)} aria-label="Show key">
              {showKey ? <IconEyeOff size={18} /> : <IconEye size={18} />}
            </button>
          </span>
        </Field>
        <div class="field-actions">
          <Button kind="tinted" onClick={check} disabled={pingState.kind === 'busy'}>
            {pingState.kind === 'busy' ? 'Checking…' : 'Test connection'}
          </Button>
        </div>
        {(pingState.kind === 'ok' || pingState.kind === 'error') && (
          <div class={cx('ping-result', pingState.kind === 'ok' ? 'pos' : 'neg')}>{pingState.text}</div>
        )}
      </Section>

      <div class="form-foot">
        Finance OS · build {new Date(__BUILD_TIME__).toLocaleString('en-US')}
        <br />
        Your data lives only on this device and in your sheet.
      </div>
    </main>
  );
}
