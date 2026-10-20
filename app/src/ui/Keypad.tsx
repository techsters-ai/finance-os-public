// Calculator-style number pad used instead of the system keyboard.
import { useEffect } from 'preact/hooks';
import type { CalcKey } from '../domain/money';
import { cx } from './components';
import { IconBackspace, IconCheck } from './icons';

export type PadKey = CalcKey | 'ok';

const LAYOUT: PadKey[][] = [
  ['7', '8', '9', '-'],
  ['4', '5', '6', '+'],
  ['1', '2', '3', 'back'],
  ['.', '0', '=', 'ok'],
];

function label(k: PadKey, okLabel?: string) {
  switch (k) {
    case '-':
      return '−';
    case 'back':
      return <IconBackspace size={26} stroke-width={1.8} />;
    case 'ok':
      return okLabel ?? <IconCheck size={28} stroke-width={2.6} />;
    default:
      return k;
  }
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** A hardware keyboard works too (handy during development). */
function useHardwareKeys(onKey: (k: PadKey) => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (isTyping() || e.metaKey || e.ctrlKey || e.altKey) return;
      let k: PadKey | null = null;
      if (/^[0-9]$/.test(e.key)) k = e.key as PadKey;
      else if (e.key === '.' || e.key === ',') k = '.';
      else if (e.key === '+' || e.key === '-') k = e.key;
      else if (e.key === 'Backspace') k = 'back';
      else if (e.key === '=') k = '=';
      else if (e.key === 'Enter') k = 'ok';
      if (k) {
        e.preventDefault();
        onKey(k);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onKey, enabled]);
}

export function Keypad({
  onKey,
  okDisabled,
  okLabel,
  hardware = true,
}: {
  onKey: (k: PadKey) => void;
  okDisabled?: boolean;
  okLabel?: string;
  hardware?: boolean;
}) {
  useHardwareKeys(onKey, hardware);
  return (
    <div class="keypad" role="group" aria-label="Keypad">
      {LAYOUT.flat().map((k) => (
        <button
          type="button"
          key={k}
          class={cx(
            'key',
            (k === '+' || k === '-' || k === '=' || k === 'back') && 'key-op',
            k === 'ok' && 'key-ok',
          )}
          disabled={k === 'ok' && okDisabled}
          aria-label={k === 'back' ? 'Delete' : k === 'ok' ? 'Save' : undefined}
          onClick={() => onKey(k)}
        >
          {label(k, okLabel)}
        </button>
      ))}
    </div>
  );
}
