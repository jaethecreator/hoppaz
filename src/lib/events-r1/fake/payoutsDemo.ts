/**
 * Fake only: a money story for Sales and Payouts, so every state of the design can be seen. Off unless localStorage
 * "hz.r1.payouts.demo" holds a stage. It is laid on the seed (not the saved layer), so changing the stage and reloading is enough.
 *
 * Rooftop Sessions (the owner) gets a paid event in its room, "Halloween Edition" (Regular, VIP, VVIP), and its past "Pool Party Vol. 3"
 * becomes a paid event too. Chidi Okafor is made an admin of the room, to see it as a room admin. Buyers paid the card or transfer fee on
 * top (like the real server), so the host's share is the price less Hoppaz's fee.
 *
 * Stages: nopaid (no paid events, no bank), nobank (a paid event, no bank, nothing sold), checking (bank being checked), problem (bank
 * refused, tickets selling), selling, after (the event ended yesterday, a withdrawal on its way), paid (everything released and paid
 * out), refund (paid out, then a VIP order refunded: owed from the next sales).
 */
import { platformFeeNaira } from "../payFee";
import type { HostPayoutStatus } from "../pay";
import type { EventRec, FakeState, OrderRec, WithdrawalRec } from "./store";
import { DAY, HOUR, seedId } from "./util";

export const PAYOUTS_DEMO_KEY = "hz.r1.payouts.demo";
export const PAYOUTS_DEMO_STAGES = ["nopaid", "nobank", "checking", "problem", "selling", "after", "paid", "refund"] as const;
export type PayoutsDemoStage = (typeof PAYOUTS_DEMO_STAGES)[number];

/** The stage asked for in this browser, or null. */
export function payoutsDemoStage(): PayoutsDemoStage | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(PAYOUTS_DEMO_KEY);
    return (PAYOUTS_DEMO_STAGES as readonly string[]).includes(v ?? "") ? (v as PayoutsDemoStage) : null;
  } catch {
    return null;
  }
}

const ROOF = seedId("user:rooftop-sessions");
const ROOM = seedId("room:rooftop-sessions");
const CHIDI = seedId("user:chidi-okafor");
const EVENT = seedId("event:payouts-demo");
const POOL = seedId("event:pool-ended");
const RESERVE_DAYS = 30;

/** [buyer, type index, quantity, minutes ago]. The first four are the ones the design shows. */
const ORDERS: Array<[string, number, number, number]> = [
  ["Ife Okoro", 0, 2, 50],
  ["Kemi Bello", 1, 1, 240],
  ["Dami Ojo", 0, 3, 26 * 60],
  ["Tunde Bakare", 1, 1, 3 * 24 * 60],
  ["Amaka Eze", 0, 4, 90],
  ["Segun Lawal", 0, 2, 150],
  ["Zainab Musa", 0, 4, 2 * 24 * 60],
  ["Femi Alabi", 0, 4, 2 * 24 * 60 + 30],
  ["Nneka Umeh", 0, 4, 3 * 24 * 60 + 40],
  ["Obinna Igwe", 0, 4, 4 * 24 * 60],
  ["Halima Sanni", 0, 4, 4 * 24 * 60 + 10],
  ["Kunle Ojo", 0, 5, 5 * 24 * 60],
  ["Sade Fashola", 0, 2, 5 * 24 * 60 + 20],
  ["Tolu Afolabi", 1, 3, 4 * 24 * 60 + 5],
  ["Uche Nnadi", 1, 3, 6 * 24 * 60],
];

const iso = (ms: number) => new Date(ms).toISOString();

function order(st: FakeState, ev: EventRec, key: string, buyer: string, typeIndex: number, quantity: number, paidMs: number): OrderRec {
  const type = ev.ticket_types![typeIndex];
  const gross = type.price_naira * quantity;
  const fee = platformFeeNaira(gross);
  const id = seedId(`order:${key}`);
  const rec: OrderRec = {
    id, event_id: ev.id, event_title: ev.title, buyer_id: seedId(`person:${buyer}`), buyer_name: buyer, ticket_type_id: type.id, ticket_name: type.name,
    quantity, unit_price_naira: type.price_naira, gross_naira: gross, platform_fee_naira: fee, processing_fee_naira: 0, host_net_naira: gross - fee,
    status: "paid", payment_method: "card", created_at: iso(paidMs - 2 * 60_000), expires_at: iso(paidMs + 13 * 60_000), paid_at: iso(paidMs),
    checkout_url: null, needs_refund: false, needs_manual_refund: false, host_id: ev.host_id, answers: {}, referrer_id: null, refund_started_ms: null,
  };
  st.orders[id] = rec;
  return rec;
}

/** Lay the stage on a fresh seed. */
export function applyPayoutsDemo(st: FakeState, now: number, stage: PayoutsDemoStage | null = payoutsDemoStage()): void {
  if (!stage || !st.rooms[ROOM] || !st.events[POOL]) return;

  // Chidi helps run the room, to see it as an admin.
  st.memberships[`${CHIDI}:${ROOM}`] = true;
  st.roles[`${CHIDI}:${ROOM}`] = "admin";

  const status: HostPayoutStatus = stage === "nopaid" || stage === "nobank" ? "not_started" : stage === "checking" ? "in_progress" : stage === "problem" ? "restricted" : "ready";
  st.payouts[ROOF] = { id: ROOF, status, balance_naira: 500_000, bank_label: status === "not_started" ? null : "GTBank ····4471", withdrawals: [] };

  // When the night is: coming up (selling), ended yesterday (after), or ended long enough ago that the 5 percent is released.
  const ended = stage === "after" ? now - DAY : stage === "paid" || stage === "refund" ? now - (RESERVE_DAYS + 3) * DAY : null;
  const start = ended === null ? now + 2 * DAY : ended - 6 * HOUR;
  const pool = st.events[POOL];
  const ev: EventRec = {
    ...pool,
    id: EVENT,
    title: "Halloween Edition",
    description: "Come in costume. Three rooms of sound until late.",
    starts_at: iso(start),
    ends_at: iso(start + 6 * HOUR),
    created_at: iso(start - 20 * DAY),
    slug: `halloween-edition-${EVENT.slice(0, 4)}`,
    room_id: ROOM,
    host_id: ROOF,
    status: "live",
  };
  if (stage === "nopaid") {
    ev.ticket_types = [{ id: seedId("ticket-type:demo-free"), name: "General", price_naira: 0, capacity: null }];
    ev.price_naira = 0;
  } else {
    ev.ticket_types = [
      { id: seedId("ticket-type:demo-regular"), name: "Regular", price_naira: 10_000, capacity: 300 },
      { id: seedId("ticket-type:demo-vip"), name: "VIP", price_naira: 15_000, capacity: 60 },
      { id: seedId("ticket-type:demo-vvip"), name: "VVIP", price_naira: 25_000, capacity: 10 },
    ];
    ev.price_naira = 10_000;
  }
  st.events[EVENT] = ev;
  if (stage === "nopaid" || stage === "nobank" || stage === "checking") return;

  // The past night: paid tickets, released and paid out a while ago.
  const poolStart = (ended ?? now) - (RESERVE_DAYS + 30) * DAY;
  pool.starts_at = iso(poolStart);
  pool.ends_at = iso(poolStart + 6 * HOUR);
  pool.ticket_types = [{ id: seedId("ticket-type:pool-pass"), name: "Pool pass", price_naira: 8_000, capacity: null }];
  pool.price_naira = 8_000;
  let poolShare = 0;
  for (let i = 0; i < 8; i++) poolShare += order(st, pool, `pool-${i}`, `Guest ${i + 1}`, 0, 5, poolStart - (i + 1) * DAY).host_net_naira ?? 0;

  // This night's orders, paid before it started.
  const latest = ended === null ? now : start;
  const made = ORDERS.map(([buyer, t, q, ago], i) => order(st, ev, `demo-${i}`, buyer, t, q, latest - ago * 60_000));
  const share = made.reduce((n, o) => n + (o.host_net_naira ?? 0), 0);
  const held = made.reduce((n, o) => n + Math.ceil(((o.host_net_naira ?? 0) * 5) / 100), 0);

  const list: WithdrawalRec[] = [{ id: seedId("withdrawal:pool"), amount_naira: poolShare, created_ms: poolStart + (RESERVE_DAYS + 1) * DAY, execute_after_ms: poolStart + (RESERVE_DAYS + 2) * DAY, paid_ms: poolStart + (RESERVE_DAYS + 2) * DAY }];
  if (stage === "after") list.push({ id: seedId("withdrawal:after"), amount_naira: share - held, created_ms: now - 2 * HOUR, execute_after_ms: now + 22 * HOUR, paid_ms: null });
  if (stage === "paid" || stage === "refund") {
    const at = (ended as number) + (RESERVE_DAYS + 1) * DAY;
    list.push({ id: seedId("withdrawal:paid"), amount_naira: share, created_ms: at - DAY, execute_after_ms: at, paid_ms: at });
  }
  st.payouts[ROOF].withdrawals = list;

  if (stage === "refund") {
    const kemi = made[1];
    kemi.status = "refunded";
    kemi.refund_started_ms = now - 3 * HOUR;
  }
}
