// Tax residency, in Settings and as a sheet from the Home card (#/residency/current): the country you set as your tax
// residency (Settings tax_residency, saved on the server) with its headline rates (the TaxRates sheet); days per country
// since Jan 1, over the last 12 months or last year (domain/residency.ts) against each country's threshold; where you
// are today and the ways to check in: the iPhone Shortcut on a schedule, a tap (the phone's location, or the shortcut
// when iOS won't give it). Days (#/residency/days, a sheet) lists every day, newest first; a tap fixes one by hand.
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { config, locations, saveLocation, serverSettings, taxRates } from '../../data/store';
import { saveServerSetting } from '../../data/sync';
import { LocationRefused, SHORTCUT_NAME, checkIn, runCheckinShortcut } from '../../data/location';
import {
  COUNTRY_CODES,
  countDays,
  countryName,
  flagOf,
  presenceDays,
  pastYears,
  closestRule,
  NOWHERE,
  residencyName,
  residencyOf,
  residencyRange,
  residencySetNote,
  residencyStatus,
  thresholdOf,
  type PresenceDay,
} from '../../domain/residency';
import { dayLabel, monthLabel, plural, rangeLabel, shortDay, timeLabel, today } from '../../domain/dates';
import { Button, Empty, Field, NavBar, NavButton, Row, Section, Segmented, Sheet, TextInput, cx, showToast } from '../components';
import { IconChevron, IconClose, IconPlus } from '../icons';
import { CountryDaysSheet, YearStepper } from './ResidencyChart';
import { back, navigate } from '../router';
import { residencyWindow, setResidencyWindow } from '../prefs';

const SOURCES: Record<string, string> = { shortcut: 'Shortcut', app: 'App', manual: 'By hand', import: 'Imported' };
const sourceLabel = (s: string) => SOURCES[s] ?? s;
const names = (countries: string[]) => countries.map(countryName).join(' → ');
const Flag = ({ country }: { country?: string }) => (
  <span class="res-flag" aria-hidden="true">
    {country === NOWHERE ? '🌐' : country ? flagOf(country) : '📍'}
  </span>
);
const span = (w: 'year' | '12m') => (w === '12m' ? 'in 12 months' : 'this year');

const SHOWN = 6;


function CountryRow({ country, days, done, onOpen }: { country: string; days: number; done: boolean; onOpen: () => void }) {
  const limit = thresholdOf(country, taxRates.value);
  const over = days >= limit;
  return (
    <button type="button" class="row row-tap res-row" onClick={onOpen}>
      <div class="row-icon">
        <Flag country={country} />
      </div>
      <div class="row-main">
        <div class="row-title">{countryName(country)}</div>
        <div class="an-bar res-bar">
          <div class={cx(over && 'over')} style={{ width: `${Math.min(100, (days / limit) * 100)}%` }} />
        </div>
      </div>
      <div class="row-value">
        <div class="res-days">
          {days} {plural(days, 'day', 'days')}
        </div>
        <div class={cx('row-sub', over && 'res-over')}>{over ? `${limit}+: resident` : done ? `under ${limit}` : `${limit - days} to ${limit}`}</div>
      </div>
    </button>
  );
}

/** A rate as a row: the value large, what it is below (values run long, so they may wrap). */
const RateRow = ({ label, value }: { label: string; value: string }) => (value ? <Row class="res-rate" title={value} subtitle={label} /> : null);

/** The country you're a tax resident of, picked by hand, and its headline rates. */
function ResidencyCountry({ heading }: { heading: boolean }) {
  const [pick, setPick] = useState(false);
  const [preview, setPreview] = useState('');
  const set = residencyOf(serverSettings.value);
  const rate = taxRates.value.find((r) => r.country === set);
  const now = today();
  const risk = useMemo(() => residencyStatus(locations.value, taxRates.value, now).risk, [locations.value, taxRates.value, now]);
  const how = residencySetNote(serverSettings.value, (d) => (d === now ? 'today' : `on ${shortDay(d, now)}`));

  // In use at once; the sheet gets it in the background (or with the next sync when offline).
  async function choose(code: string) {
    setPick(false);
    setPreview('');
    if (code === set) return;
    await saveServerSetting('tax_residency', code);
    showToast(`Tax residency: ${residencyName(code)}`);
  }

  const about = !set
    ? 'Pick the country you are a tax resident of, or Nowhere, to see its headline rates (the TaxRates sheet).'
    : set === NOWHERE
      ? 'No country taxes you as a resident: only where the income is earned.'
      : rate
        ? `${rate.note ? `${rate.note}. ` : ''}Headline rates for a resident${rate.as_of ? ` as of ${rate.as_of}` : ''}, from the TaxRates sheet: check before relying on them.`
        : `No rates for ${countryName(set)} on the TaxRates sheet yet.`;
  const footer = `${how ? `${how}. ` : ''}${about} Meeting a country's day rule sets it here by itself.`;

  return (
    <>
      {risk && (
        <div class="res-risk-banner">
          <b>Tax residency risk</b>
          <span>
            {risk.left} more {plural(risk.left, 'day', 'days')} in {countryName(risk.country)} make you a tax resident there ({risk.days} of {risk.threshold}{' '}
            {span(risk.window)}).
          </span>
        </div>
      )}
      <Section title={heading ? 'Tax residency' : undefined} footer={footer}>
        <Row
          icon={<Flag country={set || undefined} />}
          title="Tax resident in"
          value={set ? residencyName(set) : <span class="muted">Not set</span>}
          chevron
          onClick={() => setPick(true)}
        />
        {rate && (
          <>
            <RateRow label="Domestic income tax" value={rate.domestic_income} />
            <RateRow label="Foreign income tax" value={rate.foreign_income} />
            <RateRow label="Capital gains tax" value={rate.capital_gains} />
            <RateRow label="Resident after" value={rate.residency_rule} />
          </>
        )}
      </Section>
      <Sheet
        open={pick}
        tall
        title={preview ? `${flagOf(preview)} ${countryName(preview)}` : 'Tax resident in'}
        onClose={() => {
          setPick(false);
          setPreview('');
        }}
      >
        {preview ? (
          <CountryTaxCard code={preview} chosen={preview === set} onBack={() => setPreview('')} onChoose={() => void choose(preview)} />
        ) : (
          <>
            <Section footer="Nowhere: no country taxes you as a resident, which isn't the same as not set.">
              <Row icon={<Flag country={NOWHERE} />} title="Nowhere" checked={set === NOWHERE} onClick={() => void choose(NOWHERE)} />
            </Section>
            <CountrySearch selected={set} onPick={setPreview} />
          </>
        )}
      </Sheet>
    </>
  );
}

/**
 * Every country to search, in two lists: the ones you've been in this year, most days first (with the days), then
 * the rest alphabetically. The search narrows both.
 */
function CountrySearch({ onPick, selected }: { onPick: (code: string) => void; selected?: string }) {
  const [query, setQuery] = useState('');
  const now = today();
  const ytd = useMemo(() => countDays(locations.value, `${now.slice(0, 4)}-01-01`, now), [locations.value, now]);
  const lists = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (c: string) => !q || c.toLowerCase() === q || countryName(c).toLowerCase().includes(q);
    const been = new Set(ytd.map((c) => c.country));
    return {
      been: ytd.filter((c) => match(c.country)),
      rest: COUNTRY_CODES.filter((c) => !been.has(c) && match(c)).sort((a, b) => countryName(a).localeCompare(countryName(b))),
    };
  }, [query, ytd]);
  const row = (c: string, days?: number) => (
    <Row
      key={c}
      icon={<Flag country={c} />}
      title={countryName(c)}
      value={days ? <span class="muted">{`${days} ${plural(days, 'day', 'days')}`}</span> : undefined}
      checked={c === selected}
      onClick={() => onPick(c)}
    />
  );
  return (
    <>
      <Section>
        <Field label="Country">
          <TextInput value={query} onInput={setQuery} placeholder="Search" />
        </Field>
      </Section>
      {lists.been.length > 0 && <Section title="This year">{lists.been.map((c) => row(c.country, c.days))}</Section>}
      {lists.rest.length > 0 && <Section title={lists.been.length ? 'Other countries' : undefined}>{lists.rest.map((c) => row(c))}</Section>}
      {!lists.been.length && !lists.rest.length && (
        <Section>
          <Row title="No such country" />
        </Section>
      )}
    </>
  );
}

const WINDOW_TEXT = { year: 'in a calendar year', '12m': 'in any 12 months in a row' };

/** A country before it's chosen: its taxes for a resident and every way to become one; Back or Choose. */
function CountryTaxCard({ code, chosen, onBack, onChoose }: { code: string; chosen: boolean; onBack: () => void; onChoose: () => void }) {
  const rate = taxRates.value.find((r) => r.country === code);
  const now = today();
  const mine = useMemo(() => residencyStatus(locations.value, taxRates.value, now).rules.find((r) => r.country === code), [locations.value, taxRates.value, now, code]);
  const threshold = thresholdOf(code, taxRates.value);
  const window = rate?.window ?? 'year';
  const tests = (rate?.residency_tests || rate?.residency_rule || '').split(/\n+/).map((t) => t.trim()).filter(Boolean);
  const host = rate?.source ? rate.source.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : '';
  return (
    <div class="country-card">
      <div class="country-card-head">
        <span class="country-card-days">
          {mine?.days ?? 0}
          <small> / {threshold}</small>
        </span>
        <span class="muted">days {window === '12m' ? 'in the last 12 months' : 'this year'}</span>
      </div>
      {rate ? (
        <Section
          title={`Taxes for a resident${rate.as_of ? ` · ${rate.as_of}` : ''}`}
          footer={
            <>
              {rate.confidence === 'low' && <b class="res-low">From secondary sources: check them. </b>}
              {rate.note && `${rate.note}. `}Headline rates: check before relying on them.
              {host && (
                <>
                  {' '}
                  Source:{' '}
                  <a href={rate.source} target="_blank" rel="noreferrer">
                    {host}
                  </a>
                  .
                </>
              )}
            </>
          }
        >
          <RateRow label="Domestic income tax" value={rate.domestic_income} />
          <RateRow label="Foreign income tax" value={rate.foreign_income} />
          <RateRow label="Capital gains tax" value={rate.capital_gains} />
          {typeof rate.foreign_rate === 'number' && <RateRow label="Set aside on foreign income (estimate)" value={`${Math.round(rate.foreign_rate * 1000) / 10}%`} />}
        </Section>
      ) : (
        <Section footer="Add a row for it on the TaxRates sheet to see its rates.">
          <Row title="No rates for this country yet" />
        </Section>
      )}
      <Section title="Tax resident when">
        <Row class="res-rate" title={`${threshold} days ${WINDOW_TEXT[window]}`} subtitle="The day count the app checks" />
        {tests.map((t) => (
          <Row key={t} class="res-rate" title={t} />
        ))}
      </Section>
      <div class="country-card-actions">
        <Button kind="tinted" onClick={onBack}>
          Back
        </Button>
        <Button kind="filled" onClick={onChoose} disabled={chosen}>
          {chosen ? 'Chosen' : 'Choose'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Home: the residency set (by hand or by a rule met) and its days against its rule; for Nowhere or not set, the
 * country closest to its rule. A risk (today's country 14 days or less from its rule) shows in orange. Opens the screen.
 */
export function ResidencyCard() {
  const now = today();
  const status = useMemo(() => residencyStatus(locations.value, taxRates.value, now), [locations.value, taxRates.value, now]);
  const set = residencyOf(serverSettings.value);
  if (!set && !status.rules.length) return null;
  const shown = /^[A-Z]{2}$/.test(set) ? status.rules.find((r) => r.country === set) ?? { country: set, days: 0, threshold: thresholdOf(set, taxRates.value), window: 'year' as const } : closestRule(status.rules);
  const risk = status.risk;
  return (
    <button type="button" class="taxes-card" onClick={() => navigate('/residency/current')}>
      <span class="res-card-flag" aria-hidden="true">
        {set === NOWHERE ? '🌐' : set ? flagOf(set) : '📍'}
      </span>
      <span class="taxes-card-text">
        <b>Current tax residency</b>
        {risk ? (
          <span class="res-risk-text">
            Risk: {risk.left} more {plural(risk.left, 'day', 'days')} in {countryName(risk.country)}
          </span>
        ) : (
          <span>
            {residencyName(set)}
            {shown && (shown.country === set ? ` · ${span(shown.window)}` : ` · closest: ${countryName(shown.country)}`)}
          </span>
        )}
      </span>
      {shown && (
        <span class="taxes-card-value">
          {shown.days}/{shown.threshold}
        </span>
      )}
      <IconChevron size={16} />
    </button>
  );
}

/** The Home card's sheet: the same as in Settings. */
export function ResidencyScreen() {
  return (
    <main class="screen screen-modal">
      <NavBar left={<NavButton onClick={() => back('/')}>Close</NavButton>} title="Tax residency" />
      <ResidencySection inSheet />
    </main>
  );
}

export function ResidencySection({ inSheet = false }: { inSheet?: boolean }) {
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recipe, setRecipe] = useState(false);
  const [error, setError] = useState('');
  const [chart, setChart] = useState<string | null>(null);
  const now = today();
  const w = residencyWindow.value;
  const years = useMemo(() => pastYears(locations.value, now), [locations.value, now]);
  const [year, setYear] = useState(years[0]);
  const { from, to } = residencyRange(w, now, year);
  const counts = useMemo(() => countDays(locations.value, from, to), [locations.value, from, to]);
  const shown = all ? counts : counts.slice(0, SHOWN);
  const here = presenceDays(locations.value, now, now)[0];
  const rec = here?.record;

  async function tap() {
    setBusy(true);
    setError('');
    try {
      const r = await checkIn();
      showToast(r.notify || `Checked in: ${countryName(r.country)}${r.city ? `, ${r.city}` : ''}`);
    } catch (e) {
      // iOS 26 refuses the location to Home Screen apps whatever the settings say: the shortcut has it.
      if (e instanceof LocationRefused) runCheckinShortcut();
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ResidencyCountry heading={!inSheet} />

      <section class="section">
        <div class="section-header">
          <span>Days by country</span>
          <span class="section-header-right">{rangeLabel(from, to, now)}</span>
        </div>
        <div class="an-switch">
          <Segmented
            value={w}
            onChange={setResidencyWindow}
            options={[
              { value: 'ytd', label: 'YTD' },
              { value: 'y1', label: '12 months' },
              { value: 'year', label: String(year) },
            ]}
          />
          {w === 'year' && <YearStepper years={years} year={year} onChange={setYear} />}
        </div>
        <div class="group">
          {counts.length === 0 && <Row title="No days yet" subtitle="Check in below or set up the iPhone Shortcut" />}
          {shown.map((c) => (
            <CountryRow key={c.country} country={c.country} days={c.days} done={w === 'year'} onOpen={() => setChart(c.country)} />
          ))}
          {counts.length > SHOWN && (
            <Row
              title={<span class="accent">{all ? 'Show fewer' : `${counts.length - SHOWN} more ${plural(counts.length - SHOWN, 'country', 'countries')}`}</span>}
              onClick={() => setAll(!all)}
            />
          )}
        </div>
        <div class="section-footer">
          A day counts for every country you were in: a flight day for both ends, a same-day connection for neither. A day
          without a check-in counts where the day before ended. Each bar runs to the country's residency threshold (the
          TaxRates sheet; 183 days where it has none); a country with a 12-month window counts any 12 months in a row.
        </div>
      </section>

      <Section footer={error ? <span class="neg">{error}</span> : undefined}>
        <Row
          icon={<Flag country={here?.countries.at(-1)} />}
          title={here ? `Today · ${names(here.countries)}` : 'Today'}
          subtitle={
            rec
              ? [sourceLabel(rec.source), rec.city, rec.updated_at && timeLabel(rec.updated_at)].filter(Boolean).join(' · ')
              : here
                ? 'Not checked in yet: where the last day ended'
                : 'Not checked in yet'
          }
          value={
            <Button kind="tinted" class="res-check" onClick={() => void tap()} disabled={busy}>
              {busy ? 'Checking…' : 'Check in'}
            </Button>
          }
        />
        <Row title="Days" subtitle="Every day, newest first: tap one to fix it" chevron onClick={() => navigate('/residency/days')} />
        <Row title="iPhone Shortcut" subtitle="Checks in on a schedule without opening the app" chevron onClick={() => setRecipe(true)} />
      </Section>

      <ShortcutSheet open={recipe} onClose={() => setRecipe(false)} />
      <CountryDaysSheet country={chart} onClose={() => setChart(null)} />
    </>
  );
}

function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const copy = (text: string, what: string) => {
    if (!text) return showToast('Add the URL and key under Sheet connection first');
    void navigator.clipboard?.writeText(text).then(
      () => showToast(`${what} copied`),
      () => showToast("Couldn't copy"),
    );
  };
  const field = (name: string, type: string, value: ComponentChildren) => (
    <tr>
      <td>
        <code>{name}</code>
      </td>
      <td class="muted">{type}</td>
      <td>{value}</td>
    </tr>
  );
  return (
    <Sheet open={open} title="iPhone Shortcut" onClose={onClose}>
      <ol class="recipe">
        <li>
          In <b>Shortcuts</b>, tap <b>+</b> for a new shortcut and name it <b>{SHORTCUT_NAME}</b>.{' '}
          <button type="button" class="recipe-copy" onClick={() => copy(SHORTCUT_NAME, 'Name')}>
            Copy name
          </button>
        </li>
        <li>
          Add the action <b>Get Current Location</b>.
        </li>
        <li>
          Add <b>Get Contents of URL</b> with the web app URL.{' '}
          <button type="button" class="recipe-copy" onClick={() => copy(config.value.url, 'URL')}>
            Copy URL
          </button>
        </li>
        <li>
          Open its options: Method <b>POST</b>, Request Body <b>JSON</b>, and add the fields:
          <table class="recipe-fields">
            <tbody>
              {field(
                'key',
                'Text',
                <button type="button" class="recipe-copy" onClick={() => copy(config.value.key, 'Key')}>
                  Copy key
                </button>,
              )}
              {field('action', 'Text', <code>checkin</code>)}
              {field('lat', 'Number', 'Current Location → Latitude')}
              {field('lon', 'Number', 'Current Location → Longitude')}
              {field(
                'date',
                'Text',
                <>
                  Current Date → Date Format: Custom, <code>yyyy-MM-dd</code>
                </>,
              )}
              {field('source', 'Text', <code>shortcut</code>)}
            </tbody>
          </table>
        </li>
        <li>
          For the residency notices: add <b>Get Dictionary Value</b> — Value for <code>notify</code> in Contents of URL; then{' '}
          <b>If</b> Dictionary Value <b>has any value</b> → <b>Show Notification</b> with Dictionary Value.
        </li>
        <li>
          Automation → <b>+</b> → <b>Time of Day</b>, 09:00, Daily, <b>Run Immediately</b> → the action <b>Run Shortcut</b> →{' '}
          {SHORTCUT_NAME}. Another one at 21:00, so a travel day gets both countries.
        </li>
      </ol>
      <div class="section-footer recipe-foot">
        Allow Shortcuts to use your location when it asks. The notices: 14 days before a country's day rule is met where
        you are, and when one is met (the residency is then set by itself). Check in here runs the shortcut too when iOS won't give this app
        the location (iOS 26 refuses it to Home Screen apps); come back and the day shows up with the sync. The key opens your
        whole sheet: keep the shortcut to yourself.
      </div>
    </Sheet>
  );
}

/** The month's top countries: '🇷🇺 8 · 🇨🇾 7 · 🇵🇰 5 +6'. */
function monthCounts(days: PresenceDay[]): string {
  const n = new Map<string, number>();
  days.forEach((p) => p.countries.forEach((c) => n.set(c, (n.get(c) ?? 0) + 1)));
  const top = [...n].sort((a, b) => b[1] - a[1]);
  const shown = top.slice(0, 3).map(([c, k]) => `${flagOf(c)} ${k}`).join(' · ');
  return top.length > 3 ? `${shown} +${top.length - 3}` : shown;
}

export function ResidencyDaysScreen() {
  const [edit, setEdit] = useState<PresenceDay | null>(null);
  const now = today();
  const first = locations.value.reduce((m, d) => (!d.deleted && d.countries && d.date && (!m || d.date < m) ? d.date : m), '');
  const months = useMemo(() => {
    const out: { month: string; days: PresenceDay[] }[] = [];
    if (!first) return out;
    for (const p of presenceDays(locations.value, first, now).reverse()) {
      const m = p.date.slice(0, 7);
      if (out.at(-1)?.month !== m) out.push({ month: m, days: [] });
      out[out.length - 1].days.push(p);
    }
    return out;
  }, [locations.value, first, now]);

  return (
    <main class="screen screen-modal">
      <NavBar left={<NavButton onClick={() => back('/settings')}>Back</NavButton>} title="Days" />
      {!first && <Empty title="No days yet" text="Check in from Settings or set up the iPhone Shortcut." />}
      {months.map(({ month, days }) => (
        <Section key={month} class="res-month" title={monthLabel(month)} right={monthCounts(days)}>
          {days.map((p) => (
            <Row
              key={p.date}
              class={cx(p.assumed && 'res-assumed')}
              icon={<Flag country={p.countries.at(-1)} />}
              title={names(p.countries)}
              subtitle={[
                shortDay(p.date, now),
                p.assumed ? 'assumed' : sourceLabel(p.record?.source ?? ''),
                p.record?.note || p.record?.city,
              ]
                .filter(Boolean)
                .join(' · ')}
              onClick={() => setEdit(p)}
            />
          ))}
        </Section>
      ))}
      <DaySheet day={edit} onClose={() => setEdit(null)} />
    </main>
  );
}

/** Fix a day by hand: its countries in order (the last is where it ended) and a note; none = assumed again. */
function DaySheet({ day, onClose }: { day: PresenceDay | null; onClose: () => void }) {
  const [list, setList] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    setList(day?.countries ?? []);
    setNote(day?.record?.note ?? '');
    setAdding(false);
  }, [day]);

  if (!day) return null;

  async function save(countries: string[], text = note) {
    setList(countries);
    const base = day!.record ?? {
      id: `loc_${day!.date}`,
      date: day!.date,
      countries: '',
      city: '',
      source: 'manual',
      note: '',
      deleted: false,
      created_at: '',
      updated_at: '',
      server_ts: '',
    };
    await saveLocation({ ...base, countries: countries.join(' '), note: text, deleted: countries.length === 0 });
  }

  const close = () => {
    if (note !== (day.record?.note ?? '') && list.length) void save(list, note);
    onClose();
  };

  return (
    <Sheet open tall={adding} title={dayLabel(day.date)} onClose={close}>
      <Section footer="In the order you were there: the last one is where the day ended, and the days after it without a check-in count there. Remove them all to count the day where the day before ended.">
        {list.map((c) => (
          <Row
            key={c}
            icon={<Flag country={c} />}
            title={countryName(c)}
            value={
              <button type="button" class="icon-btn small" aria-label={`Remove ${countryName(c)}`} onClick={() => void save(list.filter((x) => x !== c))}>
                <IconClose size={18} />
              </button>
            }
          />
        ))}
        {!adding && (
          <Row
            icon={
              <span class="icon-tile" style={{ background: 'var(--accent)' }}>
                <IconPlus size={18} />
              </span>
            }
            title="Add country"
            onClick={() => setAdding(true)}
          />
        )}
      </Section>
      {adding && (
        <CountrySearch
          onPick={(c) => {
            void save([...list.filter((x) => x !== c), c]);
            setAdding(false);
          }}
        />
      )}
      <Section>
        <Field label="Note">
          <TextInput value={note} onInput={setNote} placeholder="SVO→BKK" />
        </Field>
      </Section>
    </Sheet>
  );
}
