// Periods: presets (this month, last 3 months…) or a custom range, resolved against today; the sheet to pick one.
import { useEffect, useState } from 'preact/hooks';
import { history, liveTransactions } from '../data/store';
import { addMonths, currentMonth, monthEnd, monthStart, monthsInRange, today } from '../domain/dates';
import { Button, DateInput, Field, Row, Section, Sheet } from './components';
import type { PeriodPref, PeriodPreset } from './prefs';

const PRESETS: { id: Exclude<PeriodPreset, 'custom'>; label: string }[] = [
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: '3m', label: 'Last 3 months' },
  { id: '6m', label: 'Last 6 months' },
  { id: '12m', label: 'Last 12 months' },
  { id: 'ytd', label: 'This year' },
  { id: 'all', label: 'All time' },
];

function firstDataMonth(): string {
  let first = currentMonth();
  for (const h of history.value) if (h.month < first) first = h.month;
  for (const t of liveTransactions.value) if (t.date && t.date.slice(0, 7) < first) first = t.date.slice(0, 7);
  return first;
}

export function resolvePeriod(p: PeriodPref, now = today()): { from: string; to: string } {
  const cur = now.slice(0, 7);
  const months = (back: number) => ({ from: monthStart(addMonths(cur, -back)), to: monthEnd(cur) });
  switch (p.preset) {
    case 'last_month': {
      const m = addMonths(cur, -1);
      return { from: monthStart(m), to: monthEnd(m) };
    }
    case '3m':
      return months(2);
    case '6m':
      return months(5);
    case '12m':
      return months(11);
    case 'ytd':
      return { from: `${cur.slice(0, 4)}-01-01`, to: monthEnd(cur) };
    case 'all':
      return { from: monthStart(firstDataMonth()), to: monthEnd(cur) };
    case 'custom':
      if (p.from && p.to && p.from <= p.to) return { from: p.from, to: p.to };
      return months(0);
    default:
      return months(0);
  }
}

/** Whole-month ranges step by their own length; other ranges by their number of days. */
export function shiftPeriod(from: string, to: string, dir: -1 | 1): PeriodPref {
  const months = monthsInRange(from, to);
  if (from === monthStart(months[0]) && to === monthEnd(months[months.length - 1])) {
    const n = months.length * dir;
    return { preset: 'custom', from: monthStart(addMonths(months[0], n)), to: monthEnd(addMonths(months[months.length - 1], n)) };
  }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const shift = (d: string) => new Date(Date.parse(d) + dir * days * 86_400_000).toISOString().slice(0, 10);
  return { preset: 'custom', from: shift(from), to: shift(to) };
}

/** Presets and a custom range; the board and Home analytics each keep their own period. */
export function PeriodSheet({
  open,
  onClose,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  value: PeriodPref;
  onChange: (p: PeriodPref) => void;
}) {
  const { from, to } = resolvePeriod(value);
  const [cFrom, setFrom] = useState(from);
  const [cTo, setTo] = useState(to);
  useEffect(() => {
    if (open) {
      setFrom(from);
      setTo(to);
    }
  }, [open, from, to]);
  return (
    <Sheet open={open} title="Period" onClose={onClose}>
      <Section>
        {PRESETS.map((p) => (
          <Row
            key={p.id}
            title={p.label}
            checked={value.preset === p.id}
            onClick={() => {
              onChange({ preset: p.id });
              onClose();
            }}
          />
        ))}
      </Section>
      <Section title="Custom range">
        <Field label="From">
          <DateInput value={cFrom} onChange={setFrom} />
        </Field>
        <Field label="To">
          <DateInput value={cTo} onChange={setTo} />
        </Field>
        <div class="field-actions">
          <Button
            kind="tinted"
            disabled={!cFrom || !cTo || cFrom > cTo}
            onClick={() => {
              onChange({ preset: 'custom', from: cFrom, to: cTo });
              onClose();
            }}
          >
            Show this range
          </Button>
        </div>
      </Section>
    </Sheet>
  );
}
