// Shared iOS-style components: lists, sheets, switches, amounts.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { createPortal } from 'preact/compat';
import { formatMoney, parseAmount, type FormatOptions } from '../domain/money';
import type { Account, Category } from '../domain/types';
import { DISPLAY_CURRENCIES, displayCurrency, hideAmounts, setDisplayCurrency } from './prefs';
import { pending, rates, syncStatus, lastSyncAt } from '../data/store';
import { syncNow } from '../data/sync';
import { navigate } from './router';
import { timeLabel } from '../domain/dates';
import { IconBank, IconBond, IconBriefcase, IconCard, IconCash, IconCheck, IconChart, IconChevron, IconCoin, IconGold, IconPerson, IconSafe, IconSync } from './icons';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ── Amounts ─────────────────────────────────────────────────

interface MoneyProps extends FormatOptions {
  value: number | undefined;
  currency: string;
  class?: string;
  /** Color income green. */
  tone?: boolean;
}

export function Money({ value, currency, class: cls, tone, ...opts }: MoneyProps) {
  if (hideAmounts.value) return <span class={cx('money', 'money-hidden', cls)}>•••</span>;
  if (value === undefined || !Number.isFinite(value)) return <span class={cx('money', 'muted', cls)}>—</span>;
  return (
    <span class={cx('money', tone && value > 0 && 'pos', tone && value < 0 && 'neg', cls)}>
      {formatMoney(value, currency, opts)}
    </span>
  );
}

/** A USD amount in the display currency (USD, EUR or GBP) at the current rate; USD when the rate is missing. */
export function fromUsd(usd: number): { value: number; currency: string } {
  const cur = displayCurrency.value;
  const rate = rates.value[cur];
  if (cur === 'USD' || !rate) return { value: usd, currency: 'USD' };
  return { value: usd / rate, currency: cur };
}

/** The currency USD totals are shown in right now. */
export function shownCurrency(): string {
  return fromUsd(1).currency;
}

export function formatUsd(usd: number, opts: FormatOptions = {}): string {
  const d = fromUsd(usd);
  return formatMoney(d.value, d.currency, opts);
}

/** A USD total, shown in the display currency. */
export function Usd({ value, ...props }: Omit<MoneyProps, 'currency'>) {
  const d = value === undefined ? { value, currency: 'USD' } : fromUsd(value);
  return <Money {...props} value={d.value} currency={d.currency} />;
}

const CUR_SIGN: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };

/** $ · € · £ switch for the display currency. */
export function CurrencySwitch() {
  return (
    <div class="cur-switch" role="radiogroup" aria-label="Display currency">
      {DISPLAY_CURRENCIES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={displayCurrency.value === c}
          aria-label={c}
          class={cx('cur-switch-item', displayCurrency.value === c && 'on')}
          onClick={() => setDisplayCurrency(c)}
        >
          {CUR_SIGN[c]}
        </button>
      ))}
    </div>
  );
}

// ── Scroll position ─────────────────────────────────────────

const scrollMemory = new Map<string, number>();

/**
 * Keeps a screen's scroll position while you step into a detail screen and come back (Cancel / Back):
 * the screen remounts, so the position is saved on unmount and restored on mount.
 */
export function useScrollMemory<T extends HTMLElement>(key: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const saved = scrollMemory.get(key);
    if (saved) el.scrollTop = saved;
    const onScroll = () => scrollMemory.set(key, el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [key]);
  return ref;
}

// ── Screen frame ────────────────────────────────────────────

export function NavBar({
  title,
  left,
  right,
}: {
  title?: ComponentChildren;
  left?: ComponentChildren;
  right?: ComponentChildren;
}) {
  return (
    <header class="navbar">
      <div class="navbar-side">{left}</div>
      <div class="navbar-title">{title}</div>
      <div class="navbar-side navbar-right">{right}</div>
    </header>
  );
}

export function LargeTitle({ children, right }: { children: ComponentChildren; right?: ComponentChildren }) {
  return (
    <div class="large-title">
      <h1>{children}</h1>
      {right && <div class="large-title-right">{right}</div>}
    </div>
  );
}

export function NavButton({
  children,
  onClick,
  bold,
  disabled,
  label,
}: {
  children: ComponentChildren;
  onClick: () => void;
  bold?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button type="button" class={cx('nav-btn', bold && 'bold')} onClick={onClick} disabled={disabled} aria-label={label}>
      {children}
    </button>
  );
}

// ── Lists ───────────────────────────────────────────────────

export function Section({
  title,
  right,
  footer,
  children,
  class: cls,
}: {
  title?: ComponentChildren;
  right?: ComponentChildren;
  footer?: ComponentChildren;
  children: ComponentChildren;
  class?: string;
}) {
  return (
    <section class={cx('section', cls)}>
      {(title || right) && (
        <div class="section-header">
          <span>{title}</span>
          {right && <span class="section-header-right">{right}</span>}
        </div>
      )}
      <div class="group">{children}</div>
      {footer && <div class="section-footer">{footer}</div>}
    </section>
  );
}

interface RowProps {
  icon?: ComponentChildren;
  title: ComponentChildren;
  subtitle?: ComponentChildren;
  value?: ComponentChildren;
  valueSub?: ComponentChildren;
  onClick?: () => void;
  chevron?: boolean;
  checked?: boolean;
  class?: string;
  /** data-* attributes: { 'reorder-id': 'acc_1' } → data-reorder-id="acc_1". */
  data?: Record<string, string>;
}

export function Row({ icon, title, subtitle, value, valueSub, onClick, chevron, checked, class: cls, data }: RowProps) {
  const Tag = onClick ? 'button' : 'div';
  const attrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]));
  return (
    <Tag type={onClick ? 'button' : undefined} class={cx('row', onClick && 'row-tap', cls)} onClick={onClick} {...attrs}>
      {icon && <div class="row-icon">{icon}</div>}
      <div class="row-main">
        <div class="row-title">{title}</div>
        {subtitle && <div class="row-sub">{subtitle}</div>}
      </div>
      {(value || valueSub) && (
        <div class="row-value">
          <div>{value}</div>
          {valueSub && <div class="row-sub">{valueSub}</div>}
        </div>
      )}
      {checked && <IconCheck class="row-check" size={20} />}
      {chevron && <IconChevron class="row-chevron" size={16} />}
    </Tag>
  );
}

export function Dot({ color, size = 10 }: { color?: string; size?: number }) {
  return <span class="dot" style={{ background: color || 'var(--label-3)', width: size, height: size }} />;
}

export function CatIcon({ cat, size = 36 }: { cat?: Category; size?: number }) {
  const color = cat?.color || '#8e8e93';
  return (
    <span
      class="cat-icon"
      style={{ width: size, height: size, fontSize: size * 0.5, background: `${color}26`, borderColor: `${color}55` }}
    >
      {cat?.icon || '•'}
    </span>
  );
}

/** Light background → dark letter (yellow bank tiles). */
function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.72;
}

const TYPE_ICONS: Record<string, (p: { size?: number }) => JSX.Element> = {
  card: IconCard,
  credit: IconCard,
  current: IconBank,
  flexible: IconBank,
  deposit: IconSafe,
  cash: IconCash,
  stocks: IconChart,
  bonds: IconBond,
  crypto: IconCoin,
  commodity: IconGold,
  business: IconBriefcase,
  loan: IconPerson,
};

/** The account's color with an icon of its type (card, bank account, deposit, cash, stocks…). */
export function AccountIcon({ account, size = 36, round }: { account?: Account; size?: number; round?: boolean }) {
  const color = account?.color || '#8e8e93';
  const Icon = TYPE_ICONS[account?.group === 'debt' ? 'loan' : account?.type ?? 'card'] ?? IconCard;
  return (
    <span
      class="acc-icon"
      style={{
        width: size,
        height: size,
        borderRadius: round ? '50%' : '28%',
        background: color,
        color: isLight(color) ? '#1c1c1e' : '#fff',
      }}
    >
      <Icon size={Math.round(size * 0.56)} />
    </span>
  );
}

/** Progress ring around a tile icon: value 0…1, red when over 1. */
export function Ring({
  value,
  color,
  size,
  children,
}: {
  value: number;
  color: string;
  size: number;
  children: ComponentChildren;
}) {
  const stroke = 3;
  const r = size / 2 - stroke / 2;
  const len = 2 * Math.PI * r;
  const over = value > 1;
  const shown = Math.max(0, Math.min(1, value));
  return (
    <span class="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill-2)" stroke-width={stroke} />
        {shown > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={over ? 'var(--red)' : color}
            stroke-width={stroke}
            stroke-linecap="round"
            stroke-dasharray={`${len * shown} ${len}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <span class="ring-inner">{children}</span>
    </span>
  );
}

// ── Bottom sheet ────────────────────────────────────────────
// Rendered into <body>: inside a scrolling screen iOS would keep it under the tab bar.

export function Sheet({
  open,
  title,
  onClose,
  children,
  tall,
}: {
  open: boolean;
  title?: ComponentChildren;
  onClose: () => void;
  children: ComponentChildren;
  /** Full height whatever the content: for a search, whose results come and go under a keyboard. */
  tall?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div class="sheet-backdrop" onClick={onClose}>
      <div class={cx('sheet', tall && 'sheet-tall')} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-grabber" />
        <div class="sheet-head">
          <div class="sheet-title">{title}</div>
          <button type="button" class="nav-btn bold" onClick={onClose}>
            Done
          </button>
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ── Controls ────────────────────────────────────────────────

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ComponentChildren }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div class="segmented" style={{ '--n': options.length, '--i': idx } as JSX.CSSProperties}>
      <div class="segmented-thumb" />
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          class={cx('segmented-item', o.value === value && 'active')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      class={cx('switch', checked && 'on')}
      onClick={() => onChange(!checked)}
    >
      <span class="switch-knob" />
    </button>
  );
}

/** Form row: label on the left, control on the right. */
export function Field({
  label,
  children,
  hint,
  stacked,
}: {
  label: ComponentChildren;
  children: ComponentChildren;
  hint?: ComponentChildren;
  stacked?: boolean;
}) {
  return (
    <div class={cx('field', stacked && 'field-stacked')}>
      <span class="field-label">
        {label}
        {hint && <span class="field-hint">{hint}</span>}
      </span>
      <span class="field-control">{children}</span>
    </div>
  );
}

export function TextInput({
  value,
  onInput,
  placeholder,
  type = 'text',
  autocomplete = 'off',
  inputMode,
}: {
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  type?: string;
  autocomplete?: string;
  inputMode?: JSX.HTMLAttributes['inputMode'];
}) {
  return (
    <input
      class="input"
      type={type}
      value={value}
      placeholder={placeholder}
      autocomplete={autocomplete}
      autocapitalize="sentences"
      inputMode={inputMode}
      onInput={(e) => onInput((e.target as HTMLInputElement).value)}
    />
  );
}

/**
 * Number field: decimal keyboard, dot or comma. The iOS decimal keyboard has no minus,
 * so negative values get a '±' button next to it.
 */
export function NumberInput({
  value,
  onChange,
  placeholder,
  allowNegative,
  suffix,
}: {
  value: number | '';
  onChange: (v: number | '') => void;
  placeholder?: string;
  allowNegative?: boolean;
  suffix?: string;
}) {
  const [text, setText] = useState(value === '' ? '' : String(value));
  useEffect(() => {
    const parsed = parseAmount(text);
    if ((parsed ?? '') !== value) setText(value === '' ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span class="number-input">
      {allowNegative && (
        <button
          type="button"
          class="sign-btn"
          onClick={(e) => {
            e.preventDefault();
            if (value !== '' && value !== 0) onChange(-value);
          }}
        >
          ±
        </button>
      )}
      <input
        class="input input-num"
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onInput={(e) => {
          const t = (e.target as HTMLInputElement).value;
          setText(t);
          const n = parseAmount(t);
          onChange(n == null ? '' : n);
        }}
      />
      {suffix && <span class="input-suffix">{suffix}</span>}
    </span>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <span class="select-wrap">
      <select class="select" value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export function DateInput({ value, onChange, allowEmpty }: { value: string; onChange: (v: string) => void; allowEmpty?: boolean }) {
  return (
    <span class="date-wrap">
      <input
        class="input input-date"
        type="date"
        value={value}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          if (v || allowEmpty) onChange(v);
        }}
      />
      {allowEmpty && value && (
        <button type="button" class="clear-btn" onClick={(e) => (e.preventDefault(), onChange(''))} aria-label="Clear">
          ×
        </button>
      )}
    </span>
  );
}

export function Button({
  children,
  onClick,
  kind = 'plain',
  disabled,
  class: cls,
}: {
  children: ComponentChildren;
  onClick: () => void;
  kind?: 'plain' | 'filled' | 'danger' | 'tinted';
  disabled?: boolean;
  class?: string;
}) {
  return (
    <button type="button" class={cx('btn', `btn-${kind}`, cls)} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Empty({ title, text, children }: { title: string; text?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <div class="empty-title">{title}</div>
      {text && <div class="empty-text">{text}</div>}
      {children}
    </div>
  );
}

// ── Sync ────────────────────────────────────────────────────

const PHASE_LABEL: Record<string, string> = {
  idle: 'Waiting',
  syncing: 'Syncing…',
  ok: 'Synced',
  offline: 'Offline',
  error: 'Sync error',
  unconfigured: 'Sync not set up',
};

export function syncLabel(): string {
  const s = syncStatus.value;
  if (s.phase === 'ok' && lastSyncAt.value) return `Synced ${timeLabel(lastSyncAt.value)}`;
  return PHASE_LABEL[s.phase] ?? s.phase;
}

/** Sync status + an 'N pending' badge. Tap to sync now. */
export function SyncPill() {
  const s = syncStatus.value;
  const n = pending.value;
  const onClick = () => {
    if (s.phase === 'unconfigured') navigate('/settings');
    else void syncNow();
  };
  return (
    <button type="button" class={cx('sync-pill', `sync-${s.phase}`)} onClick={onClick} title={s.message}>
      <IconSync size={14} class={cx(s.phase === 'syncing' && 'spin')} />
      <span class="sync-pill-text">{s.phase === 'ok' ? 'Sync' : PHASE_LABEL[s.phase]}</span>
      {n > 0 && <span class="badge">{n} pending</span>}
    </button>
  );
}

// ── Toasts ──────────────────────────────────────────────────

const toastMsg = signal<{ text: string; id: number } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string): void {
  toastMsg.value = { text, id: Date.now() };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastMsg.value = null), 1800);
}

export function Toaster() {
  const t = toastMsg.value;
  if (!t) return null;
  return (
    <div class="toast" key={t.id} role="status">
      {t.text}
    </div>
  );
}
