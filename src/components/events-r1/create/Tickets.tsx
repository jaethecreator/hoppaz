"use client";

import { PAID_UNAVAILABLE } from "@/lib/events-r1/constants";
import { platformFeeNaira, processingFeeNaira } from "@/lib/events-r1/payFee";
import PayoutNeeded from "../pay/PayoutNeeded";
import { usePaidGate } from "../pay/usePay";
import { naira } from "../pay/words";
import { Choice } from "./Fields";

export const MAX_TICKET_TYPES = 5;

/** One ticket type as typed. Prices and capacity stay as text until the event is made. */
export type TicketForm = { key: string; name: string; price: string; capacity: string };

let seq = 0;
export const newTicket = (name = ""): TicketForm => ({ key: `t${++seq}`, name, price: "", capacity: "" });

/** The collapsed row: "Free", "Paid" or "2 types". */
export function ticketsSummary(paid: boolean, types: TicketForm[]): string {
  return types.length > 1 ? `${types.length} types` : paid ? "Paid" : "Free";
}

/** What is wrong with the ticket types, as one plain line, or "". Free: prices are 0 and not looked at. */
export function ticketsError(paid: boolean, types: TicketForm[]): string {
  const seen = new Set<string>();
  for (const t of types) {
    const name = t.name.trim();
    if (!name) return "Give every ticket a name";
    if (seen.has(name.toLowerCase())) return "Two tickets have the same name";
    seen.add(name.toLowerCase());
    if (t.capacity.trim() && !(Number.isInteger(Number(t.capacity)) && Number(t.capacity) >= 1)) return "Capacity must be 1 or more";
    if (paid && !(Number.isInteger(Number(t.price)) && Number(t.price) >= 1)) return "Add a price for every ticket";
  }
  return "";
}

/** The ticket types as the data layer wants them. */
export const ticketsDraft = (paid: boolean, types: TicketForm[]) =>
  types.map((t) => ({ name: t.name.trim(), price_naira: paid ? Number(t.price) : 0, capacity: t.capacity.trim() ? Number(t.capacity) : null }));

/** What the host gets from one ticket of this price after Hoppaz's fee and Bachs's card fee (an estimate: a bank transfer costs a little less). */
function receives(price: string): number | null {
  const gross = Number(price);
  if (!Number.isInteger(gross) || gross < 2) return null;
  return gross - platformFeeNaira(gross) - processingFeeNaira(gross, "card");
}

const digits = (v: string, max = 9) => v.replace(/\D/g, "").slice(0, max);

/**
 * The inside of the Tickets row, Luma style: Free or Paid for the event, then the ticket types (price first when Paid),
 * a Remove on all but the last, and + Add ticket type (up to 5). Paid with paid tickets off shows the one line
 * PAID_UNAVAILABLE; with it on and the host not ready to sell, "Set up payouts first"; ready, what the host receives per
 * ticket. Switching back to Free loses nothing.
 */
export default function Tickets({
  paid,
  onPaid,
  types,
  onTypes,
}: {
  paid: boolean;
  onPaid: (v: boolean) => void;
  types: TicketForm[];
  onTypes: (t: TicketForm[]) => void;
}) {
  const gate = usePaidGate();
  const edit = (key: string, patch: Partial<TicketForm>) => onTypes(types.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  return (
    <div className="flex flex-col gap-3 pt-1">
      <Choice label="Free or paid" value={paid ? "paid" : "free"} options={[{ value: "free", label: "Free" }, { value: "paid", label: "Paid" }]} onChange={(v) => onPaid(v === "paid")} />

      {types.map((t, i) => (
        <div key={t.key} className="flex flex-col gap-2 rounded-hz border border-line bg-ink-3/40 p-3">
          {paid && (
            <label className="block">
              <span className="mb-1 block font-body text-[13px] text-dim">Price (₦)</span>
              <input value={t.price} onChange={(e) => edit(t.key, { price: digits(e.target.value) })} inputMode="numeric" placeholder="0" aria-label={`Price (₦), ticket ${i + 1}`} />
              {gate.state !== "off" && receives(t.price) !== null && (
                <span className="mt-1 block font-body text-[13px] text-dim">You receive about {naira(receives(t.price) as number)} per ticket after the Hoppaz fee and Bachs fees</span>
              )}
            </label>
          )}
          <div className="grid grid-cols-[1fr_8.5rem] items-end gap-2">
            <label className="block min-w-0">
              <span className="mb-1 block font-body text-[13px] text-dim">Ticket name</span>
              <input value={t.name} onChange={(e) => edit(t.key, { name: e.target.value })} placeholder="General" aria-label={`Ticket name, ticket ${i + 1}`} maxLength={60} autoComplete="off" />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block font-body text-[13px] leading-tight text-dim">How many (empty = no limit)</span>
              <input value={t.capacity} onChange={(e) => edit(t.key, { capacity: digits(e.target.value, 5) })} inputMode="numeric" placeholder="No limit" aria-label={`How many, ticket ${i + 1}`} />
            </label>
          </div>
          {types.length > 1 && (
            <button type="button" onClick={() => onTypes(types.filter((x) => x.key !== t.key))} className="min-h-[36px] self-start font-body text-[14px] text-dim underline underline-offset-4">
              Remove
            </button>
          )}
        </div>
      ))}

      {types.length < MAX_TICKET_TYPES && (
        <button type="button" onClick={() => onTypes([...types, newTicket()])} className="min-h-[44px] self-start font-body text-[15px] text-orange">
          + Add ticket type
        </button>
      )}

      {paid && gate.state === "off" && <p className="font-body text-[14px] text-danfo">{PAID_UNAVAILABLE}</p>}
      {paid && gate.state === "needs" && <PayoutNeeded />}
    </div>
  );
}
