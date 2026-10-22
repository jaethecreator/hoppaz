"use client";

import { useEffect, useState } from "react";
import { paidTicketsOn, PAID_KEY } from "@/lib/events-r1/flags";
import { useR1Api, useR1Query } from "@/lib/events-r1/hooks";
import type { HostPayout, Order, Sales } from "@/lib/events-r1/pay";

/**
 * Is paid tickets on right now? Read after mount (the demo switch lives in localStorage, so the server render is always
 * Off) and again when the switch changes in another tab.
 */
export function usePaidOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn(paidTicketsOn());
    read();
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === PAID_KEY) read();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return on;
}

/** The signed-in host's payout setup, or null (not asked, signed out, or paid tickets off). */
export function useHostPayout(enabled: boolean) {
  return useR1Query<HostPayout | null>(async (api) => (enabled && api.auth.current() ? api.pay.hostPayout() : null), [enabled]);
}

/**
 * What a host sees about paid tickets on a form: "off" (paid tickets off), "loading", "signedout", "needs" (cannot sell yet:
 * Set up payouts first) or "ready". `payout` is Bachs's answer when there is one.
 */
export function usePaidGate(): { state: "off" | "loading" | "signedout" | "needs" | "ready"; payout: HostPayout | null } {
  const on = usePaidOn();
  const { data, loading } = useHostPayout(on);
  const api = useR1Api();
  if (!on) return { state: "off", payout: null };
  if (loading) return { state: "loading", payout: null };
  if (!data) return { state: api?.auth.current() ? "loading" : "signedout", payout: null };
  return { state: data.can_sell ? "ready" : "needs", payout: data };
}

/** Host: every order of one event (empty when paid tickets are off). */
export function useEventOrders(eventId: string, enabled: boolean) {
  return useR1Query<Order[]>(async (api) => (enabled ? api.pay.eventOrders(eventId) : []), [eventId, enabled]);
}

/** Host: what the event has sold (null when paid tickets are off). */
export function useSales(eventId: string, enabled: boolean) {
  return useR1Query<Sales | null>(async (api) => (enabled ? api.pay.sales(eventId) : null), [eventId, enabled]);
}
