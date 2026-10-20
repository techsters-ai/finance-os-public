// Check-ins from the app, for tax residency: the phone's position goes to the server (apps-script/Locations.js),
// which finds the country and adds it to today's row; the day is shown at once. When iOS won't give the app the
// location (iOS 26 refuses it to Home Screen web apps without asking, Safari settings or not), Check in runs the
// iPhone Shortcut instead: Shortcuts has the location, posts the same check-in, and the day comes with the sync
// when you're back.
import { applyServerLocation, config } from './store';
import { postProtocol, syncNow } from './sync';
import { today } from '../domain/dates';

/** The shortcut Check in falls back to; the recipe in Settings names it so. */
export const SHORTCUT_NAME = 'Finance OS check-in';

/** iOS said no to the location (code 1), as opposed to having none right now. */
export class LocationRefused extends Error {}

function position(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new LocationRefused('No location in this app'));
    // A country needs no precision: a cell or Wi-Fi fix up to an hour old will do.
    navigator.geolocation.getCurrentPosition(
      resolve,
      (e) => reject(e.code === 1 ? new LocationRefused(e.message || 'Location refused') : new Error(`No location right now${e.message ? ` (${e.message})` : ''}`)),
      { enableHighAccuracy: false, maximumAge: 60 * 60_000, timeout: 20_000 },
    );
  });
}

/** Checks in where the phone is now; returns the country and city the server found. */
export async function checkIn(): Promise<{ country: string; city: string; notify: string }> {
  const cfg = config.value;
  if (!cfg.url || !cfg.key) throw new Error('Add the URL and key in Settings');
  const pos = await position();
  const res = await postProtocol(cfg.url, {
    key: cfg.key,
    action: 'checkin',
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    date: today(),
    source: 'app',
  });
  if (res.day) await applyServerLocation(res.day);
  return { country: res.country ?? '', city: res.city ?? '', notify: res.notify ?? '' };
}

let shortcutAt = 0;
let listening = false;

/** Opens Shortcuts and runs the check-in shortcut; back in the app, a sync brings the day. */
export function runCheckinShortcut(): void {
  shortcutAt = Date.now();
  if (!listening) {
    listening = true;
    // Coming back from Shortcuts the app syncs at once (data/sync.ts), maybe before the shortcut's request is done:
    // once more a few seconds later.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !shortcutAt || Date.now() - shortcutAt > 5 * 60_000) return;
      shortcutAt = 0;
      setTimeout(() => void syncNow(), 8_000);
    });
  }
  location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`;
}
