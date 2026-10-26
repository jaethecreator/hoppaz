"use client";

import { CARD, Pill } from "@/components/events-r1/host/ui";
import { stampWord } from "@/components/events-r1/host/words";
import type { R1Event } from "@/lib/events-r1/types";
import GetPaidCard from "./GetPaidCard";
import RefundControl from "./RefundControl";
import { useEventOrders, usePaidOn, useSales } from "./usePay";
import { METHOD_WORD, naira, orderChip, ticketsWord } from "./words";

function Money({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="font-body text-[13px] text-dim">{label}</dt>
      <dd className={strong ? "font-display text-[20px] font-black tabular-nums" : "font-body text-[15px] tabular-nums"}>{naira(value)}</dd>
    </div>
  );
}

/**
 * Sales (paid tickets on): what each paid ticket type has sold, the fees, what the host receives, then every order with a
 * Refund. Numbers come from pay.sales and pay.eventOrders; nothing is worked out here.
 */
export default function SalesTab({ event }: { event: R1Event }) {
  const on = usePaidOn();
  const sales = useSales(event.id, on);
  const orders = useEventOrders(event.id, on);
  if (!on) return null;
  const s = sales.data;
  const list = orders.data ?? [];
  const rows = (s?.rows ?? []).filter((r) => r.price_naira > 0 || r.sold > 0);

  return (
    <div className="flex flex-col gap-4">
      <GetPaidCard returnPath={`/host/${encodeURIComponent(event.id)}?tab=sales`} />

      {sales.loading && !s ? (
        <p className="hint">Loading</p>
      ) : sales.error || !s ? (
        <p className="hint">Could not load sales.</p>
      ) : (
        <>
          <section className={CARD} aria-label="Totals">
            <p className="seclabel">You receive</p>
            <p className="num mt-1 text-[34px]">{naira(s.totals.net_naira)}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <div className="min-w-0">
                <dt className="font-body text-[13px] text-dim">Tickets sold</dt>
                <dd className="font-body text-[15px] tabular-nums">{s.totals.sold}</dd>
              </div>
              <Money label="Sales" value={s.totals.gross_naira} />
              <Money label="Hoppaz fee" value={s.totals.platform_fee_naira} />
              <Money label="Card fees paid by you" value={s.totals.processing_fee_naira} />
            </dl>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 font-body text-[14px]">
              <span>
                <span className="text-dim">Open orders </span>
                <span className="tabular-nums">{s.open_orders}</span>
              </span>
              <span>
                <span className="text-dim">Refunds owed </span>
                <span className="tabular-nums">{s.refunds_owed}</span>
              </span>
              {s.totals.refunded_naira > 0 && (
                <span>
                  <span className="text-dim">Refunded </span>
                  <span className="tabular-nums">{naira(s.totals.refunded_naira)}</span>
                </span>
              )}
            </div>
          </section>

          {rows.length > 0 && (
            <section aria-label="By ticket">
              <h2 className="mb-2 font-display text-[16px] font-black">By ticket</h2>
              <ul className="flex flex-col gap-2">
                {rows.map((r) => (
                  <li key={r.ticket_type_id} className={CARD}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate font-body text-[16px] text-cream">{r.name}</p>
                      <p className="flex-none font-body text-[13px] text-dim">
                        {naira(r.price_naira)} · {r.sold} sold
                      </p>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                      <Money label="Sales" value={r.gross_naira} />
                      <Money label="Hoppaz fee" value={r.platform_fee_naira} />
                      <Money label="Card fees paid by you" value={r.processing_fee_naira} />
                      <Money label="You receive" value={r.net_naira} strong />
                    </dl>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section aria-label="Orders">
        <h2 className="mb-2 font-display text-[16px] font-black">Orders</h2>
        {orders.loading && !orders.data ? (
          <p className="hint">Loading</p>
        ) : list.length === 0 ? (
          <p className="hint">No orders yet. They show here when someone starts to buy.</p>
        ) : (
          <ul className="divide-y divide-line rounded-hz border border-line bg-ink-2">
            {list.map((o) => {
              const chip = orderChip(o);
              return (
                <li key={o.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-body text-[16px] text-cream">{o.buyer_name}</span>
                      <span className="block font-body text-[13px] text-dim">
                        {o.ticket_name} · {ticketsWord(o.quantity)} · {naira(o.gross_naira)}
                        {o.payment_method ? ` · ${METHOD_WORD[o.payment_method]}` : ""}
                      </span>
                      <span className="block font-body text-[13px] text-dim">{stampWord(o.paid_at ?? o.created_at)}</span>
                    </span>
                    <Pill tone={chip.tone}>{chip.word}</Pill>
                  </div>
                  {(o.needs_refund || o.needs_manual_refund) && (
                    <p className="mt-1 font-body text-[13px] text-fireant">
                      {o.needs_refund ? "This payment came after the seats were released. Refund it." : "Pay this buyer back by bank, then mark it done."}
                    </p>
                  )}
                  <div className="mt-2">
                    <RefundControl order={o} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
