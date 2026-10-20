// A category's money for a month, opened from its coin on the board: one line per account with the month's sum
// (income into the same account adds up), each expandable into its payments. Arrows step through months.
// Interest also shows by deposit: what each received (paid out to another account too) against what it should.
import { useState } from "preact/hooks";
import {
  accounts,
  accountsById,
  automations,
  balances,
  categoriesById,
  currencyOf,
  liveTransactions,
  rates,
} from "../../data/store";
import type { Transaction } from "../../domain/types";
import {
  addMonths,
  currentMonth,
  monthEnd,
  monthLabel,
  monthStart,
  plural,
  shortDay,
} from "../../domain/dates";
import { txUsd } from "../../domain/metrics";
import { depositInterest } from "../../domain/interest";
import { INC_INTEREST, interestRecorded } from "../../domain/reconcile";
import { parseTags } from "../../domain/tags";
import {
  AccountIcon,
  Empty,
  Money,
  NavBar,
  NavButton,
  Row,
  Usd,
  cx,
  shownCurrency,
} from "../components";
import { IconBack, IconChevron } from "../icons";
import { SwipeRow } from "../SwipeRow";
import { removeTransaction } from "../TxList";
import { back, navigate } from "../router";
import { resolvePeriod } from "../period";
import { boardPeriod } from "../prefs";
import { GROUPS } from "./Board";
import { ExpenseCategoryScreen } from "./ExpenseCategoryView";

interface AccountSum {
  accountId: string;
  amount: number;
  usd: number;
  txs: Transaction[];
}

/** A category's coin opens this: an expense category its own screen, an income source its month. */
export function CategoryRoute({ id, board }: { id: string; board?: string }) {
  return categoriesById.value.get(id)?.kind === "expense" ? (
    <ExpenseCategoryScreen id={id} />
  ) : (
    <CategoryViewScreen id={id} board={board} />
  );
}

/** The board's month when its period is one whole month, else this month. */
function boardMonth(): string {
  const { from, to } = resolvePeriod(boardPeriod.value);
  const m = from.slice(0, 7);
  return from === monthStart(m) && to === monthEnd(m) ? m : currentMonth();
}

export function CategoryViewScreen({
  id,
  board,
}: {
  id: string;
  board?: string;
}) {
  const [month, setMonth] = useState(boardMonth);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Opened from a board: that board's accounts, like the coin's number; "All accounts" lifts the filter.
  const boardDef = GROUPS.find((g) => g.id === board && g.id !== "total");
  const [allAccounts, setAllAccounts] = useState(!boardDef);
  const cat = categoriesById.value.get(id);
  if (!cat) {
    return (
      <main class="screen screen-modal">
        <NavBar
          left={<NavButton onClick={() => back("/board")}>Back</NavButton>}
          title="Category"
        />
        <Empty title="Category not found" />
      </main>
    );
  }
  const income = cat.kind === "income";
  const type = income ? "income" : "expense";
  const inCat = (t: Transaction) =>
    t.category_id === id ||
    categoriesById.value.get(t.category_id)?.parent_id === id;
  const onBoard = (t: Transaction) =>
    allAccounts ||
    !boardDef ||
    boardDef.members.includes(
      accountsById.value.get(t.account_id)?.group as never,
    );
  const list = liveTransactions.value.filter(
    (t) =>
      t.type === type && t.date.startsWith(month) && inCat(t) && onBoard(t),
  );
  const byAccount = new Map<string, AccountSum>();
  for (const t of list) {
    const row = byAccount.get(t.account_id) ?? {
      accountId: t.account_id,
      amount: 0,
      usd: 0,
      txs: [],
    };
    row.amount += Math.abs(t.amount);
    row.usd += Math.abs(txUsd(t, rates.value, currencyOf));
    row.txs.push(t);
    byAccount.set(t.account_id, row);
  }
  const rows = [...byAccount.values()].sort((a, b) => b.usd - a.usd);
  const total = rows.reduce((s, r) => s + r.usd, 0);
  const shown = shownCurrency();
  const toggle = (accountId: string) => {
    const next = new Set(open);
    if (next.has(accountId)) next.delete(accountId);
    else next.add(accountId);
    setOpen(next);
  };
  const atNow = month >= currentMonth();
  // Interest: the deposits behind it, and the ones paying into each account.
  const interest =
    income && (id === INC_INTEREST || cat.parent_id === INC_INTEREST);
  const deposits = interest
    ? depositInterest({
        accounts: accounts.value,
        balances: balances.value,
        txs: liveTransactions.value,
        rates: rates.value,
        currencyOf,
        isInterest: (c) =>
          c === id || categoriesById.value.get(c)?.parent_id === id,
        recorded: (a) => interestRecorded(a, automations.value),
        from: monthStart(month),
        to: monthEnd(month),
      }).sort((a, b) => b.expectedUsd - a.expectedUsd)
    : [];
  const payers = (accountId: string) =>
    deposits
      .filter((d) => d.deposit.interest_to === accountId)
      .map((d) => d.deposit.name);

  return (
    <main class="screen screen-modal cat-view">
      <NavBar
        left={<NavButton onClick={() => back("/board")}>Close</NavButton>}
        title={`${cat.icon ? `${cat.icon} ` : ""}${cat.name}`}
        right={
          <NavButton
            bold
            onClick={() =>
              navigate(`/entry?type=${type}&cat=${encodeURIComponent(id)}`)
            }
          >
            Add
          </NavButton>
        }
      />

      <div class="cat-view-head">
        <div class="period-bar">
          <button
            type="button"
            class="icon-btn"
            aria-label="Previous month"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <IconBack size={20} />
          </button>
          <span class="cat-view-month">{monthLabel(month)}</span>
          <button
            type="button"
            class="icon-btn"
            aria-label="Next month"
            disabled={atNow}
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <IconChevron size={20} />
          </button>
        </div>
        <div class={cx("cat-view-total", income && "pos")}>
          <Usd value={total} />
        </div>
        <div class="cat-view-sub">
          {list.length}{" "}
          {plural(
            list.length,
            income ? "payment" : "expense",
            income ? "payments" : "expenses",
          )}
          {rows.length > 1 && ` · ${rows.length} accounts`}
        </div>
        {boardDef && (
          <button
            type="button"
            class="btn btn-plain cat-view-scope"
            onClick={() => setAllAccounts(!allAccounts)}
          >
            {allAccounts
              ? `Only ${boardDef.label} accounts`
              : `${boardDef.label} accounts · show all`}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty
          title={
            income
              ? `No ${cat.name.toLowerCase()} this month`
              : "Nothing this month"
          }
        />
      ) : (
        <section class="section">
          <div class="group">
            {rows.map((r) => {
              const acc = accountsById.value.get(r.accountId);
              const cur = acc?.currency ?? "USD";
              const expanded = open.has(r.accountId);
              return (
                <div key={r.accountId}>
                  <button
                    type="button"
                    class={cx("row row-tap", expanded && "row-open")}
                    onClick={() => toggle(r.accountId)}
                  >
                    <div class="row-icon">
                      <AccountIcon account={acc} size={34} />
                    </div>
                    <div class="row-main">
                      <div class="row-title">
                        {acc?.name ?? "Unknown account"}
                      </div>
                      {payers(r.accountId).length > 0 && (
                        <div class="row-sub">
                          from {payers(r.accountId).join(", ")}
                        </div>
                      )}
                      <div class="row-sub">
                        {r.txs.length}{" "}
                        {plural(
                          r.txs.length,
                          income ? "payment" : "expense",
                          income ? "payments" : "expenses",
                        )}{" "}
                        · {expanded ? "hide" : "show all"}
                      </div>
                    </div>
                    <div class="row-value">
                      <div>
                        <Money
                          value={r.amount}
                          currency={cur}
                          class={income ? "pos" : undefined}
                        />
                      </div>
                      {cur !== shown && (
                        <div class="row-sub">
                          <Usd value={r.usd} />
                        </div>
                      )}
                    </div>
                  </button>
                  {expanded &&
                    r.txs.map((t) => {
                      const tags = parseTags(t.tags);
                      return (
                        <SwipeRow
                          key={t.id}
                          onDelete={() => void removeTransaction(t)}
                        >
                          <button
                            type="button"
                            class="row row-tap cat-view-tx"
                            onClick={() =>
                              navigate(`/entry?tx=${encodeURIComponent(t.id)}`)
                            }
                          >
                            <div class="row-main">
                              <div class="row-title">{shortDay(t.date)}</div>
                              {(t.note || tags.length > 0) && (
                                <div class="row-sub">
                                  {t.note}
                                  {tags.length > 0 && (
                                    <span class="tx-tags">
                                      {" "}
                                      {tags.map((x) => `#${x}`).join(" ")}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div class="row-value">
                              <Money
                                value={Math.abs(t.amount)}
                                currency={cur}
                              />
                            </div>
                          </button>
                        </SwipeRow>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {deposits.length > 0 && (
        <section class="section">
          <div class="section-header">
            <span>By deposit</span>
            <span class="section-header-right">received / expected</span>
          </div>
          <div class="group">
            {deposits.map((d) => {
              const short =
                !atNow &&
                d.expectedUsd > 0 &&
                d.receivedUsd < 0.9 * d.expectedUsd;
              return (
                <Row
                  key={d.deposit.id}
                  icon={<AccountIcon account={d.deposit} size={34} />}
                  title={d.deposit.name}
                  subtitle={
                    d.payout
                      ? `paid to ${d.payout.name}`
                      : "kept in the account"
                  }
                  value={
                    <span class="cat-view-dep">
                      <Usd value={d.receivedUsd} whole />{" "}
                      <span class="muted">
                        / ≈<Usd value={d.expectedUsd} whole />
                      </span>
                    </span>
                  }
                  valueSub={
                    atNow ? (
                      "so far / a month"
                    ) : (
                      <span class={cx(short && "neg")}>
                        {d.expectedUsd > 0
                          ? `${Math.round((d.receivedUsd / d.expectedUsd) * 100)}% of expected`
                          : "no rate set"}
                      </span>
                    )
                  }
                  chevron
                  onClick={() =>
                    navigate(
                      `/accounts/${encodeURIComponent(d.deposit.id)}/view`,
                    )
                  }
                />
              );
            })}
          </div>
          <div class="section-footer">
            Interest paid to another account counts as the deposit's; deposits
            paying into one account share it by their expected interest. A
            reconciliation booked as Interest counts only for a deposit that
            keeps its interest with no automation recording it. Expected =
            today's balance × the rate after tax ÷ 12, for the whole month.
          </div>
        </section>
      )}
    </main>
  );
}
