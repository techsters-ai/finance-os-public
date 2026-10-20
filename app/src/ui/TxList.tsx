// Transactions grouped by day, newest first, 150 at a time: History and the account screen.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import {
  accountsById,
  categoriesById,
  currencyOf,
  deleteTransaction,
  rates,
} from "../data/store";
import { parseTags } from "../domain/tags";
import { debtTransferTitle } from "../domain/debts";
import type { Transaction } from "../domain/types";
import { dayLabel } from "../domain/dates";
import { txUsd } from "../domain/metrics";
import { RECONCILE_NOTE } from "../domain/reconcile";
import {
  AccountIcon,
  CatIcon,
  Money,
  Usd,
  showToast,
  shownCurrency,
} from "./components";
import { SwipeRow } from "./SwipeRow";
import { navigate } from "./router";

const PAGE = 150;

/** Swipe left, then Delete (an automatic tax goes with its income: see data/store.ts). */
export async function removeTransaction(t: Transaction): Promise<void> {
  await deleteTransaction(t);
  showToast("Deleted");
}

export function TxRow({ t }: { t: Transaction }) {
  const acc = accountsById.value.get(t.account_id);
  const cat = categoriesById.value.get(t.category_id);
  const cur = acc?.currency ?? "USD";
  let title: string;
  let icon;
  let sub: string;
  if (t.type === "transfer") {
    const to = accountsById.value.get(t.to_account_id);
    title = debtTransferTitle(acc, to) ?? "Transfer";
    icon = <AccountIcon account={to} size={36} />;
    sub = `${acc?.name ?? "?"} → ${to?.name ?? "?"}`;
  } else if (t.type === "adjustment") {
    title = "Reconciliation";
    icon = <CatIcon cat={cat} size={36} />;
    sub = [acc?.name ?? "?", cat?.name].filter(Boolean).join(" · ");
  } else {
    title = cat?.name ?? "No category";
    icon = <CatIcon cat={cat} size={36} />;
    sub = acc?.name ?? "?";
  }
  const note =
    t.type === "adjustment" && t.note === RECONCILE_NOTE ? "" : t.note;
  const tags = parseTags(t.tags);
  const toCur = t.type === "transfer" ? currencyOf(t.to_account_id) : undefined;
  return (
    <SwipeRow onDelete={() => void removeTransaction(t)}>
      <button
        type="button"
        class="row row-tap tx-row"
        onClick={() => navigate(`/entry?tx=${t.id}`)}
      >
        <div class="row-icon">{icon}</div>
        <div class="row-main">
          <div class="row-title">{title}</div>
          <div class="row-sub">
            {sub}
            {note && <span class="tx-note"> · {note}</span>}
            {tags.length > 0 && (
              <span class="tx-tags"> {tags.map((x) => `#${x}`).join(" ")}</span>
            )}
          </div>
        </div>
        <div class="row-value">
          <div>
            {t.type === "transfer" ? (
              <Money value={Math.abs(t.amount)} currency={cur} class="accent" />
            ) : t.type === "adjustment" ? (
              <Money
                value={t.amount}
                currency={cur}
                signed
                tone={t.amount > 0}
                class={t.amount === 0 ? "muted" : undefined}
              />
            ) : (
              <Money
                value={t.amount}
                currency={cur}
                tone={t.amount > 0}
                signed={t.amount > 0}
              />
            )}
          </div>
          <div class="row-sub">
            {t.type === "transfer" &&
            toCur &&
            toCur !== cur &&
            typeof t.to_amount === "number" ? (
              <Money value={t.to_amount} currency={toCur} />
            ) : t.orig_currency && typeof t.orig_amount === "number" ? (
              <Money
                value={Math.abs(t.orig_amount)}
                currency={t.orig_currency}
              />
            ) : cur !== shownCurrency() ? (
              <Usd value={Math.abs(txUsd(t, rates.value, currencyOf))} />
            ) : null}
          </div>
        </div>
      </button>
    </SwipeRow>
  );
}

/** Days with their transactions; a day header shows that day's spending. */
export function TxDays({
  txs,
  empty,
}: {
  txs: Transaction[];
  empty?: ComponentChildren;
}) {
  const [limit, setLimit] = useState(PAGE);
  const days: [string, Transaction[]][] = [];
  for (const t of txs.slice(0, limit)) {
    const last = days[days.length - 1];
    if (last && last[0] === t.date) last[1].push(t);
    else days.push([t.date, [t]]);
  }
  if (!days.length) return <>{empty ?? null}</>;
  return (
    <>
      {days.map(([date, list]) => {
        const spent = list
          .filter((t) => t.type === "expense")
          .reduce((s, t) => s - txUsd(t, rates.value, currencyOf), 0);
        return (
          <section class="section" key={date}>
            <div class="section-header">
              <span>{dayLabel(date)}</span>
              {spent > 0 && (
                <span class="section-header-right">
                  <Usd value={-spent} />
                </span>
              )}
            </div>
            <div class="group">
              {list.map((t) => (
                <TxRow key={t.id} t={t} />
              ))}
            </div>
          </section>
        );
      })}
      {txs.length > limit && (
        <div class="more">
          <button
            type="button"
            class="btn btn-tinted"
            onClick={() => setLimit(limit + PAGE)}
          >
            Show more ({txs.length - limit})
          </button>
        </div>
      )}
    </>
  );
}
