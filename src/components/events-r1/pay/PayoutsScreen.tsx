"use client";

/* eslint-disable @next/next/no-img-element -- covers are data URLs, template files or bucket links of unknown size */

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fallbackCover } from "@/components/events-r1/page/HostStory";
import { useR1Api, useR1Now } from "@/lib/events-r1/hooks";
import type { PayoutSummary, Sales, Withdrawal } from "@/lib/events-r1/pay";
import type { R1Event } from "@/lib/events-r1/types";
import { Chip, Empty, Fine, Lines, MCard } from "./MoneyParts";
import type { Line } from "./MoneyParts";
import PayoutSetupSheet from "./PayoutSetupSheet";
import TintSheet from "./TintSheet";
import { bankState, dayWord, eventEndMs, hasPaidTypes, isOver, nairaSigned, releaseMs } from "./money";
import { useHostPayout, usePaidOn, usePayoutSummary } from "./usePay";
import { hostPayError, naira } from "./words";

/** What each paid event of the workspace has sold (pay.sales per event; one that cannot be read is left out). */
function useEventSales(events: R1Event[]): Record<string, Sales> {
  const api = useR1Api();
  const [out, setOut] = useState<Record<string, Sales>>({});
  const key = events.map((e) => e.id).join(",");
  useEffect(() => {
    if (!api || !events.length) return setOut({});
    let live = true;
    void Promise.all(events.map((e) => api.pay.sales(e.id).then((s) => [e.id, s] as const, () => null))).then((all) => {
      if (live) setOut(Object.fromEntries(all.filter((x): x is readonly [string, Sales] => !!x)));
    });
    return () => {
      live = false;
    };
    // The events' ids stand for the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);
  return out;
}

/** "Thu 2 Oct · to GTBank ····4471" */
const withdrawalLine = (w: Withdrawal, bank: string | null) => `${dayWord(w.paid_at ?? w.execute_after ?? w.created_at)}${bank ? ` · to ${bank}` : ""}`;

/**
 * Payouts, in the workspace (Personal, or a room for its owner): the balance and Withdraw, the bank account (through Bachs), what each
 * event has earned, and the withdrawals. One balance per person: Bachs pays one bank, whichever workspace the events are in.
 * Withdraw asks pay.requestWithdrawal (sent a day later); the bank goes through PayoutSetupSheet. A room admin gets `locked`.
 */
export default function PayoutsScreen({ events, name, newEventHref, locked }: { events: R1Event[] | null; name: string; newEventHref: string; locked?: boolean }) {
  const api = useR1Api();
  const now = useR1Now();
  const on = usePaidOn();
  const sum = usePayoutSummary(on && !locked);
  const host = useHostPayout(on && !locked);
  const paidEvents = (events ?? []).filter((e) => hasPaidTypes(e) && e.status !== "cancelled");
  const sales = useEventSales(locked ? [] : paidEvents);
  const [sheet, setSheet] = useState<"bank" | "wd" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (locked) {
    return (
      <div className="grid justify-items-center gap-2 px-[18px] py-10 text-center" data-payouts-locked>
        <b className="font-display text-[20px] font-extrabold">Only the owner sees payouts</b>
        <p className="m-0 max-w-[42ch] font-body text-[15px] text-t-muted">The owner of {name} handles payouts. You can see how each event is selling in its Sales tab.</p>
      </div>
    );
  }
  if (!on) {
    return <p className="font-body text-[14.5px] text-t-muted">Paid tickets are not switched on yet. When they are, your balance and withdrawals show here.</p>;
  }
  const s: PayoutSummary | null = sum.data ?? null;
  if (!s) return <p className="font-body text-[14px] text-t-muted">{sum.loading ? "Loading" : "Could not load your payouts."}</p>;

  const bank = bankState(s, host.data ?? null);
  const label = s.account.bank_label;
  const open = s.open_withdrawal;
  const onWay = open ? open.amount_naira : 0;
  const ready = s.available_naira;
  const empty = s.earned_naira === 0 && s.withdrawn_naira === 0;
  const reload = () => {
    sum.reload();
    host.reload();
  };

  const withdraw = async () => {
    if (!api || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.pay.requestWithdrawal();
      setSheet(null);
      reload();
    } catch (e) {
      setError(hostPayError(e));
    } finally {
      setBusy(false);
    }
  };

  /* The balance, or the empty state before any money. */
  let balance: React.ReactNode;
  if (empty) {
    balance = (
      <Empty
        title="No money yet"
        action={
          !paidEvents.length ? (
            <Link href={newEventHref} className="lip-ghost !min-h-[44px] !px-3.5">
              Make an event
            </Link>
          ) : undefined
        }
      >
        When your events sell paid tickets, your balance shows here and you can withdraw it to your bank.
      </Empty>
    );
  } else {
    const btn =
      bank === "problem" ? (
        <button type="button" className="lip justify-self-stretch sm:justify-self-start" aria-disabled="true">
          Withdraw when your bank is fixed
        </button>
      ) : bank !== "ready" ? (
        <button type="button" className="lip justify-self-stretch sm:justify-self-start" aria-disabled="true">
          {bank === "checking" ? "Withdraw when your bank is checked" : "Add your bank to withdraw"}
        </button>
      ) : open ? (
        <button type="button" className="lip justify-self-stretch sm:justify-self-start" aria-disabled="true">
          Withdrawal on its way
        </button>
      ) : ready >= s.rules.min_naira ? (
        <button type="button" className="lip justify-self-stretch sm:justify-self-start" onClick={() => setSheet("wd")} data-withdraw>
          Withdraw {naira(ready)}
        </button>
      ) : (
        <button type="button" className="lip justify-self-stretch sm:justify-self-start" aria-disabled="true">
          {ready > 0 ? `Withdraw from ${naira(s.rules.min_naira)}` : "Nothing to withdraw yet"}
        </button>
      );
    const rows: Line[] = [{ label: "Earned from tickets", amount: naira(s.earned_naira) }];
    if (s.reserved_naira > 0) rows.push({ label: "Held for refunds", small: `Released ${dayWord(s.reserve_until)}`, amount: naira(s.reserved_naira) });
    if (onWay > 0) rows.push({ label: "On its way to your bank", small: "Usually lands within a day", amount: naira(onWay) });
    rows.push({ label: "Withdrawn", amount: naira(s.withdrawn_naira - onWay) });
    if (s.balance_naira < 0) rows.push({ label: "Owed from refunds", small: "Comes off your next sales", amount: nairaSigned(s.balance_naira) });
    balance = (
      <section className="grid gap-3.5 rounded-hz border border-t-line bg-[linear-gradient(140deg,var(--t-soft),var(--t-tile)_70%)] p-5" aria-label="Your balance" data-balance>
        <span className="font-body text-[13px] font-bold text-t-muted">Ready to withdraw</span>
        <span className="font-display text-[36px] font-black leading-none tracking-[-0.02em] tabular-nums lg:text-[44px]">{naira(ready)}</span>
        {btn}
        <Lines rows={rows} />
        {bank === "ready" && label && <Fine>Goes to {label}.</Fine>}
      </section>
    );
  }

  /* The bank account. */
  let bankCard: React.ReactNode;
  if (bank === "none") {
    bankCard = (
      <MCard title="Bank account">
        <div className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[44px_minmax(0,1fr)_auto]">
          <span className="grid h-11 w-11 place-items-center rounded-hz bg-t-soft font-display text-[13px] font-extrabold" aria-hidden>
            ₦
          </span>
          <div className="min-w-0">
            <b className="block font-body text-[15px]">No bank yet</b>
            <small className="block font-body text-[13px] text-t-muted">{paidEvents.length ? "Add one so you can withdraw what your tickets earn." : "Add one now so you're ready for paid tickets."}</small>
          </div>
          <button type="button" className={clsx("col-span-2 sm:col-span-1", paidEvents.length ? "lip" : "lip-ghost !min-h-[44px] !px-3.5")} onClick={() => setSheet("bank")}>
            Add bank account
          </button>
        </div>
        <Fine>Kept by Bachs, our payment partner. No ID or BVN needed.</Fine>
      </MCard>
    );
  } else if (bank === "checking") {
    bankCard = (
      <MCard title="Bank account">
        <div className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[44px_minmax(0,1fr)_auto]">
          <span className="grid h-11 w-11 place-items-center rounded-hz bg-t-soft font-display text-[15px] font-extrabold" aria-hidden>
            ⟳
          </span>
          <div className="min-w-0">
            <b className="block font-body text-[15px]">Checking with your bank</b>
            <small className="block font-body text-[13px] text-t-muted">{label ? `${label} · ` : ""}usually a few minutes</small>
          </div>
          <span className="justify-self-start">
            <Chip>Checking</Chip>
          </span>
        </div>
      </MCard>
    );
  } else if (bank === "problem") {
    const due = host.data?.requirements_due?.[0] ?? s.account.requirements_due[0];
    bankCard = (
      <MCard title="Bank account" className="!border-[#E5484D]">
        <div className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[44px_minmax(0,1fr)_auto]">
          <span className="grid h-11 w-11 place-items-center rounded-hz bg-t-soft font-display text-[15px] font-extrabold text-[color-mix(in_srgb,#E5484D_80%,var(--t-text))]" aria-hidden>
            !
          </span>
          <div className="min-w-0">
            <b className="block font-body text-[15px]">{label ?? "Your bank"}</b>
            <small className="block font-body text-[13px] text-t-muted">{due ? `We couldn't confirm it. Still needed: ${due.charAt(0).toLowerCase()}${due.slice(1)}.` : "We couldn't confirm it. Check the details you gave, or use an account in your name."}</small>
          </div>
          <button type="button" className="lip col-span-2 sm:col-span-1" onClick={() => setSheet("bank")}>
            Fix bank details
          </button>
        </div>
      </MCard>
    );
  } else {
    bankCard = (
      <MCard title="Bank account" aside="Only you see this">
        <div className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[44px_minmax(0,1fr)_auto]">
          <span className="grid h-11 w-11 place-items-center rounded-hz bg-t-soft font-display text-[13px] font-extrabold" aria-hidden>
            {(label ?? "Bank").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase()}
          </span>
          <div className="min-w-0">
            <b className="block font-body text-[15px]">{label ?? "Your bank"}</b>
            <small className="block font-body text-[13px] text-t-muted">Confirmed by Bachs</small>
          </div>
          <button type="button" className="lip-ghost col-span-2 !min-h-[44px] !px-3.5 sm:col-span-1" onClick={() => setSheet("bank")}>
            Change
          </button>
        </div>
      </MCard>
    );
  }

  /* What each event earned. */
  const withSales = paidEvents
    .filter((e) => sales[e.id] && (sales[e.id].totals.sold > 0 || sales[e.id].totals.refunded_naira > 0))
    .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  // Which nights are paid out: withdrawals cover the oldest nights first.
  const paidOut = new Set<string>();
  let left = s.withdrawn_naira - onWay;
  for (const e of [...withSales].sort((x, y) => eventEndMs(x) - eventEndMs(y))) {
    left -= sales[e.id].totals.net_naira;
    if (left >= 0) paidOut.add(e.id);
  }
  const byEvent = withSales.length > 0 && (
    <MCard title="By event">
      <ul className="grid">
        {withSales.map((e) => {
          const t = sales[e.id].totals;
          const over = isOver(e, now);
          const rel = releaseMs(e, s.rules);
          const chip = !over ? "Selling" : rel > now ? `Held until ${dayWord(rel).split(" ").slice(1).join(" ")}` : paidOut.has(e.id) ? "Paid out" : "Released";
          return (
            <li key={e.id} className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 border-t border-t-line py-2.5 first:border-t-0">
              <img src={e.flyer_url || fallbackCover(e.id, e.title)} alt="" className={clsx("h-11 w-11 rounded-hz object-cover", over && rel <= now && "opacity-70 grayscale")} />
              <div className="min-w-0">
                <Link href={`/host/${encodeURIComponent(e.id)}?tab=sales`} className="block truncate font-body text-[14.5px] font-bold hover:underline">
                  {e.title}
                </Link>
                <small className="block font-body text-[12.5px] text-t-muted">
                  {dayWord(e.starts_at)}
                  {!over || rel > now ? ` · ${t.sold} ticket${t.sold === 1 ? "" : "s"}` : ""}
                </small>
              </div>
              <div className="grid justify-items-end gap-1 text-right">
                <span className="font-body font-bold tabular-nums">{naira(t.net_naira)}</span>
                <Chip good={chip === "Paid out"}>{chip}</Chip>
              </div>
            </li>
          );
        })}
      </ul>
    </MCard>
  );

  const history = s.recent.filter((w) => w.status !== "cancelled");
  const withdrawals = history.length > 0 && (
    <MCard title="Withdrawals">
      <ul className="grid">
        {history.map((w) => (
          <li key={w.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-t-line py-2.5 first:border-t-0">
            <div className="min-w-0">
              <b className="block font-body text-[14.5px] tabular-nums">{naira(w.amount_naira)}</b>
              <small className="block font-body text-[12.5px] text-t-muted">{w.status === "paid" ? withdrawalLine(w, label) : `${dayWord(w.created_at)}${label ? ` · to ${label}` : ""}`}</small>
            </div>
            <Chip good={w.status === "paid"}>{w.status === "paid" ? "Paid" : "On its way"}</Chip>
          </li>
        ))}
      </ul>
    </MCard>
  );

  return (
    <div className="grid gap-[18px]" data-payouts>
      {balance}
      {error && (
        <p role="alert" className="font-body text-[14px] text-fireant">
          {error}
        </p>
      )}
      {bankCard}
      {byEvent}
      {withdrawals}

      <PayoutSetupSheet
        open={sheet === "bank"}
        onClose={() => setSheet(null)}
        onSaved={() => {
          setSheet(null);
          reload();
        }}
      />
      <TintSheet open={sheet === "wd"} onClose={() => setSheet(null)} title="Withdraw">
        <span className="font-display text-[32px] font-black tabular-nums">{naira(ready)}</span>
        <p className="m-0 font-body text-[13px] text-t-muted">To {label ?? "your bank"}. Usually lands within a day.</p>
        <button type="button" className="lip w-full" onClick={() => void withdraw()} disabled={busy || !api}>
          {busy ? "One moment" : `Withdraw ${naira(ready)}`}
        </button>
        {error && (
          <p role="alert" className="font-body text-[14px] text-fireant">
            {error}
          </p>
        )}
      </TintSheet>
    </div>
  );
}
