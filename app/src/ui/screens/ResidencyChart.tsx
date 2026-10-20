// A country's days on a ring (Tax residency → a country): a year around a clock face — Jan 1 at the bottom, summer on
// top, months clockwise, the seasons around the outside — with the days you were there filled in over the window:
// since Jan 1, the 12 months up to today, or a past year. The 12 months wrap through today: the ring runs from a year
// ago round to today, so a rule of any 12 months in a row reads at a glance. A tap on the ring names the day;
// the stays below list the same days as dates.
import { useMemo, useState } from 'preact/hooks';
import { locations, taxRates } from '../../data/store';
import { countryName, flagOf, pastYears, presenceDays, residencyRange, thresholdOf, type ResidencyWindow } from '../../domain/residency';
import { addDays, plural, shortDay, today } from '../../domain/dates';
import { Row, Section, Segmented, Sheet } from '../components';
import { IconBack } from '../icons';

/** ‹ 2025 › — steps through the past years that have days (newest first in `years`); with one, the arrows are off. */
export function YearStepper({ years, year, onChange }: { years: number[]; year: number; onChange: (y: number) => void }) {
  const i = years.indexOf(year);
  return (
    <div class="year-stepper">
      <button type="button" class="icon-btn small" aria-label="Year before" disabled={i >= years.length - 1} onClick={() => onChange(years[i + 1])}>
        <IconBack size={18} />
      </button>
      <span>{year}</span>
      <button type="button" class="icon-btn small year-next" aria-label="Year after" disabled={i <= 0} onClick={() => onChange(years[i - 1])}>
        <IconBack size={18} />
      </button>
    </div>
  );
}

const SIZE = 320;
const C = SIZE / 2;
const R_DAYS = 118; // the days ring, centre line
const W_DAYS = 26;
const R_SEASON = 146;
const W_SEASON = 6;
const R_MONTHS = 90;
const MONTHS = 'JFMAMJJASOND';
// Seasons by their months (northern hemisphere), drawn as a thin outer ring; muted, labelled, not the data.
const SEASONS: { name: string; from: number; to: number; tone: string }[] = [
  { name: 'Winter', from: 11, to: 2, tone: 'var(--season-winter)' },
  { name: 'Spring', from: 2, to: 5, tone: 'var(--season-spring)' },
  { name: 'Summer', from: 5, to: 8, tone: 'var(--season-summer)' },
  { name: 'Autumn', from: 8, to: 11, tone: 'var(--season-autumn)' },
];

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** Where a day sits on the ring: 0 at Jan 1 (top), a full turn over its year. */
function angleOf(date: string): number {
  const y = Number(date.slice(0, 4));
  const day = (Date.UTC(y, Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) - Date.UTC(y, 0, 1)) / 86_400_000;
  return (day / (leap(y) ? 366 : 365)) * 2 * Math.PI;
}
const monthAngle = (m: number) => angleOf(`2026-${String(m + 1).padStart(2, '0')}-01`);
// The ring turned half round: Jan 1 at the bottom, so summer is on top.
const ROT = Math.PI;
const at = (r: number, a: number) => [C + r * Math.sin(a + ROT), C - r * Math.cos(a + ROT)] as const;

function arc(r: number, a0: number, a1: number): string {
  const [x0, y0] = at(r, a0);
  const [x1, y1] = at(r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * Runs of consecutive days, each one stretch of the ring: split where a year ends, and on Jul 1 too, since a whole
 * year as one arc starts and ends at the same point and SVG draws nothing.
 */
function runs(dates: string[]): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const d of dates) {
    const last = out.at(-1);
    if (last && addDays(last.to, 1) === d && d.slice(0, 4) === last.to.slice(0, 4) && d.slice(5) !== '07-01') last.to = d;
    else out.push({ from: d, to: d });
  }
  return out;
}

/** Stays: runs of days in the country, across years, newest first. */
function stays(dates: string[]): { from: string; to: string; days: number }[] {
  const out: { from: string; to: string; days: number }[] = [];
  for (const d of dates) {
    const last = out.at(-1);
    if (last && addDays(last.to, 1) === d) {
      last.to = d;
      last.days++;
    } else out.push({ from: d, to: d, days: 1 });
  }
  return out.reverse();
}

const endAngle = (date: string) => angleOf(date) + (2 * Math.PI) / (leap(Number(date.slice(0, 4))) ? 366 : 365);

export function CountryDaysSheet({ country, onClose }: { country: string | null; onClose: () => void }) {
  const rule = taxRates.value.find((r) => r.country === country);
  const [win, setWin] = useState<ResidencyWindow | null>(null);
  const [picked, setPicked] = useState('');
  const now = today();
  const years = useMemo(() => pastYears(locations.value, now), [locations.value, now]);
  const [year, setYear] = useState(years[0]);
  const w: ResidencyWindow = win ?? (rule?.window === '12m' ? 'y1' : 'ytd');
  const { from, to } = residencyRange(w, now, year);
  const data = useMemo(() => {
    const days = presenceDays(locations.value, from, to);
    return { days, here: days.filter((p) => country && p.countries.includes(country)).map((p) => p.date) };
  }, [locations.value, from, to, country]);
  if (!country) return null;

  const threshold = thresholdOf(country, taxRates.value);
  const inWindow = runs(data.days.map((p) => p.date));
  const filled = runs(data.here);
  const total = data.here.length;
  const pickedDay = picked ? data.days.find((p) => p.date === picked) : undefined;
  const close = () => {
    setWin(null);
    setPicked('');
    onClose();
  };

  // A tap on the ring: the day at that angle within the window.
  const tap = (e: MouseEvent) => {
    const svg = e.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * (SIZE + 92) - 46 - C;
    const y = ((e.clientY - box.top) / box.height) * (SIZE + 8) - 4 - C;
    const r = Math.hypot(x, y);
    if (r < R_DAYS - W_DAYS / 2 - 8 || r > R_DAYS + W_DAYS / 2 + 8) return setPicked('');
    const a = (Math.atan2(x, -y) - ROT + 4 * Math.PI) % (2 * Math.PI);
    const hit = data.days.find((p) => angleOf(p.date) <= a && a < endAngle(p.date));
    setPicked(hit?.date ?? '');
  };

  const todayA = angleOf(now);
  return (
    <Sheet open tall title={`${flagOf(country)} ${countryName(country)}`} onClose={close}>
      <div class="an-switch pad-x">
        <Segmented
          value={w}
          onChange={(v) => {
            setWin(v);
            setPicked('');
          }}
          options={[
            { value: 'ytd', label: 'YTD' },
            { value: 'y1', label: '12 months' },
            { value: 'year', label: String(year) },
          ]}
        />
        {w === 'year' && (
          <YearStepper
            years={years}
            year={year}
            onChange={(y) => {
              setYear(y);
              setPicked('');
            }}
          />
        )}
      </div>
      <div class="ring-chart">
        <svg
          viewBox={`-46 -4 ${SIZE + 92} ${SIZE + 8}`}
          role="img"
          aria-label={`${total} days in ${countryName(country)} from ${shortDay(from, now)} to ${shortDay(to, now)}, of ${threshold}`}
          onClick={tap}
        >
          {SEASONS.map((s) => {
            const a0 = monthAngle(s.from);
            const a1 = s.to > s.from ? monthAngle(s.to) : monthAngle(s.to) + 2 * Math.PI;
            const mid = (a0 + a1) / 2;
            const [lx, ly] = at(R_SEASON + 10, mid);
            // Side labels run outward from the ring, so they never cross it (or the today mark).
            const anchor = Math.sin(mid + ROT) > 0.3 ? 'start' : Math.sin(mid + ROT) < -0.3 ? 'end' : 'middle';
            return (
              <g key={s.name}>
                <path d={arc(R_SEASON, a0 + 0.006, a1 - 0.006)} stroke={s.tone} stroke-width={W_SEASON} fill="none" stroke-linecap="round" />
                <text x={lx} y={ly} class="ring-season" text-anchor={anchor} dominant-baseline="middle">
                  {s.name}
                </text>
              </g>
            );
          })}
          {inWindow.map((r) => (
            <path key={`w${r.from}`} d={arc(R_DAYS, angleOf(r.from), endAngle(r.to))} class="ring-track" stroke-width={W_DAYS} fill="none" />
          ))}
          {filled.map((r) => (
            <path key={`f${r.from}`} d={arc(R_DAYS, angleOf(r.from), endAngle(r.to))} class="ring-fill" stroke-width={W_DAYS} fill="none" />
          ))}
          {/* Month starts cut the ring with the surface colour; the first, Jan 1, is the year's start: a dark mark. */}
          {Array.from({ length: 12 }, (_, m) => {
            const a = monthAngle(m);
            const [x0, y0] = at(R_DAYS - W_DAYS / 2 - 1, a);
            const [x1, y1] = at(R_DAYS + W_DAYS / 2 + 1, a);
            const [tx, ty] = at(R_MONTHS, monthAngle(m) + Math.PI / 12);
            return (
              <g key={m}>
                <line x1={x0} y1={y0} x2={x1} y2={y1} class="ring-gap" />
                <text x={tx} y={ty} class="ring-month" text-anchor="middle" dominant-baseline="middle">
                  {MONTHS[m]}
                </text>
              </g>
            );
          })}
          <line x1={at(R_DAYS + W_DAYS / 2 + 6, 0)[0]} y1={at(R_DAYS + W_DAYS / 2 + 6, 0)[1]} x2={at(R_DAYS - W_DAYS / 2 - 4, 0)[0]} y2={at(R_DAYS - W_DAYS / 2 - 4, 0)[1]} class="ring-newyear" />
          {w !== 'year' && (
            <g>
              <circle cx={at(R_DAYS + W_DAYS / 2 + 7, todayA)[0]} cy={at(R_DAYS + W_DAYS / 2 + 7, todayA)[1]} r={4.5} class="ring-today" />
            </g>
          )}
          {pickedDay && (
            <path d={arc(R_DAYS, angleOf(pickedDay.date), endAngle(pickedDay.date))} class="ring-picked" stroke-width={W_DAYS + 8} fill="none" />
          )}
          <text x={C} y={C - 8} class="ring-total" text-anchor="middle">
            {total}
          </text>
          <text x={C} y={C + 18} class="ring-sub" text-anchor="middle">
            of {threshold} days
          </text>
        </svg>
      </div>
      <div class="ring-legend">
        <span>
          <i class="ring-key-fill" /> in {countryName(country)}
        </span>
        <span>
          <i class="ring-key-track" /> elsewhere
        </span>
        <span>
          <i class="ring-key-newyear" /> Jan 1
        </span>
        {w !== 'year' && (
          <span>
            <i class="ring-key-today" /> today
          </span>
        )}
      </div>
      <div class="ring-picked-text">
        {pickedDay
          ? `${shortDay(pickedDay.date, now)}: ${pickedDay.countries.map(countryName).join(' → ')}${pickedDay.assumed ? ' (assumed)' : ''}`
          : 'Tap the ring for a day'}
      </div>
      <Section
        title="Stays"
        right={`${total} ${plural(total, 'day', 'days')}`}
        footer={`${shortDay(from, now)} – ${shortDay(to, now)}. ${rule?.residency_rule ? `Resident after ${rule.residency_rule.replace(/^./, (c) => c.toLowerCase())}.` : `${threshold} days make you a resident.`}`}
      >
        {stays(data.here).map((s) => (
          <Row
            key={s.from}
            title={s.from === s.to ? shortDay(s.from, now) : `${shortDay(s.from, now)} – ${shortDay(s.to, now)}`}
            value={`${s.days} ${plural(s.days, 'day', 'days')}`}
          />
        ))}
        {total === 0 && <Row title="No days in this window" />}
      </Section>
    </Sheet>
  );
}
