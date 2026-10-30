"use client";

/* eslint-disable @next/next/no-img-element -- covers are data URLs, template files or bucket links of unknown size */

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import TintShell, { usePictureTint } from "@/components/host/TintShell";
import { fallbackCover } from "@/components/events-r1/page/HostStory";
import SignInSheet from "@/components/events-r1/SignInSheet";
import { useR1Api, useR1Auth, useR1Event, useR1Query } from "@/lib/events-r1/hooks";
import { DEFAULT_LOOK } from "@/lib/events-r1/looks";
import type { Look } from "@/lib/events-r1/looks";
import type { Registration, ScanResult } from "@/lib/events-r1/types";
import { themeForEvent } from "@/lib/theme";
import DoorCamera from "./DoorCamera";
import DoorStaffCard from "./DoorStaffCard";
import GuestSearch from "./GuestSearch";
import ResultBanner from "./ResultBanner";
import { errLine } from "./helpers";

type Mode = "express" | "standard";
const MODES: Array<{ id: Mode; name: string; sub: string }> = [
  { id: "express", name: "Express", sub: "Checks in on scan" },
  { id: "standard", name: "Standard", sub: "Shows the guest first" },
];
const MODE_KEY = "hoppaz-door-mode";

/** A short buzz on a phone that has one. Nothing else: no sound, no pop-ups. */
function buzz(ok: boolean) {
  try {
    navigator.vibrate?.(ok ? 60 : [100, 60, 100]);
  } catch {}
}

/**
 * Release 1 door scan at /host/<id>/door. Host and staff only: anyone else goes to the event page, someone signed out
 * gets the sign-in sheet. Everything goes through api.door.*. It wears the event's look like the dashboard (TintShell), with big
 * touch targets for a phone at the door. Only the result banners use fixed status colours.
 * A manager (host, room owner or admin) gets a link back to the dashboard; door staff only ever see the door.
 */
export default function DoorScan({ id }: { id: string }) {
  const router = useRouter();
  const api = useR1Api();
  useR1Auth(); // re-render on sign in and sign out
  const event = useR1Event(id);
  const eid = event.data?.id ?? null;
  const counts = useR1Query((a) => (eid ? a.door.counts(eid) : Promise.resolve(null)), [eid]);
  // Door staff are refused the staff list, so a list that loads means this person manages the event.
  const team = useR1Query((a) => (eid ? a.door.staff(eid) : Promise.resolve(null)), [eid]);
  const manager = !team.error && !!team.data;
  const savedLook = useR1Query((a) => a.looks.get("event", id), [id]);
  const cover = event.data ? event.data.flyer_url || fallbackCover(event.data.id) : null;
  const look: Look = savedLook.data ?? { ...DEFAULT_LOOK, mood: event.data && themeForEvent(event.data.starts_at) === "day" ? "day" : "night", auto: true };
  const tint = usePictureTint(cover, look);

  const [asked, setAsked] = useState(true);
  const [mode, setMode] = useState<Mode>("express");
  const [result, setResult] = useState<ScanResult | null>(null);
  /** Standard mode: the token that is waiting for Check in or Skip. */
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const working = useRef(false);

  useEffect(() => {
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (m === "express" || m === "standard") setMode(m);
    } catch {}
  }, []);
  const pick = (m: Mode) => {
    setMode(m);
    setPending(null);
    setResult(null);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {}
  };

  // Not host or staff: to the event page. Only a fresh answer counts: the "Not allowed" from before signing in is still held
  // for a moment after the host signs in at the door, and must not send them away before the counts are asked again.
  const signedIn = api ? !!api.auth.current() : null;
  const notAllowed = counts.error?.message === "Not allowed" ? counts.error : null;
  useEffect(() => {
    if (notAllowed && api?.auth.current()) router.replace(`/event/${encodeURIComponent(id)}`);
  }, [notAllowed, api, id, router]);

  /** One call at a time: a camera that sees the same QR twice must not check in twice. */
  const run = async (fn: () => Promise<ScanResult>, then?: (r: ScanResult) => void) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setFail("");
    try {
      const r = await fn();
      setResult(r);
      buzz(r.ok);
      then?.(r);
    } catch (e) {
      setFail(errLine(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const check = (value: string) => {
    const v = value.trim();
    if (!api || !eid || !v || pending) return;
    void run(
      () => api.door.scan(eid, v, mode),
      (r) => setPending(r.ok && r.kind === "confirm" ? v : null)
    );
  };
  const confirm = () => {
    if (!api || !eid || !pending) return;
    const t = pending;
    void run(() => api.door.confirm(eid, t), () => setPending(null));
  };
  const skip = () => {
    setPending(null);
    setResult(null);
  };
  const checkInGuest = (r: Registration) => {
    if (!api || !eid) return;
    setPending(null);
    void run(() => api.door.checkInById(eid, r.id));
  };

  const shell = (children: React.ReactNode) => (
    <div className="h-full overflow-y-auto">
      <TintShell look={look} tint={tint} className="min-h-full">
        {children}
      </TintShell>
    </div>
  );
  const plain = (children: React.ReactNode) => shell(<div className="mx-auto w-full max-w-4xl px-4 pb-28">{children}</div>);

  if (signedIn === null) return plain(<p className="hint pad-top">Loading</p>);

  if (!signedIn) {
    return plain(
      <div className="pad-top">
        <h1 className="t-title text-[26px] font-extrabold leading-tight">Check in</h1>
        <p className="hint mt-1">Sign in to check people in.</p>
        <button type="button" className="lip mt-4" onClick={() => setAsked(true)}>
          Sign in
        </button>
        <SignInSheet open={asked} reason="Check people in" onClose={() => setAsked(false)} onSignedIn={() => setAsked(false)} />
      </div>
    );
  }

  const e = event.data;
  if (notAllowed && counts.loading === false && !counts.data) return plain(<p className="hint pad-top">Checking you can scan</p>);
  if (!e) {
    return plain(
      event.loading ? (
        <p className="hint pad-top">Loading</p>
      ) : (
        <div className="pad-top">
          <h1 className="t-title text-[26px] font-extrabold leading-tight">We can&apos;t find this event</h1>
          <Link href="/" className="lip mt-4">
            Back to events
          </Link>
        </div>
      )
    );
  }

  const c = counts.data;
  const checkedIn = c?.checked_in ?? 0;
  const total = c ? c.going : 0;
  const stats: Array<{ label: string; n: number; main?: boolean }> = [
    { label: "Checked in", n: checkedIn, main: true },
    { label: "Going", n: total },
    { label: "Pending", n: c?.pending ?? 0 },
    { label: "Waitlist", n: c?.waitlist ?? 0 },
  ];

  const header = (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-t-line bg-t-bg px-4 py-2.5 lg:px-5 lg:py-3">
      {manager && (
        <Link href={`/host/${encodeURIComponent(e.id)}`} aria-label="Back to the dashboard" className="-ml-2 grid h-11 w-9 flex-none place-items-center text-t-text" data-dashboard-back>
          <ChevronLeft size={22} strokeWidth={2.2} aria-hidden />
        </Link>
      )}
      {cover && <img src={cover} alt="" className="h-10 w-10 flex-none rounded-hz border border-t-line object-cover" />}
      <div className="min-w-0 flex-1">
        <h1 className="t-title truncate text-[17px] font-extrabold leading-tight lg:text-[19px]">Check in</h1>
        <p className="truncate font-body text-[13px] text-t-muted">{e.title}</p>
      </div>
    </header>
  );

  // An online event has no door: joining a call is not a check-in.
  if (e.kind === "online") {
    return shell(
      <>
        {header}
        <div className="mx-auto w-full max-w-4xl px-4 pb-28 pt-5">
          <p className="font-body text-[15px] text-t-text">This event is online, so there is no door to scan.</p>
          {manager && (
            <Link href={`/host/${encodeURIComponent(e.id)}`} className="lip mt-4">
              Back to your event
            </Link>
          )}
        </div>
      </>
    );
  }

  return shell(
    <>
      {header}
      <div className="t-adopt mx-auto w-full max-w-4xl px-4 pb-28 pt-4 lg:pt-6">
        <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
          <div className="space-y-3">
            <div className="t-card p-4">
              <div className="grid grid-cols-4 items-end gap-2" aria-live="polite">
                {stats.map((x) => (
                  <p key={x.label} className="min-w-0">
                    <span className={clsx("block font-body font-extrabold leading-none tabular-nums text-t-text", x.main ? "text-[34px]" : "text-[24px]")}>{x.n}</span>
                    <span className="mt-1 block truncate font-body text-[12.5px] text-t-muted">{x.label}</span>
                  </p>
                ))}
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-t-soft" role="progressbar" aria-label="Checked in" aria-valuemin={0} aria-valuemax={total} aria-valuenow={checkedIn}>
                <div className="h-full rounded-full bg-t-accent transition-[width]" style={{ width: `${total ? Math.min(100, (checkedIn / total) * 100) : 0}%` }} />
              </div>
            </div>

            <div aria-live="polite">
              {result && <ResultBanner result={result} busy={busy} onConfirm={confirm} onSkip={skip} onClose={skip} />}
              {fail && (
                <p role="alert" className="rounded-hz border-2 border-[#C8262B] bg-[#C8262B] p-4 font-body text-[16px] font-bold text-white">
                  {fail}
                </p>
              )}
            </div>

            <DoorCamera onRead={check} paused={busy || !!pending} quiet={!!pending} />

            <div role="radiogroup" aria-label="Check in mode" className="grid grid-cols-2 gap-2">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
                  onClick={() => pick(m.id)}
                  className={clsx("min-h-[56px] rounded-hz border px-3 py-2 text-left transition-colors", mode === m.id ? "border-t-accent bg-t-soft" : "border-t-line bg-t-tile")}
                >
                  <span className="block font-body text-[15px] font-extrabold text-t-text">{m.name}</span>
                  <span className="block font-body text-[12.5px] leading-tight text-t-muted">{m.sub}</span>
                </button>
              ))}
            </div>

            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                check(code);
                setCode("");
              }}
            >
              <label htmlFor="door-code" className="mb-1.5 block font-body text-[13px] text-t-muted">
                Type the code
              </label>
              <div className="flex gap-2">
                <input
                  id="door-code"
                  value={code}
                  onChange={(ev) => setCode(ev.target.value)}
                  placeholder="Code under the QR"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="min-h-[48px] flex-1 font-mono uppercase"
                />
                <button type="submit" className="lip-ghost !min-h-[48px] flex-none !px-5" disabled={busy || !code.trim() || !!pending}>
                  Check
                </button>
              </div>
            </form>

            {api?.mode === "fake" && (
              <form
                onSubmit={(ev) => {
                  ev.preventDefault();
                  check(token);
                  setToken("");
                }}
              >
                <label htmlFor="door-token" className="mb-1.5 block font-body text-[13px] text-t-muted">
                  Test with a typed token (from /dev/events-r1)
                </label>
                <div className="flex gap-2">
                  <input
                    id="door-token"
                    value={token}
                    onChange={(ev) => setToken(ev.target.value)}
                    placeholder="Paste a ticket token"
                    autoComplete="off"
                    spellCheck={false}
                    className="min-h-[48px] flex-1 font-mono text-[13px]"
                  />
                  <button type="submit" className="lip-ghost !min-h-[48px] flex-none !px-5" disabled={busy || !token.trim() || !!pending}>
                    Scan
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="mt-6 lg:mt-0">
            <GuestSearch eventId={e.id} busy={busy} onCheckIn={checkInGuest} />
            <div className="mt-6">
              <DoorStaffCard eventId={e.id} quiet />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
