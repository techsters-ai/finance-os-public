# Finance OS: PWA

A mobile app for logging expenses, income and transfers. It works offline (IndexedDB) and syncs with the Google Apps Script web app bound to the "Finance OS" spreadsheet.

The code holds no data, spreadsheet IDs or keys. The web app URL and the secret key are entered in the PWA Settings and stored only on the device.

Stack: Vite + Preact + TypeScript, `idb`, `vite-plugin-pwa` (Workbox), Vitest.

## Quick start

```bash
cd app
npm install
npm run mock      # mock Apps Script at http://localhost:8787
npm run dev       # PWA at http://localhost:5173/
```

In the PWA Settings enter:

- URL: `http://localhost:8787/macros/s/dev/exec`
- Key: `dev`

Then tap "Test connection". The mock serves a made-up person: $32,670 across eleven accounts (Liquid, Investments and Business) in USD, EUR, USDT and gold, the starter categories, a few transactions this month, five automations, a year of made-up travel for Tax residency and a few sample TaxRates rows, plus `metrics` and six months of `history`. None of it is real.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run mock` | mock server for the sync protocol (data in memory) |
| `npm test` | Vitest: domain logic, sync against the mock, contract test against the real Apps Script code |
| `npm run build` | typecheck + production build into `dist/` |
| `npm run preview` | serve `dist/` locally |
| `npm run icons` | regenerate the PNG icons in `public/` |

### Mock server

```bash
node dev/mock-server.mjs [--port 8787] [--key dev] [--persist dev/.mock-state.json] [--latency 300]
```

- The protocol matches the contract exactly: `action: 'sync' | 'ping'` (there is no `admin`), the response is always HTTP 200, errors come in the body. A sync response also carries `metrics` and `history`.
- A POST to a path ending in `/exec` answers with a 302 redirect and the response is fetched with a GET, like the real Apps Script. A POST to any other path returns JSON right away.
- `--persist` saves the state to a file so it survives a restart. Use it to test offline mode: stop the mock, enter a transaction, start the mock again, and sync catches up.
- `GET /__state` returns the whole "spreadsheet".
- The protocol core lives in `dev/mock-core.mjs`. The sync tests use it too.

## Layout

```
src/
  domain/      pure logic, no DOM or IndexedDB (covered by tests)
    money.ts        rounding, en-US formatting, calculator
    fx.ts           rates: rates[c] = USD per 1 unit
    balances.ts     account balances, net worth by group, runway
    transactions.ts builds a record by the sign rules
    reconcile.ts    reconciliation → adjustment, monthly wizard
    metrics.ts      month spending by category, budgets, period analytics
    normalize.ts    converts spreadsheet records to typed records
  data/
    db.ts       IndexedDB: records, outbox, meta; applies a sync response atomically
    store.ts    in-memory signals, mutations (record + outbox op in one transaction)
    sync.ts     protocol, 2 s debounce, retries, triggers
  ui/          screens and components
dev/           mock server
scripts/       icon generator
```

## Screens

Tab bar: Home, Accounts, the board (center), History, Settings. The app opens on the board (no hash = `#/board`); Home is `#/`. The UI is in English: amounts use en-US formatting (`$1,234.50`), dates are written in English.

- **Home** (`#/`): the $ / € / £ display currency switch at the top (every USD total in the app follows it, converted at the current rate), a net worth card with Liquid / Investments / Business (Business only if there is a business account) and two runway figures, in months and years: liquid net / burn and net worth / burn ("total"), where burn is the spreadsheet's `BURN` named range when it has one, otherwise personal spending a month over the last `burn_window_months` (6) whole months that had any. Tapping the card hides or shows amounts. Below it are income and expense analytics for a chosen period (this month, last month, last 3 / 6 / 12 months, this year, all time, or a custom range; arrows step to the previous and next period): KPIs (income, expenses, saved and savings rate), a chart with a ring / bars toggle: the ring fills up toward the period's budget (green, yellow from 75%, red over it) with a tick where an even pace would be today; the bars show income vs expenses by month, or daily spending for a single month, with budget progress below. Every number of the budget (expenses, ring, categories) is personal day-to-day spending; business and investment costs, and taxes paid from personal accounts, show as "+ $X not budgeted" under Expenses and in a "Not in the budget" list, and Saved subtracts them (the burn rate leaves them out too); the budget leaves out a category on every board (Taxes); and a breakdown by category (expenses / income / tags). A category with tagged transactions expands into its tags (plus "No tag"). A month with no income or expense transactions at all falls back to the History sheet's monthly totals. The card also shows "Owed to you" and "You owe" when there are open debts.
- **Transactions board** (`#/board`, the center button with the coins icon), The header runs edge to edge from the very top: the $ / € / £ display currency switch, the Total / Liquid (including credit cards) / Investments / Business switcher (Total = all of them, debts aside), the period on the right (tap it for presets or a custom range; budgets scale to its months) and the period's Expenses (without the shared row: Taxes) / Balance for that group / Income of every account (the income row doesn't depend on the board), Expenses over the first coin column and Income over the last. Below are a paged row of income sources (all one light blue), a paged row of accounts (each coin is labeled with the account type, e.g. Card or Savings; the icon and currency tell them apart, the full name is in the account screen) and a grid of the board's own expense categories (`Category.scope`; Total shows all), with a **More** coin for the other boards' categories (drop an account on it or tap it to pick one; Settings → Categories → "Show on the board" keeps one on a board for good); category coins turn light green, yellow (from 75% of the budget) or red (over it); gray without a budget. Amounts are shown in full up to 9,999,999 and compact from ten million, all in one font size. Below the grid, a shared row on every board holds Taxes (and any category shown on all three boards) and **Debts**: what people owe you in green, what you owe in red. Each board shows its own numbers (Taxes paid from its accounts this month; people whose latest transfer was with its accounts); Total adds them up. Hold a coin and drag it: income → account records income, account → category records an expense, account → account records a transfer, account → Debts gives money (lend or repay), Debts → account gets money (borrow or get repaid); both Debts drops open a list of people with a field to add a new person. A tap is the quick path: an income source opens its month as a sheet (`#/categories/:id/view?board=…`: the board's accounts only, like the coin, with a switch to all accounts; the total, one line per account with the month's sum, each expandable into its payments; arrows step through months; Add records a new one), an expense category opens its screen (see below), an account opens the account screen as a sheet from the bottom (`#/accounts/:id/view`: the balance as a big number, tap it to type the actual balance on the reconciliation keypad; name and "Hide with 0 balance" below it, then the account's transactions; "Transfer to another account" picks the destination and opens the transfer; "All settings" opens the full editor), Debts opens the list of people. Accounts stand in the Accounts screen's order (`domain/order.ts`): its sections in turn (Liquid with credit cards, Investments, Business), `sort` within a section, so a credit card can sit among the liquid accounts. The sync status lives in Settings only. **Keep holding a coin still** (about 0.65 s) to enter edit mode: coins jiggle, a coin dropped on another coin of its row takes its place (the new order is saved as `sort` and shows on the Accounts screen too; an account moves only within its section), and × removes it (hide or archive an account, archive a category). Done or a tap on empty space ends it. Zero-balance and hidden accounts stay out of the accounts row; the eye coin at its end shows them.
- **Entry** (`#/entry`): prefilled from the query params `type` (`expense` | `income` | `transfer`), `cat`, `account`, `to` and `amount`; when neither amount is in the display currency, the amount also shows in it (≈ €1,850); a transfer puts From → To on their own row so long names fit; `tx` opens an existing transaction for editing. The Tags button next to the note picks global tags (the ones used with the category come first) or adds a new one. A transfer to or from a person shows what the balance with them will be.
- **History** (`#/history`): filters by `account`, `category`, `tag` and `month`; the account filter also lists archived accounts that have transactions. Transfers with a person read "Gave to Alex" / "Got from Alex". The list shows 150 transactions at a time.
- **Current tax residency** (a card under net worth, above Taxes to set aside): the residency set (a country, Nowhere or not set) with its days against its rule (41/183); for Nowhere or not set, the country closest to its rule. When the country you're in is 14 days or less from its rule, the card says so in orange. A tap opens the Tax residency screen as a sheet (`#/residency/current`), the same as in Settings.
- **Taxes to set aside** (a card under net worth), in two parts. **Territorial**: due where the income is earned. **Resident**: an estimate for the country of residence — income since Jan 1 on accounts in other countries (an account's `country`; none = abroad) × its TaxRates `foreign_rate`, less the taxes due where it was earned (the rules' accrual this year and tax withheld); empty when resident nowhere or not set, and it changes with the residency. Both count in the total and come off net worth. The territorial part: the taxes accrued and not yet paid (the server's Taxes sheet, by the rules in Settings: interest over a yearly allowance in one country, a business share of income plus a fixed monthly sum), also taken off net worth, the liquid money and the business. A tap opens the breakdown by rule and period (a year for interest, a quarter for the business); payments in Taxes from the rule's account settle the oldest period first. A period offers Pay (the entry screen, the amount filled in), Already paid (a mark: it's in the balances, no transaction) and Delete (a mark: not owed, off the accrual too); marks show under the rules, a tap undoes one. The card counts a new mark at once, the server a minute after the sync.
- **Pull to refresh** (Home): drag the screen down from the top to sync; a gear turns with the pull and spins until the sync is done.
- **Average a month** (Home, under the net worth card): personal expenses and what's left (income less every expense, taxes by accrual) a month over whole months, YTD or the last 12, with the same switch as Capital allocation.
- **Capital allocation** (Home, under the analytics): gross assets by class (Cash; Deposits = savings and term deposits; Fixed Income = bonds and bond funds; Stocks, Crypto, Commodities, Loans; a class expands into its accounts) with the realized return in USD since Jan 1 (YTD) or over 12 months, as if each account was held all along: interest at its current rate after tax for the time elapsed, plus reconciled revaluations for stocks and crypto except stablecoins (kept from the account's first day in the app), times the actual move of its currency against USD from the daily rates history (gold: its price), before currency moves too, and the weighted risk (1–7); the share of each class against a benchmark (your target from the Risk sheet, 60/40 or All Weather) over assets except cash, loans to people and the emergency fund, where deposits and bonds count as one "Bonds & deposits" class (a target row may also say Fixed Income, Bonds or Deposits); and the Risk sheet's concentration limits with OK / Near (from 90%) / Over. Both the classes and the benchmark switch between bars and a donut (the benchmark as two rings: now outside, the target inside); class colors are fixed per class (the dataviz reference palette, slots 1, 2, 7, 3–6, validated as a ring in both themes).
- **Accounts** (`#/accounts`): sections Liquid (credit cards included), Investments, Business and Debts, top to bottom in the board's left-to-right order. Hold a row still (about 0.35 s), then drag it up or down within its section: the other rows make room, the new order is saved as `sort` and the board follows; near the top or bottom of the screen the list scrolls by itself.
- **Debts**: a person is an account in the Debts group (Accounts → +, or the new-person field after a Debts drop on the board) with a currency, an optional opening balance (positive: they owe you) and a due date. The person's card has **Get repaid** / **Repay**: pick the account and the entry screen opens with the whole balance filled in. Debts are the last group on the Accounts screen.
- **Deposit interest paid elsewhere**: a deposit's settings have "Interest paid to" (another account, e.g. the bank's dollar card). Interest income recorded there, in that account's currency, still belongs to the deposit: the Interest screen (tap the Interest coin) says which deposits pay into an account and lists each deposit with the interest it received that month against the expected (today's balance × the rate after tax ÷ 12; deposits paying into one account share its interest by expected interest; under 90% of it in a past month shows red).
- **Automatic tax**: an account's settings (and its sheet from the board, when it has a tax rate) have "Automatic tax" for banks that withhold it, and "I enter the amount": after tax (what arrived) or before tax. Each income recorded there, and Interest a deposit with it pays out to another account, gets a Taxes expense on the same account and day (id = the income's id + `-tax`; the entry screen shows it under the amount); the income is grossed up when typed after tax, so income − tax = what arrived. Editing the income shows the typed amount again and updates the tax; deleting it deletes the tax.
- **Expense category screen** (tap a category coin on the board, `#/categories/:id/view`): what it took in the board's period as a big number against the budget, Add expense, name and monthly budget, All settings, then its transactions.
- **Swipe to delete**: swipe any transaction row left (History, account and category screens) for a red Delete button.
- **Automations** (listed right in Settings, under Tax residency; a rule opens at `#/automations/:id`, a new one at `#/automations/new`): rules the server runs by itself — interest on an account's balance at the rate on its card, daily or on a day of the month (balance at the start of the day × rate × days since the previous accrual ÷ 365), into the account or where it pays interest ("Paid to" is the account's own setting, editable here); and fixed expenses off an account into a category, weekly, monthly on a day or yearly. The editor opens as a sheet like an account's, with the next run as a big number. The transactions arrive with the next sync, tagged #auto; a deleted one isn't recreated.
- **Tax residency** (Settings, under Sync, and the Home card): a warning on top when the country you're in is 14 days or less from its day rule; Tax resident in — Nowhere (first in the picker) or a country: the picker lists the countries you've been in this year by days, then the rest alphabetically, and a country opens its card first (its taxes for a resident, the day rule and every way to become a resident there, the source; Back / Choose). Picked by hand, it's in use at once and saved in the sheet's Settings as `tax_residency` in the background (offline: with the next sync) or set by the server when a country's rule is met (TaxRates `threshold_days` in its `window`: the calendar year or any 12 months), with how it was set; and its headline rates from the TaxRates sheet: domestic income, foreign income, capital gains tax and the residency rule. Then days per country YTD, over the last 12 months (how a 12-month rule counts) or a past year (‹ › through the years with days), each against the country's residency threshold (TaxRates `threshold_days`; 183, Thailand 180, without a row) as a bar; a tap on a country opens its days on a ring (`ResidencyChart.tsx`): a year around a clock face, Jan 1 at the bottom and summer on top, months clockwise, the seasons outside, the days there filled in over YTD, the 12 months up to today (the default for a 12-month rule: the ring wraps through today) or a past year (‹ › steps through the years with days; last year by default, so on Jan 1 it moves on by itself); a tap on the ring names the day, and the stays below list the dates; a day counts for every country you were in (a flight day for both ends, a same-day connection for neither), a day without a check-in where the day before ended (`domain/residency.ts`). Today's country with Check in (the phone's location → the server finds the country, `data/location.ts`; when iOS refuses the location — iOS 26 does to Home Screen web apps whatever the settings say — it runs the "Finance OS check-in" shortcut instead and syncs on the way back), the iPhone Shortcut recipe (a shortcut posting `action: 'checkin'` and showing the answer's `notify` as a notification — the residency warnings — run by Time of Day automations at 09:00 and 21:00, with Copy name / URL / key), and Days (`#/residency/days`, a sheet): every day newest first, assumed ones grayed; a tap opens the day to add or remove countries in order (the last is where it ended) and a note; removing them all makes it assumed again.
- **Hidden accounts**: an account card has a "Hide with 0 balance" switch (on: out of the board and lists while the balance is 0; off: always shown) and a Hide account action that hides it for good. Hidden accounts drop out of the board, the Accounts list and the account pickers but still count in totals; "Show hidden" brings them back on the Accounts screen, on the board (the eye coin) and in pickers.
- Screens remember their scroll position: Cancel or Back from an account card returns to the same place in the list.
- Account and category screens (`#/accounts/:id…`, `#/categories/:id`) open as sheets that slide up over the screen they came from (`PageSheet.tsx`): swipe down from the bar or from the top of the content, tap the dimmed part or press Escape to close the whole stack.

Account icons are a tile in the account's color with an icon for its type (card, bank account, savings, cash, stocks, bonds, crypto, gold, business, person): `AccountIcon` in `src/ui/components.tsx`.

### Sync

- The request is a POST with `Content-Type: text/plain;charset=utf-8` to avoid a CORS preflight: Apps Script can't answer OPTIONS.
- Ops go out in batches of at most 200 per request, and the loop runs until the outbox is empty.
- The outbox keeps one op per record (key `entity:id`), so repeated edits collapse. After a successful response the op is removed unless it was overwritten during the request.
- An incoming record overwrites the local one unless there is a pending op for it with a newer `updated_at`.
- Besides records, each response carries `rates`, `settings`, `metrics` (`burn`, `essential`, `passive`, `work_income`, `savings`: USD per month from the spreadsheet's named ranges) and `history` (History sheet rows: `{ month: 'YYYY-MM', category_id, amount_usd }`). They are stored in IndexedDB `meta` as `rates`, `server_settings`, `server_metrics` and `history`.
- Sync runs on start, ~2 s after an entry, on returning to the app (`visibilitychange`), when the network comes back, every 30 s while the outbox isn't empty, and on the "Sync now" button.
- "Reload all data" sends `since = null` and deletes local records that aren't on the server. Unsent records are kept.

### Reconciliation

- delta = actual − calculated. An `adjustment` transaction is **always** created, including when delta = 0 (amount 0, note "Reconciliation"): the spreadsheet uses it to see the account's last reconciliation date.
- The "Matches" button saves a zero reconciliation in one tap.
- The reconciliation category depends on the account type:
  - stocks, bonds, crypto, commodity → `sys_revaluation`;
  - deposit, flexible → `inc_interest`;
  - card, cash, credit → `sys_correction`.
- The "Monthly reconciliation" wizard goes through every account that isn't archived: investment first, then liquid, business and credit. A step can be skipped, and then nothing is written for that account.
- Reconciling an account with no transactions yet (none on or after its opening date) sets its opening balance instead of booking a correction.
- History shows an `adjustment` as "Reconciliation" with a signed amount. System categories don't appear on the board or in the entry category picker.
- From the 1st to the 7th a reminder shows (a banner on Home, a dot on the Accounts tab) until this month's wizard is done. The mark is stored locally.

### IDs of new records

- Transaction: a full uuid v4.
- Account: `acc_` + 10 hex.
- Category: `exp_` / `inc_` + 10 hex (the prefix follows the final kind).

## Deploy

Any static host works: the build is plain files in `dist/`. Navigation uses the hash (`#/history`), so no server rewrites are needed, and the base path is `/`.

- **Vercel** (the easiest): import the repository, set Root Directory to `app`; `vercel.json` holds the build settings.
- **Any other static host** (Netlify, Cloudflare Pages…): build in `app/` with `npm ci && npm run build` and serve the `app/dist` folder over HTTPS.

`.github/workflows/ci.yml` runs the tests and the build on pushes to `main` and on pull requests.

The hosted app holds no data: each phone talks to its owner's own Apps Script, with the URL and key typed into Settings.

## On iPhone

1. Open your deployed URL in Safari.
2. Tap Share → "Add to Home Screen".
3. Launch it from the icon. That makes storage persistent: the app calls `navigator.storage.persist()`, and the status is shown in Settings.
