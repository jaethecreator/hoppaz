"use client";

import Link from "next/link";
import { useState } from "react";
import { useR1Api, useR1Now } from "@/lib/events-r1/hooks";
import type { Order } from "@/lib/events-r1/pay";
import type { R1Event } from "@/lib/events-r1/types";
import { Chip, Empty, Fine, Lines, MCard, Msg, Stat } from "./MoneyParts";
import type { Line } from "./MoneyParts";
import PayoutSetupSheet from "./PayoutSetupSheet";
import RefundControl from "./RefundControl";
import { bankState, dayWord, DEFAULT_RULES, eventMoney, hasPaidTypes, isOver, nairaSigned, percentWord, releaseMs, whenWord } from "./money";
import { useEventOrders, useHostPayout, usePaidOn, usePayoutSummary, useSales } from "./usePay";
import { naira, ORDER_WORD } from "./words";

/**
 * Sales, in one event's dashboard (paid tickets on): how the night is selling, where the money goes, when the host gets it, each ticket
 * type and the orders. The host (whoever the money goes to) sees the bank messages and refunds; a room admin sees the numbers only.
 * Numbers come from pay.sales and pay.eventOrders, the bank and balance from pay.hostPayout and pay.payoutSummary. No money moves here
 * except a refund, through RefundControl.
 */
export default function SalesTab({ event, payoutsHref, onTickets }: { event: R1Event; payoutsHref: string | null; onTickets: () => void }) {
  const api = useR1Api();
  const now = useR1Now();
  const on = usePaidOn();
  const me = api?.auth.current()?.id ?? null;
  const own = !!me && event.host.id === me;
  const paid = hasPaidTypes(event);
  const sales = useSales(event.id, on && paid);
  const orders = useEventOrders(event.id, on && paid);
  const sum = usePayoutSummary(on && own);
  const host = useHostPayout(on && own);
  const [sheet, setSheet] = useState(false);

  if (!on) return null;
  if (!paid) {
    return (
      <Empty
        title="This event is free"
        action={
          <button type="button" className="lip-ghost !min-h-[44px] !px-3.5" onClick={onTickets}>
            Go to Tickets
          </button>
        }
      >
        Sales shows up here when an event has paid tickets. Add a price to a ticket type to start selling.
      </Empty>
    );
  }

  const s = sales.data;
  if (sales.loading && !s) return <p className="font-body text-[14px] text-t-muted">Loading</p>;
  if (!s) {
    // The real server shows sales to the host and staff only, so a room admin lands here until it opens them up.
    return own ? (
      <p className="font-body text-[14px] text-t-muted">Could not load sales.</p>
    ) : (
      <div className="grid justify-items-center gap-2 px-[18px] py-10 text-center">
        <b className="font-display text-[20px] font-extrabold">Sales are with {event.host.name}</b>
        <p className="m-0 max-w-[42ch] font-body text-[15px] text-t-muted">Only the person the money goes to can see this event&apos;s sales for now.</p>
      </div>
    );
  }

  const list = orders.data ?? [];
  const summary = sum.data ?? null;
  const rules = summary?.rules ?? DEFAULT_RULES;
  const m = eventMoney(s, list, rules, now);
  const bank = own ? bankState(summary, host.data ?? null) : "ready";
  const over = isOver(event, now);
  const release = releaseMs(event, rules);
  const released = over && release <= now;
  const nothing = m.sold === 0 && m.refunds === 0 && list.length === 0;
  const locked = (bank === "none" || bank === "checking") && nothing;
  const gets = own ? "you get" : "the room gets";
  const Gets = own ? "You get" : "The room gets";

  // One message at the top: the bank first, then a refund that is owed, then what happens after the night.
  let msg: React.ReactNode = null;
  if (own && bank === "none") {
    msg = (
      <Msg
        icon="₦"
        title="Add your bank to get paid"
        action={
          <button type="button" className="lip" onClick={() => setSheet(true)}>
            Add bank account
          </button>
        }
      >
        Tickets sell now. We need to know where to send your money before you can withdraw. It takes about two minutes.
      </Msg>
    );
  } else if (own && bank === "checking") {
    msg = (
      <Msg icon="⟳" title="Checking your bank">
        Usually a few minutes. Withdrawals open by themselves when it&apos;s done. You can keep editing the event.
      </Msg>
    );
  } else if (own && bank === "problem") {
    const due = host.data?.requirements_due?.[0] ?? summary?.account.requirements_due?.[0];
    msg = (
      <Msg
        icon="!"
        tone="bad"
        title="We couldn't confirm your bank"
        action={
          <button type="button" className="lip" onClick={() => setSheet(true)}>
            Fix bank details
          </button>
        }
      >
        {due ? `Still needed: ${due.charAt(0).toLowerCase()}${due.slice(1)}. ` : "Check the details you gave. "}
        Tickets keep selling, but you can&apos;t withdraw until it&apos;s fixed.
      </Msg>
    );
  } else if (own && m.refunds > 0 && summary && summary.balance_naira < 0) {
    const r = list.find((o) => o.status === "refunded" || o.status === "refund_pending");
    msg = (
      <Msg icon="↩" title={r ? `${r.buyer_name} was refunded ${naira(r.gross_naira)}` : `${naira(m.refunds)} was refunded`}>
        You&apos;d already withdrawn this event&apos;s money, so {naira(-summary.balance_naira)} comes off your next sales.
      </Msg>
    );
  } else if (over && !released && m.youGet > 0) {
    const way = own ? summary?.open_withdrawal : null;
    msg = (
      <Msg icon="◷" title={`The event's over. ${naira(m.held)} is released ${dayWord(release)}.`}>
        That {rules.reserve_percent}% was held in case anyone needed a refund.
        {way ? ` ${naira(way.amount_naira)} is already on its way to your bank.` : ""}
      </Msg>
    );
  } else if (own && released && m.youGet > 0 && summary && summary.available_naira === 0 && !summary.open_withdrawal && summary.balance_naira >= 0) {
    msg = (
      <Msg icon="✓" tone="ok" title="All paid out">
        {naira(m.youGet)} from this event went to {summary.account.bank_label ?? "your bank"}.
      </Msg>
    );
  }

  const split: Line[] = [{ label: "Money in", amount: naira(m.moneyIn) }];
  if (m.refunds > 0) split.push({ label: "Refunds", small: `${m.refundedTickets} ticket${m.refundedTickets === 1 ? "" : "s"}`, amount: nairaSigned(-m.refunds), tone: "neg" });
  split.push({ label: "Hoppaz fee", small: `${percentWord(m.feePercent)}, inside the ticket price`, amount: nairaSigned(-m.fee), tone: "neg" });
  // Older orders where the host bore the card or transfer fee (before buyers paid it on top).
  if (m.cardFees > 0) split.push({ label: "Card and transfer fees", small: "On older orders", amount: nairaSigned(-m.cardFees), tone: "neg" });
  split.push({ label: Gets, amount: naira(m.youGet), tone: "tot" });

  const when: Line[] = [
    { label: "As each ticket sells", small: "Your share goes to your balance" },
    { label: `Until ${dayWord(release)}`, small: `${rules.reserve_percent}% is held for refunds, then released`, amount: naira(m.held) },
    { label: "Any time", small: "Withdraw from Payouts. Usually lands within a day." },
  ];

  const rows = s.rows.filter((r) => r.price_naira > 0 || r.sold > 0);

  return (
    <div className="grid gap-[18px]" data-sales>
      {msg}

      {!locked && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat value={String(m.sold)} label="tickets sold" extra={m.today > 0 && !over ? `+${m.today} today` : undefined} />
          <Stat value={naira(m.moneyIn)} label="money in" />
          <Stat value={naira(m.youGet)} label={gets} className="col-span-2 lg:col-span-1" />
        </div>
      )}

      {!locked && (
        <MCard title="Where the money goes" aside="Fee rate not final">
          <Lines rows={split} />
          {m.cardFees === 0 && <Fine>Buyers pay their own card or transfer fee on top. It never comes off your money.</Fine>}
        </MCard>
      )}

      {!locked && (
        <MCard title="When you get it">
          <Lines rows={when} />
          {own ? (
            payoutsHref && (
              <Link href={payoutsHref} className="lip-ghost !min-h-[44px] justify-self-start !px-3.5" data-go-payouts>
                Go to Payouts
              </Link>
            )
          ) : (
            <Fine>Payouts go to {event.room_id ? `the room owner, ${event.host.name}` : event.host.name}. Only the owner sees bank details and withdraws.</Fine>
          )}
        </MCard>
      )}

      {!locked && rows.length > 0 && (
        <MCard title="By ticket type">
          <div className="grid" role="table" aria-label="By ticket type">
            <div role="row" className="grid grid-cols-[minmax(0,1fr)_.5fr_.9fr] gap-2.5 py-[9px] font-body text-[12px] font-semibold text-t-muted lg:grid-cols-[minmax(0,1.4fr)_.6fr_.8fr_.9fr]">
              <span role="columnheader">Type</span>
              <span role="columnheader" className="text-right">Sold</span>
              <span role="columnheader" className="hidden text-right lg:block">Price</span>
              <span role="columnheader" className="text-right">Money in</span>
            </div>
            {rows.map((r) => (
              <div key={r.ticket_type_id} role="row" className="grid grid-cols-[minmax(0,1fr)_.5fr_.9fr] items-center gap-2.5 border-t border-t-line py-[9px] font-body text-[14px] lg:grid-cols-[minmax(0,1.4fr)_.6fr_.8fr_.9fr]">
                <span role="cell" className="truncate">{r.name}</span>
                <span role="cell" className="text-right tabular-nums">{r.sold}</span>
                <span role="cell" className="hidden text-right tabular-nums lg:block">{naira(r.price_naira)}</span>
                <span role="cell" className="text-right tabular-nums">{naira(r.gross_naira)}</span>
              </div>
            ))}
          </div>
        </MCard>
      )}

      {!locked && (
        <MCard title="Latest orders" aside={own && list.some((o) => o.status === "paid") ? "Refund from here" : undefined}>
          {orders.loading && !orders.data ? (
            <p className="font-body text-[14px] text-t-muted">Loading</p>
          ) : list.length === 0 ? (
            <p className="font-body text-[14px] text-t-muted">No orders yet. They show here when someone starts to buy.</p>
          ) : (
            <ul className="grid">
              {list.map((o) => (
                <OrderRow key={o.id} o={o} own={own} now={now} />
              ))}
            </ul>
          )}
        </MCard>
      )}

      {own && (
        <PayoutSetupSheet
          open={sheet}
          onClose={() => setSheet(false)}
          onSaved={() => {
            setSheet(false);
            sum.reload();
            host.reload();
          }}
        />
      )}
    </div>
  );
}

/** One order: who, what, when, how much, and Refund (the host) or where it stands. */
function OrderRow({ o, own, now }: { o: Order; own: boolean; now: number }) {
  const owed = o.needs_refund || o.needs_manual_refund;
  const chip = o.status === "refunded" ? "Refunded" : owed ? "Refund owed" : o.status === "paid" ? "" : ORDER_WORD[o.status];
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 [&>[role=group]]:col-span-3 border-t border-t-line py-2.5 first:border-t-0">
      <div className="min-w-0">
        <b className="block truncate font-body text-[14.5px]">{o.buyer_name}</b>
        <small className="block font-body text-[12.5px] text-t-muted">
          {o.quantity} × {o.ticket_name} · {whenWord(o.paid_at ?? o.created_at, now)}
        </small>
      </div>
      <span className="font-body font-bold tabular-nums">{naira(o.gross_naira)}</span>
      {own && (o.status === "paid" || o.needs_manual_refund) ? (
        <RefundControl order={o} />
      ) : chip ? (
        <Chip>{chip}</Chip>
      ) : (
        <span />
      )}
    </li>
  );
}
