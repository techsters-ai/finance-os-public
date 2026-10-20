# Finance OS

A personal finance app you run on your own Google account: an iPhone PWA for logging expenses, income and transfers in any currency, backed by a Google Sheet that keeps every number. No sign-up, no shared server, no subscription.

```
iPhone PWA (static files, any host)  ──POST + key──▶  Apps Script web app  ──▶  Google Sheet "Finance OS"
IndexedDB + offline queue                               (bound to the sheet)       all the data
```

**Set it up with an AI agent.** Send the link to this repository to Claude (or another coding agent) and say "make this work for me". [AGENTS.md](AGENTS.md) walks it, and you, through every step: the sheet, the script, hosting the app, the phone.

## What it does

- A board of coins: drag an account onto a category to record an expense, an income source onto an account for income, one account onto another for a transfer or an exchange.
- Accounts in any currency, grouped as liquid, investments, credit, business and debts with people; net worth, burn rate and runway in months.
- Budgets by category, income and expense analytics by period, tags.
- Monthly reconciliation: type the actual balance, the difference is booked as a correction, interest or revaluation.
- Deposit interest and recurring expenses as automations the server runs every morning.
- Capital allocation by asset class with realized returns, risks and concentration limits.
- Taxes by accrual (withheld at source, interest over an allowance, a business share) and what to set aside.
- Tax residency: days per country from location check-ins (an iPhone Shortcut), against each country's day rule, with a warning 14 days before you'd become a resident.
- Works offline; syncs when the network is back.

## Try the demo

```bash
cd app
npm install
npm run mock   # a made-up person's data at http://localhost:8787
npm run dev    # the app at http://localhost:5173
```

In the app's Settings enter URL `http://localhost:8787/macros/s/dev/exec` and key `dev`.

## Repository

| Folder | Contents |
|---|---|
| `app/` | The PWA: Vite + Preact + TypeScript, offline sync ([app/README.md](app/README.md)) |
| `apps-script/` | The Google Apps Script API: sync, sheet setup, rates, automations, taxes, check-ins, spreadsheet menu |
| `tests/` | Node tests for the Apps Script code |
| `docs/` | [Spreadsheet schema](docs/SCHEMA.md), [setup and API reference](docs/SETUP.md) |

Tests: `cd app && npm test && npm run build`, and `node --test tests/apps-script.test.mjs`. CI runs both on every push.

## Privacy

Your data lives on your phone and in your own Google Sheet. The hosted app is code only, and the script can open only the spreadsheet it's bound to. This repository holds no personal data: the demo and test data are made up.

Tax figures in the app are estimates for planning, not tax advice.

## License

[MIT](LICENSE)
