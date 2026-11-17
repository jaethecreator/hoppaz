"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { EventsR1Api, OutreachApi } from "@/lib/events-r1/api";
import { loadApi } from "@/lib/events-r1";
import { useClaimsOn } from "@/components/events-r1/claim/useClaimsOn";
import type { Claimable, ClaimAsk, ClaimRequest, Organiser, PulledEvent, TapCounts } from "@/lib/events-r1/types";

/**
 * The Outreach section's data. The desk shell calls useOutreachData once (so the rail can show the count before the section is
 * opened); the section and its tabs read it through the context. Lists are held here as state so a tab can change them at once
 * (optimistic) and put them back if the call fails. Reasons come from the data layer as Error.message text.
 */

export const STAFF_KEY = "hz.desk.staff";

export type OutreachData = {
  api: OutreachApi | null;
  queue: PulledEvent[] | null;
  setQueue: Dispatch<SetStateAction<PulledEvent[] | null>>;
  organisers: Organiser[] | null;
  setOrganisers: Dispatch<SetStateAction<Organiser[] | null>>;
  requests: ClaimRequest[] | null;
  setRequests: Dispatch<SetStateAction<ClaimRequest[] | null>>;
  /** Is "claim an event" on (the event_claims flag)? The Claimable tab and the Copy claim link buttons show only then. */
  claimsOn: boolean;
  /** "[N] people went to buy": taps on the outside ticket button, by event and by organiser. null until loaded (or when it cannot be read). */
  taps: TapCounts | null;
  /** Unclaimed listings still to come, and asks to claim. null until loaded, or while the flag is off. */
  claimable: Claimable[] | null;
  setClaimable: Dispatch<SetStateAction<Claimable[] | null>>;
  asks: ClaimAsk[] | null;
  setAsks: Dispatch<SetStateAction<ClaimAsk[] | null>>;
  /** Plain text of the last failed load per list ("" when fine). */
  errors: { queue: string; organisers: string; requests: string; claims: string };
  loading: boolean;
  reloadQueue: () => Promise<void>;
  reloadOrganisers: () => Promise<void>;
  reloadRequests: () => Promise<void>;
  reloadClaims: () => Promise<void>;
  reload: () => Promise<void>;
  /** Review rows waiting plus new claim requests and new asks to claim. 0 until loaded. */
  badge: number;
};

const message = (e: unknown) => (e instanceof Error ? e.message : "That did not work");

export function useOutreachData(enabled: boolean): OutreachData {
  const [root, setRoot] = useState<EventsR1Api | null>(null);
  const api = root?.outreach ?? null;
  const [queue, setQueue] = useState<PulledEvent[] | null>(null);
  const [organisers, setOrganisers] = useState<Organiser[] | null>(null);
  const [requests, setRequests] = useState<ClaimRequest[] | null>(null);
  const claimsOn = useClaimsOn();
  const [taps, setTaps] = useState<TapCounts | null>(null);
  const [claimable, setClaimable] = useState<Claimable[] | null>(null);
  const [asks, setAsks] = useState<ClaimAsk[] | null>(null);
  const [errors, setErrors] = useState({ queue: "", organisers: "", requests: "", claims: "" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    loadApi().then(
      (a) => live && setRoot(a),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [enabled]);

  const reloadQueue = useCallback(async () => {
    if (!api) return;
    try {
      setQueue(await api.queue());
      setErrors((e) => ({ ...e, queue: "" }));
    } catch (e) {
      setErrors((x) => ({ ...x, queue: message(e) }));
    }
  }, [api]);
  const reloadOrganisers = useCallback(async () => {
    if (!api) return;
    try {
      setOrganisers(await api.organisers());
      setErrors((e) => ({ ...e, organisers: "" }));
    } catch (e) {
      setErrors((x) => ({ ...x, organisers: message(e) }));
    }
  }, [api]);
  const reloadRequests = useCallback(async () => {
    if (!api) return;
    try {
      setRequests(await api.claimRequests());
      setErrors((e) => ({ ...e, requests: "" }));
    } catch (e) {
      setErrors((x) => ({ ...x, requests: message(e) }));
    }
  }, [api]);
  const reloadClaims = useCallback(async () => {
    if (!api) return;
    // The tap numbers are a nicety: when they cannot be read the desk simply shows none.
    try {
      setTaps(await api.tapCounts());
    } catch {
      setTaps(null);
    }
    if (!claimsOn) {
      setClaimable(null);
      setAsks(null);
      setErrors((e) => ({ ...e, claims: "" }));
      return;
    }
    try {
      const [c, a] = await Promise.all([api.claimable(), api.claimAsks()]);
      setClaimable(c);
      setAsks(a);
      setErrors((e) => ({ ...e, claims: "" }));
    } catch (e) {
      setErrors((x) => ({ ...x, claims: message(e) }));
    }
  }, [api, claimsOn]);
  const reload = useCallback(async () => {
    setLoading(true);
    await Promise.all([reloadQueue(), reloadOrganisers(), reloadRequests(), reloadClaims()]);
    setLoading(false);
  }, [reloadQueue, reloadOrganisers, reloadRequests, reloadClaims]);

  useEffect(() => {
    if (api) void reload();
  }, [api, reload]);

  // The data layer says when something changed (the fake does; the real one is not wired to) and a tab left open for a while comes back
  // stale, so reload on both. The scout runs elsewhere, so the queue can fill while this page is open.
  useEffect(() => {
    if (!root) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(t);
      t = setTimeout(() => void reload(), 200);
    };
    let off: (() => void) | undefined;
    try {
      off = root.events.subscribe(later);
    } catch {
      /* the real layer has nothing to listen to */
    }
    const back = () => document.visibilityState === "visible" && later();
    document.addEventListener("visibilitychange", back);
    return () => {
      clearTimeout(t);
      off?.();
      document.removeEventListener("visibilitychange", back);
    };
  }, [root, reload]);

  const badge = (queue ?? []).filter((r) => r.status !== "blocked").length + (requests ?? []).filter((r) => r.status === "new").length + (asks ?? []).filter((r) => r.status === "new").length;

  return useMemo(
    () => ({
      api, queue, setQueue, organisers, setOrganisers, requests, setRequests, claimsOn, taps, claimable, setClaimable, asks, setAsks, errors, loading,
      reloadQueue, reloadOrganisers, reloadRequests, reloadClaims, reload, badge,
    }),
    [api, queue, organisers, requests, claimsOn, taps, claimable, asks, errors, loading, reloadQueue, reloadOrganisers, reloadRequests, reloadClaims, reload, badge],
  );
}

/** Who is using the desk: a label kept on this computer, passed as `by` on every action. */
export function useStaffName(): [string, (v: string) => void] {
  const [name, setName] = useState("Jae");
  useEffect(() => {
    try {
      const v = localStorage.getItem(STAFF_KEY);
      if (v) setName(v);
    } catch {
      /* private window: keep the default */
    }
  }, []);
  const set = useCallback((v: string) => {
    setName(v);
    try {
      localStorage.setItem(STAFF_KEY, v);
    } catch {
      /* not saved, still used for this visit */
    }
  }, []);
  return [name, set];
}

export type Tone = "ok" | "error";
export type FocusRequest = { id: string; mode?: "message" | "contact" | "reply" | "link"; email?: string; n: number };

export type OutreachCtx = {
  data: OutreachData;
  api: OutreachApi;
  /** The staff label, never empty. */
  by: string;
  /** Show a line at the top of the section. Errors stay until closed. */
  say: (text: string, tone?: Tone) => void;
  /** Go to the Organisers tab and open this organiser (optionally straight into an action). */
  openOrganiser: (id: string, mode?: FocusRequest["mode"], email?: string) => void;
};

export const OutreachContext = createContext<OutreachCtx | null>(null);

export function useOutreach(): OutreachCtx {
  const c = useContext(OutreachContext);
  if (!c) throw new Error("Outreach context missing");
  return c;
}
