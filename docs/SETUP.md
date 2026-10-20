# Finance OS setup and API

The step-by-step setup, written so an AI agent can walk you through it, is in [AGENTS.md](../AGENTS.md): send your agent the link to this repository and ask it to set Finance OS up for you. This page is the short version plus the reference.

## Setup in short

1. Create a blank Google Sheet named "Finance OS" and set its time zone (File → Settings).
2. Put the code from `apps-script/` into the sheet's Apps Script project: with [clasp](https://github.com/google/clasp) (`create-script --parentId <spreadsheet ID>`, then `push`), or by hand through Extensions → Apps Script. Set `timeZone` in `appsscript.json` to yours.
3. In the script editor run `setup` and allow the permissions. It creates the sheets, the access key, and two triggers: a daily job at 6 am and an on-edit stamp.
4. Deploy it as a web app: Execute as Me, Who has access: Anyone. The URL ends in `/exec`; put it into the Settings sheet's `webapp_url`.
5. Host the PWA (`app/`) on any static HTTPS host; Vercel with Root Directory `app` is the easiest.
6. On the iPhone: open the PWA in Safari → Share → Add to Home Screen. In the app's Settings paste the URL and the key (spreadsheet menu Finance OS → App connection) and tap Test connection.
7. Add your accounts with today's balances as opening balances.

The app's data lives in the storage of its home screen icon. Deleting the icon deletes the local copy, but everything synced is in the sheet: install again and tap Settings → Reload all data.

## Monthly routine

Between the 1st and the 7th the app reminds you to run Settings → Data → Monthly reconciliation: type each account's actual balance, and the difference is booked as a correction, interest or revaluation. On the 1st the daily job snapshots the balances and writes last month's row to the Closes sheet, redoing both daily until `close_freeze_day` so late entries count.

## Updating the code

```bash
git pull
cd apps-script
npx @google/clasp@3.4.1 push --force
npx @google/clasp@3.4.1 update-deployment <deploymentId> --description "..."
```

`update-deployment` keeps the same `/exec` URL. Without clasp: paste the changed files in the editor, then Deploy → Manage deployments → edit → Version: New version. If an update adds a sheet, run `setup` again first: it only adds what's missing.

## API

The web app takes a POST with a JSON body (`Content-Type: text/plain` from the PWA to avoid a CORS preflight). Every request carries the key; the answer is always HTTP 200 with `{ ok: false, error, message }` on failure.

| `action` | What it does |
|---|---|
| `ping` | Checks the key; answers the server time |
| `sync` | `since` (a `server_ts` cursor or null) and `ops` (records to write): answers the records changed since then plus rates, settings, metrics, history, allocation inputs, the taxes summary and, when changed, the TaxRates rows. See [SCHEMA.md](SCHEMA.md) |
| `checkin` | Adds the country you're in to that day's Locations row |
| `set_setting` | Changes one of the Settings the app may change (now only `tax_residency`) and answers all settings |
| `admin` | Off by default, see below |

### Check-ins for tax residency

`action: 'checkin'` takes `lat` and `lon` (looked up with Google's geocoder; a comma decimal is fine) or `country` (a two-letter code), `date` (`YYYY-MM-DD`, your local day; the sheet's today without it) and `source` (`shortcut`, `app`, `manual`). It answers `{ ok, country, city, day, notify }`. `notify` carries the residency notices queued since the last check-in: a country's day rule met (the residency is then set by itself), or 14 days from it where you are. The iPhone Shortcut from the app (Settings → Tax residency → iPhone Shortcut) shows them as a notification.

```bash
curl -sL -H 'Content-Type: application/json' \
  -d "{\"key\":\"$FOS_KEY\",\"action\":\"checkin\",\"country\":\"PT\",\"source\":\"manual\"}" \
  "$FOS_URL"
```

### Admin access

`action: 'admin'` reads and edits the spreadsheet remotely (`apps-script/Admin.js`); the PWA doesn't use it. It is off until you choose Finance OS → Turn on admin access in the spreadsheet menu, and you should turn it off again when you're done: `exec` runs any code in the spreadsheet with the key.

| `op` | What it does |
|---|---|
| `sheets` | Lists the sheets with their sizes |
| `read` | A range's values (as displayed; `raw: true` for raw numbers and dates) and formulas: `range: 'Settings!A1:C10'`, or `sheet` + `range`, or just `sheet`. Up to 50,000 cells |
| `write` | Writes the 2D array `values` from the range's top-left corner; strings starting with `=` become formulas |
| `exec` | Runs `code` as a function body with `ss`, `SpreadsheetApp` and `log()`; returns `result` and `logs` |

Edits made through admin don't fire `onEdit`: on the synced sheets set `updated_at` and `server_ts` yourself, or the app won't pick the change up.

## Security

- The key gives full access to your data: keep it like a password. Don't commit it, don't paste it into chats you share, don't put it in files in the repository. To change it: Finance OS → Rotate access key, then paste the new key into the app.
- The web app runs as you, with access to this one spreadsheet only (`spreadsheets.currentonly`), outbound requests for exchange rates and the gold price, its triggers and its menu. Without the key it answers `unauthorized`; a GET only says it's alive.
- The hosted PWA is code only. Your data stays on your phone and in your sheet.
- `.clasp.json` (your script ID) and `.clasprc.json` (clasp's login) are in `.gitignore`: keep them out of commits.
