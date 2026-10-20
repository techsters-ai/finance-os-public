# Instructions for AI agents

You are probably here because someone sent you this repository and said "make this work for me". This file tells you what the project is and how to get a person with no technical background from zero to a working app on their phone. Read it all before you start. The steps are tested; follow them in order.

## What this is

Finance OS is a personal finance app that each person runs on their own Google account. There is no shared server and no sign-up.

```
iPhone PWA (static files, any host)  ──POST + key──▶  Apps Script web app  ──▶  Google Sheet "Finance OS"
IndexedDB + offline queue                               (bound to the sheet)       all the data
```

- **The Google Sheet** (in the user's Drive) holds all the data: accounts, transactions, categories, rates, settings.
- **The Apps Script** bound to that sheet (`apps-script/`) is the API: it syncs with the app, fetches exchange rates daily, runs automations, recomputes taxes. It runs as the user and can only open this one spreadsheet.
- **The PWA** (`app/`) is a Preact web app installed to the iPhone home screen. It works offline and syncs when online. The hosted copy is code only: each phone connects to its owner's own script with a URL and a secret key typed into the app's Settings.

Features: expenses, income and transfers in any currency; balances, net worth, burn rate and runway; budgets; monthly reconciliation; debts with people; deposit interest and automations; taxes by accrual; tax residency day counting from location check-ins.

The repository holds no personal data. The demo data in `app/dev/mock-core.mjs` is made up.

## Your goal

Done means all of this is true:

1. The user has a Google Sheet "Finance OS" with the script bound to it, and `setup` ran without errors.
2. The web app is deployed; `curl -sL <URL>` answers `{"ok":true,"app":"finance-os"}`.
3. The PWA is hosted on HTTPS (Vercel is the easiest).
4. The app is on the user's home screen, Settings → Sheet connection → Test connection succeeds.
5. The user has added their accounts with today's balances, and knows where the key is and how to keep it safe.

Plan for 30–60 minutes with a beginner.

## How to work with a beginner

- First find out: do they have a Google account (a personal Gmail is best: some company Workspace accounts forbid public web apps), an iPhone (Android Chrome works too, without the iPhone Shortcut), a GitHub account (needed for the easy hosting route; free to create), and which country and time zone they live in.
- Then decide the route. If you can run commands on their computer (you are Claude Code, or another agent with a terminal), take **Route A**. If you can only chat, take **Route B**: the user does every step by hand while you guide them.
- One step at a time. Say what to click and what they should see next. Wait for them to confirm. Ask for a screenshot when something looks different.
- Explain the scary moments before they happen: Google's "This app isn't verified" warning is expected (it's their own script, see step 4).
- Never ask for their Google password. Never ask them to post the key anywhere public. They type the key into the app; you don't need to see it. If you must test the API with the key, read it from an environment variable for that one command and never write it to a file, a commit, your memory, or a log.

## Route A: you have a terminal

Needs Node.js 20 or later (`node -v`) and git.

### 1. Get the code

```bash
git clone https://github.com/techsters-ai/finance-os-public.git finance-os
cd finance-os
```

Optional, to show the user what they're getting: `cd app && npm install && npm run mock` in one terminal, `npm run dev` in another, open http://localhost:5173, and in Settings enter URL `http://localhost:8787/macros/s/dev/exec`, key `dev`.

### 2. Google side

1. The user turns on the Apps Script API: https://script.google.com/home/usersettings → "Google Apps Script API" → On.
2. Log clasp in (a browser opens; the user signs in and allows):
   ```bash
   npx @google/clasp@3.4.1 login
   ```
3. The user creates a blank spreadsheet at https://sheets.new, names it "Finance OS", sets File → Settings → Time zone to their own, and sends you its URL. The spreadsheet ID is the part between `/d/` and `/edit`.

### 3. Push the script

```bash
cd apps-script
npx @google/clasp@3.4.1 create-script --title "Finance OS API" --parentId <spreadsheet ID>
git checkout appsscript.json   # clasp replaced the manifest with a default one
```

Now set `"timeZone"` in `apps-script/appsscript.json` to the user's IANA zone (the same as the sheet's, e.g. `Europe/Berlin`), then:

```bash
npx @google/clasp@3.4.1 push --force
```

Don't pass `--type` to `create-script`: with `--type sheets` clasp ignores `--parentId` and makes another spreadsheet. `create-script` writes `.clasp.json` (the script ID) into `apps-script/`; it's in `.gitignore`, keep it out of commits.

### 4. Run setup (the user does this)

```bash
npx @google/clasp@3.4.1 open-script
```

In the editor that opens: pick `setup` in the function list at the top → Run. Google asks for permissions: Review permissions → choose the account → "Google hasn't verified this app" → Advanced → "Go to Finance OS API (unsafe)" → Allow. The warning appears because the user is the author of this script and hasn't sent it to Google for review; it only gets access to this one spreadsheet, outbound requests (exchange rates and the gold price), its own triggers and the spreadsheet menu.

The Execution log should end with `Self-test: ok: accounts 0, categories 17, transactions 0, rates …`. The spreadsheet now has its sheets (Accounts, Categories, Transactions, Settings, Rates…) and a Finance OS menu after a reload.

### 5. Deploy the web app

```bash
npx @google/clasp@3.4.1 create-deployment --description "v1"
```

It prints `Deployed <deploymentId> @1`. The URL is `https://script.google.com/macros/s/<deploymentId>/exec`. Check it:

```bash
curl -sL "https://script.google.com/macros/s/<deploymentId>/exec"   # → {"ok":true,"app":"finance-os"}
```

The user pastes this URL into the Settings sheet, `webapp_url` row, `value` column. Write the deployment ID down for the user (in a note on their computer, not in the repo): updates reuse it so the URL stays the same.

### 6. Host the PWA

Easiest: Vercel with GitHub.

- The user forks this repository on GitHub (Fork button), signs in to https://vercel.com with GitHub, Add New → Project → imports the fork → Root Directory: `app` → Deploy. They get `https://<name>.vercel.app`. Vercel redeploys on every push to the fork.
- Or from the terminal: `cd app && npx vercel deploy --prod` (the user logs in when asked; accept the detected Vite settings).

Any other static HTTPS host works: build with `cd app && npm ci && npm run build`, serve `app/dist`.

### 7. Phone

Go to [Phone and first data](#phone-and-first-data).

## Route B: chat only, the user does it by hand

1. **Sheet.** Open https://sheets.new, name it "Finance OS", File → Settings → Time zone → their own → Save.
2. **Script.** Extensions → Apps Script. Rename the project (top left) to "Finance OS API".
3. **Manifest.** Project Settings (gear on the left) → tick "Show "appsscript.json" manifest file in editor". Back in the Editor, open `appsscript.json` and replace everything with the contents of [`apps-script/appsscript.json`](apps-script/appsscript.json), changing `"timeZone"` to their zone (e.g. `"Europe/Berlin"`).
4. **Code files.** For each file below, in this order: click + next to Files → Script → type the name without `.js` → delete what's in it → paste the whole file from the repository's `apps-script/` folder (open it on GitHub, click "Copy raw file"). Files: `Admin`, `Api`, `Automations`, `Closes`, `Config`, `Fx`, `Income`, `Locations`, `Menu`, `Records`, `Setup`, `Sync`, `Taxes`, `Triggers`. Then delete the default `Code.gs` (⋮ → Delete) and press Cmd/Ctrl+S.
5. **Run setup.** Choose `setup` in the function list → Run → authorize as described in Route A step 4. The log should end with `Self-test: ok: …`.
6. **Deploy.** Deploy → New deployment → gear → Web app. Description "v1", Execute as: **Me**, Who has access: **Anyone** → Deploy → copy the Web app URL (it ends in `/exec`). Paste it into the Settings sheet, `webapp_url` row, `value` column.
7. **Host the PWA.** Create a GitHub account if needed, open this repository, click Fork. Sign in to https://vercel.com with GitHub → Add New → Project → Import the fork → Root Directory: `app` → Deploy. Copy the `https://….vercel.app` address.
8. Continue below.

## Phone and first data

1. The key: in the spreadsheet (reload it first), menu **Finance OS → App connection (URL and key)**. It shows the URL and the key. The key gives full access to the user's data: treat it like a password.
2. On the iPhone, open the `vercel.app` address in **Safari** (not another browser) → Share → **Add to Home Screen** → open the app from the new icon. Storage only becomes persistent in the home screen app.
3. In the app: Settings → Sheet connection → paste the Web app URL and the key → **Test connection**. Easiest transfer: the user emails or AirDrops the two values to themselves, or uses Universal Clipboard.
4. Accounts tab → + for each account: name, group (Liquid, Investments, Credit, Business, Debts), type, currency, the balance today as the opening balance. For every currency they hold that the **Rates** sheet doesn't list yet, add a row: the code in column A and `=GOOGLEFINANCE("CURRENCY:GBPUSD")` with their code in place of GBP in column C (a stablecoin: just 1).
5. Show them the basics: the board (center tab) — drag an account onto a category to record an expense, an income source onto an account for income; Home for net worth and runway; Settings → Data → Monthly reconciliation once a month.

## Optional extras

Offer these after the basics work, one at a time.

- **Tax residency.** The app counts days per country from check-ins. Settings → Tax residency → iPhone Shortcut has a recipe for a Shortcut that checks in on a schedule (iOS refuses the location to home screen web apps, so the Shortcut is the reliable way). Past travel can be added in Settings → Tax residency → Days.
- **TaxRates.** The sheet starts empty. For the countries the user lives in or visits, research the headline rates and residency rules from official tax authority sources and add one row each (columns in [docs/SCHEMA.md](docs/SCHEMA.md)), with the source URL and `as_of`. Say clearly that these are estimates, not tax advice.
- **Tax rules.** Settings rows `tax_interest_*` (interest taxed once a year over an allowance in one country) and `tax_business_*` (a share of business income plus a fixed monthly sum). Empty means off. See the notes in the Settings sheet.
- **Automations.** Settings → Automations: daily or monthly interest on savings, recurring expenses (rent, subscriptions).
- **Analytics sheets.** The app works without them. A user who likes spreadsheets can build Calc, Monthly and Risk sheets that the scripts read ([docs/SCHEMA.md](docs/SCHEMA.md)).

## Updating later

- Route A: `git pull`, then in `apps-script/`: `npx @google/clasp@3.4.1 push --force` and `npx @google/clasp@3.4.1 update-deployment <deploymentId> --description "…"` (keeps the URL). A push alone doesn't change what the `/exec` URL runs.
- Route B: paste the changed files, then Deploy → Manage deployments → pencil → Version: New version → Deploy (keeps the URL).
- The PWA: "Sync fork" on GitHub; Vercel redeploys. The app picks up the new version on its next launch.
- If an update adds a new synced sheet, run `setup` again first (it only adds what's missing), then update the script, then the app.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Test connection: `unauthorized` | Wrong key or a stray space. Copy it again from the menu. |
| Test connection: network error, or the response is a web page | The URL must end in `/exec` (not `/dev`) and the deployment must have Who has access: Anyone. Company Workspace accounts may not offer "Anyone": use a personal Gmail. |
| `Authorization is required`, `ScriptError` | Run `setup` again in the editor and allow the permissions. |
| A code change doesn't show | The deployment still runs the old version: `update-deployment`, or Manage deployments → New version. |
| Rates show `#N/A` or `Loading…` | GOOGLEFINANCE needs a minute; the currency code must be one Google Finance knows. Stablecoins are typed as 1. |
| `Location is off for this app` on Check in | iOS refuses location to home screen apps. Use the iPhone Shortcut from Settings → Tax residency. |
| The app was deleted from the home screen | Local data goes with it, but everything synced is in the sheet: install again, paste URL and key, Settings → Reload all data. |
| Something fails at night | Apps Script editor → Executions shows each run and its error. |

## Security rules

- Never commit, paste publicly or store: the key, the web app URL, the spreadsheet ID, `apps-script/.clasp.json`, `~/.clasprc.json` (clasp's login token). `.gitignore` covers the clasp files; check `git status` before every commit.
- If the user forks the repository publicly, their fork must stay code only: no exports, screenshots with amounts, or real names in commits.
- If the key may have leaked: menu Finance OS → Rotate access key, then paste the new key into the app.
- The `admin` API action (read, write and run code in the spreadsheet with the key) is **off** by default. If you need it to configure the spreadsheet for the user, ask them to turn it on (menu Finance OS → Turn on admin access) and to turn it off when you're done. Prefer having the user edit the sheet.
- Without the key the web app answers `unauthorized` to everything; a GET only says it's alive.

## Working on the code

| Path | What |
|---|---|
| `app/` | The PWA: Vite + Preact + TypeScript, `idb`, Workbox. Details in [app/README.md](app/README.md) |
| `app/src/domain/` | Pure logic (money, fx, balances, reconciliation, taxes, residency), unit-tested |
| `app/src/data/` | IndexedDB, the store (signals + outbox), the sync protocol |
| `app/src/ui/` | Screens and components |
| `app/dev/` | Mock Apps Script server with made-up data (`npm run mock`) |
| `apps-script/` | The server: `Api.js` (entry), `Sync.js`, `Records.js`, `Setup.js` (sheet bootstrap), `Automations.js`, `Taxes.js`, `Income.js`, `Closes.js`, `Locations.js`, `Fx.js`, `Triggers.js`, `Menu.js`, `Admin.js`, `Config.js` (sheet names, field types) |
| `tests/` | Node tests that run the Apps Script files in a VM with mocked Google services |
| `docs/` | [Spreadsheet schema](docs/SCHEMA.md), [setup and API reference](docs/SETUP.md) |

Commands: `cd app && npm test` (Vitest), `npm run build` (typecheck + build), `node --test tests/apps-script.test.mjs` (server). CI runs all three.

Conventions: the product language is English (UI, sheet headers, docs). Amounts are stored in the account's currency with `amount_usd` at entry time. Sync is last-write-wins by `updated_at` with a `server_ts` cursor; a synced field needs to exist in the sheet header, `Config.js` `FIELD_TYPES`, `domain/types.ts` and `domain/normalize.ts`. Keep test and demo data made up.
