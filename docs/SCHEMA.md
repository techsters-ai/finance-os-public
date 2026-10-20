# Finance OS spreadsheet schema

Your data lives in one Google Sheet in your own Google Drive, called "Finance OS" by convention. Its ID never goes into the repository. The `setup` function (spreadsheet menu → Finance OS → First-time setup, or Run in the script editor) creates every sheet below that's missing, with its header row and starter values. Running it again changes nothing.

Columns are found by their header, so you can reorder them or add your own, but don't rename them.

## Data sheets

These are created by `setup`. The first six are synced with the PWA: each row has `updated_at` and `server_ts`, and edits made by hand in the sheet are stamped by the `onEditStamp` trigger, so the app picks them up.

| Sheet | What it holds | Written by |
|---|---|---|
| Accounts | One row per account: `group` (`liquid` / `investment` / `credit` / `business` / `debt`); `type` (`card`, `current`, `business`, `cash`, `flexible` savings, `deposit`, `bonds`, `stocks`, `crypto`, `commodity`, `credit`, `loan` for a person); `currency`; `institution`; `country`; `opening_balance` and `opening_date`; `apr_gross`; `tax_rate`; `maturity_date`; `insured_limit`; seven risk axes from 1 to 7 (`risk_price`, `risk_country`, `risk_legal`, `risk_custody`, `risk_credit`, `risk_currency`, `risk_liquidity`); `in_emergency_fund`; `visibility` (`auto` / `show` / `hide`, empty = `auto`); `interest_to` (the account a deposit pays its interest into; empty = the deposit itself); `auto_tax` (tax the bank withholds: empty = off, `net` = the income you type is what arrived, `gross` = it's before tax) | PWA, by hand |
| Categories | Expense and income categories: `kind` (`expense` / `income` / `system`), `parent_id`, `budget_usd` a month, `essential`, `icon` (an emoji), `color`, `scope` (which boards show an expense category: `liquid`, `business`, `investment`, comma-separated; empty = `liquid`; all three = a shared category such as Taxes) | PWA, by hand |
| Transactions | The ledger, see below | PWA, automations |
| Automations | Rules the server runs by itself: `kind` = `interest` / `expense`, `account_id`, `frequency` (`daily` / `weekly` / `monthly` / `yearly`), `day` of the month, `category_id` (interest: empty = Interest), `amount` (expense, in the account's currency), `start_date` (weekly: sets the weekday; yearly: the date), `last_run` (set by the server), `active`, `note`, `deleted` | PWA, by hand |
| TaxMarks | Tax periods settled from the app without a payment: `rule`, `period` (`2026` or `2026-Q3`, as text), `action` (`paid` = paid already, it's in the balances; `deleted` = not owed), `amount` in the rule's currency, `currency`, `date`, `note`, `deleted` (= undone) | PWA |
| Locations | Where you were, for tax residency: one row a day, `id` = `loc_<date>`, `countries` = ISO 3166 codes in the order you were there, space-separated, the last one where the day ended (`PT TH`), `city` of the latest check-in, `source` (`shortcut` / `app` / `manual` / `import`), `note`, `deleted` | iPhone Shortcut, PWA |
| TaxRates | Headline personal tax rates by country, as text, one row per country you care about: `country` (ISO code), `domestic_income`, `foreign_income`, `capital_gains`, `residency_rule`, `residency_tests` (every way to become a resident there, one a line), `threshold_days` (days that make you a resident; 183 when empty), `window` (`year` = the calendar year, `12m` = any 12 months in a row), `foreign_rate` (the share of foreign income the app sets aside as a resident there, your estimate), `note`, `as_of`, `source` (a URL), `confidence` (`high` / `medium` / `low`; the app flags `low`). Starts empty: fill in the countries you live in or travel to, from official sources, and check them with a tax adviser | by hand |
| Rates | Current rates: `currency`, `pair`, `usd_per_unit` (USD per 1 unit), `units_per_usd`, `exp_change_yoy` (optional). Quoted currencies use `=GOOGLEFINANCE("CURRENCY:EURUSD")`; stablecoins are pegged at 1 (edit them by hand if they de-peg); gold (XAU) reads its daily price from RatesHistory. Add a row for every currency you hold | GOOGLEFINANCE, by hand |
| Settings | `key` / `value` / `note`: model parameters, see below | by hand, PWA, Apps Script |
| Snapshots | Account balances on the 1st of each month: `date`, `account_id`, `account_name`, `balance`, `usd_per_unit`, `balance_usd`, `source` | Apps Script (daily job) |
| History | Optional monthly totals for months before your first transactions: `month` (`YYYY-MM`), `category_id`, `amount_usd` (signed), `note`. Used only for months that have no income or expense transactions | by hand |
| RatesHistory | Daily rates: `date`, `currency`, `usd_per_unit`. The daily job adds each day from a free currency API on jsDelivr (`Fx.js`) and gold from a gold price API; pegged currencies are copied from Rates. `backfillRatesHistory_('YYYY-MM-DD')` in the script editor fills past days | Apps Script |

### Generated sheets

The scripts create and rewrite these; don't type into them.

| Sheet | Contents |
|---|---|
| Taxes | `Taxes.js`, per month from `history_start`: taxes accrued (row 2), paid (row 3, every expense in a shared Taxes category), the owed total (row 4), then each rule's accrued, paid and owed, tax withheld at source and taxes paid without a rule. Recomputed a minute after a sync with changes, daily, and from the menu. Sync sends the summary to the app as `taxes` |
| Income | `Income.js`: income by the month it was earned. Income on the accounts in `income_lag_accounts` moves back `income_lag_months`; row 2 is the shift (earned − received) per month, rows 3–4 received and earned |
| Closes | `Closes.js`: one row a month written on the 1st: income, expenses, essential, business and investment costs, taxes accrued and paid, savings and its rate, the burn rate, and the capital at the month's end from the snapshot of the 1st (net worth, liquid, investments, business, owed to you, you owe, runway). Redone daily until `close_freeze_day`, then final |

### Optional analytics sheets

The app works without these. If you build them, the scripts read them:

| Sheet | What the scripts read |
|---|---|
| Calc | Named ranges `BURN`, `ESSENTIAL`, `PASSIVE`, `WORK_INCOME`, `SAVINGS` (USD a month), sent to the app as `metrics`. Without `BURN` the app works the burn rate out from your transactions |
| Monthly | Months as dates in row 1 from column G; rows 2–5 income, expenses, essential, savings, rows 8–10 business costs, investment costs, taxes. Closes copies them; without the sheet those Closes columns stay empty |
| Risk | Concentration limits as `Dimension | Value | Limit` rows, and a target allocation as `Class | Target` rows under a "Target allocation" title, ending at a "Base" row. The app's Capital allocation shows them |

## Settings

| Key | Meaning |
|---|---|
| `base_currency` | `USD`: every total is kept in USD; the app's switch shows it in $, € or £ |
| `second_currency` | Shown next to USD in the app's Settings |
| `history_start` | First month of the Taxes and Income sheets |
| `burn_window_months` | Burn rate = average personal spending over this many whole months (6) |
| `close_freeze_day` | Last month's Closes row and the snapshot of the 1st are redone daily until this day (7) |
| `high_risk_threshold` | Capital allocation: an account whose average risk (1–7) is above this counts as high risk (3.5) |
| `webapp_url` | The web app's `/exec` URL, shown by the menu "App connection" |
| `tax_residency` | A two-letter country code, `NONE` = nowhere, empty = not set. Set from the app (`action: 'set_setting'`) or by the server when a country's day rule is met; `tax_residency_set` says how |
| `tax_accrual_start` | Taxes accrue from this day; before it, a month's taxes are what was paid |
| `tax_interest_country`, `tax_interest_rate`, `tax_interest_currency`, `tax_interest_allowance_<year>` | The interest rule, for a country that taxes deposit interest once a year over a tax-free allowance: interest on accounts whose `country` matches (type it the same way, e.g. `DE`), pooled per calendar year, over the year's allowance (in that currency) at the rate. Off while the country or the rate is empty |
| `tax_business_rate`, `tax_business_fixed`, `tax_business_fixed_currency`, `tax_business_since` | The business rule: a share of the income on business accounts plus a fixed sum a month, from a date, accrued by quarter. Off while both are empty |
| `income_lag_accounts`, `income_lag_months` | Accounts paid a month (or more) after the month the income is for: the Income sheet moves their income back |

A tax payment (an expense in the Taxes category) settles the rule of the account it's paid from: a business account → the business rule, an account in the interest country → the interest rule; any other is listed as paid without a rule. Taxes a bank withholds (`auto_tax`) are booked with each income as a `<income id>-tax` expense and count as accrued and paid at once.

## Accounts

**Groups**: `liquid` (cards, cash, savings), `investment`, `credit` (credit cards, negative balance), `business` and `debt` (people).

**Debts.** Each person you lend to or borrow from is one account in the `debt` group (type `loan`) in any currency. A positive balance means they owe you, a negative one means you owe them. Lending, borrowing and repayments are ordinary transfers: from your account to the person's means you gave money (lent or repaid), from the person's to yours means you got it (borrowed or were repaid). `maturity_date` is the due date. Lending and borrowing don't change net worth; what you owe also reduces liquid net.

**Visibility** only affects the app's lists: `auto` hides an account while its balance is 0 (credit cards excepted), `show` never hides it, `hide` always does. Hidden accounts still count in every total; `archived` is what takes an account out of the totals.

**Budgeted or not.** An expense is business or investment spending, kept out of the budget, the burn rate and runway, when its category belongs to the Business or Investments board only (say, Software or Fees), whoever pays. A shared category (Taxes) is a bucket of its own: outside the budget and the burn rate. Every other category is personal, even when a business account pays (`app/src/domain/scope.ts`).

## Transactions

| Field | Meaning |
|---|---|
| `type` | `expense` / `income` / `transfer` / `adjustment` |
| `amount` | Signed, in the account's currency: expense < 0, income > 0, transfer < 0 on the source account |
| `to_account_id`, `to_amount` | Transfers only; `to_amount` > 0 in the receiving account's currency (a currency exchange is one row) |
| `orig_amount`, `orig_currency` | The amount as typed when it was in another currency |
| `usd_rate`, `amount_usd` | The rate at entry time and the amount in USD, so history doesn't drift with rates |
| `tags` | Lowercase, comma-separated (`groceries, trip`); any tag works with any category |
| `deleted` | Soft delete |
| `server_ts` | Set by the server; the sync cursor |

Account balance = `opening_balance + Σ amount + Σ to_amount` over non-deleted transactions dated on or after the account's `opening_date`. Older transactions are history only: the opening balance already includes them. Future-dated ones count.

**Reconciliation** creates an `adjustment` for the difference between the actual and the calculated balance, including a zero one (that records the reconciliation date). Its category depends on the account type:

- stocks / bonds / crypto / commodity → `sys_revaluation` (Revaluation);
- deposit / flexible → `inc_interest` (Interest), unless the interest is recorded otherwise (paid to another account, or booked by an interest automation): then no category, a plain balance correction;
- card / current / business / cash / credit → `sys_correction` (Correction: unrecorded spending, counts as an expense).

**Automations** record transactions with ids `auto_<rule>_<date>`, tagged `auto`; a deleted one isn't recreated. Interest = balance at the start of the day × the account's `apr_gross` × days since the previous accrual ÷ 365, into `interest_to` or the account itself, with a `-tax` row when the account has `auto_tax`.

## What else sync returns

Besides the six synced sheets, every sync response includes:

- `rates`: Rates column A (currency) → column C (USD per unit);
- `settings`: the key/value pairs of Settings;
- `metrics`: the Calc named ranges, when they exist;
- `history`: History rows as `{ month, category_id, amount_usd }`;
- `allocation`: realized-return rates from RatesHistory (`fx`: `ytd`, `y1`, `now`), plus the Risk sheet's targets and limits when it exists;
- `taxes`: the Taxes summary (owed per rule and period);
- `taxRates`: the TaxRates rows, only when they changed since the app's last copy (`taxRatesHash`).

## Key metrics

- **Net worth**: the sum of account balances in USD (credit balances are negative; debts are positive when people owe you), less taxes owed.
- **Liquid net**: liquid + credit + what you owe people, without business and without what people owe you.
- **Burn rate**: average personal spending over the last `burn_window_months` whole months that had any.
- **Runway**: liquid net / burn and net worth / burn, in months.
