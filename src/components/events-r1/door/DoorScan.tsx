"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import SignInSheet from "@/components/events-r1/SignInSheet";
import { useR1Api, useR1Auth, useR1Event, useR1Query } from "@/lib/events-r1/hooks";
import type { Registration, ScanResult } from "@/lib/events-r1/types";
import DoorCamera from "./DoorCamera";
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
 * gets the sign-in sheet. Everything goes through api.door.*. Dark, big touch targets, made for a phone at the door.
 */
export default function DoorScan({ id }: { id: string }) {
  const router = useRouter();
  const api = useR1Api();
  useR1Auth(); // re-render on sign in and sign out
  const event = useR1Event(id);
  const eid = event.data?.id ?? null;
  const counts = useR1Query((a) => (eid ? a.door.counts(eid) : Promise.resolve(null)), [eid]);

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

  const signedIn = api ? !!api.auth.current() : null;
  const denied = signedIn === true && counts.error?.message === "Not allowed";
  useEffect(() => {
    if (denied) router.replace(`/event/${encodeURIComponent(id)}`);
  }, [denied, id, router]);

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
    <div className="h-full overflow-y-auto bg-ink px-4 pb-10">
      <div className="mx-auto w-full max-w-4xl">{children}</div>
    </div>
  );

  if (signedIn === null) return shell(<p className="hint pad-top">Loading</p>);

  if (!signedIn) {
    return shell(
      <div className="pad-top">
        <h1 className="font-display text-[26px] font-black leading-tight">Check in</h1>
        <p className="hint mt-1">Sign in to check people in.</p>
        <button type="button" className="btn mt-4 px-5 normal-case" onClick={() => setAsked(true)}>
          Sign in
        </button>
        <SignInSheet open={asked} reason="Check people in" onClose={() => setAsked(false)} onSignedIn={() => setAsked(false)} />
      </div>
    );
  }

  const e = event.data;
  if (denied) return shell(<p className="hint pad-top">Taking you to the event page</p>);
  if (!e) {
    return shell(
      event.loading ? (
        <p className="hint pad-top">Loading</p>
      ) : (
        <div className="pad-top">
          <h1 className="font-display text-[26px] font-black leading-tight">We can&apos;t find this event</h1>
          <Link href="/" className="btn mt-4 px-5 normal-case">
            Back to events
          </Link>
        </div>
      )
    );
  }

  const c = counts.data;
  const checkedIn = c?.checked_in ?? 0;
  const total = c ? c.going : 0;
  const back = () => {
    const nav = (window as Window & { navigation?: { canGoBack: boolean } }).navigation;
    if (nav ? nav.canGoBack : window.history.length > 1) router.back();
    else router.replace(`/host/${encodeURIComponent(e.id)}`);
  };

  const header = (
    <header className="pad-top pb-3">
      <div className="flex items-center gap-1">
        <button type="button" onClick={back} aria-label="Back" className="-ml-3 grid h-11 w-11 flex-none place-items-center text-cream">
          <ChevronLeft size={26} strokeWidth={2.2} aria-hidden />
        </button>
        <h1 className="min-w-0 flex-1 truncate font-display text-[22px] font-black leading-tight">Check in · {e.title}</h1>
      </div>
    </header>
  );

  // An online event has no door: joining a call is not a check-in.
  if (e.kind === "online") {
    return shell(
      <>
        {header}
        <p className="font-body text-[15px] text-cream">This event is online, so there is no door to scan.</p>
        <Link href={`/host/${encodeURIComponent(e.id)}`} className="btn mt-4 px-5 normal-case">
          Back to your event
        </Link>
      </>
    );
  }

  return shell(
    <>
      {header}
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
        <div className="space-y-3">
          <div className="rounded-hz border border-line bg-ink-2 p-4">
            <p className="font-body text-[15px] text-cream" aria-live="polite">
              <b className="num text-[28px]">{checkedIn}</b> of <b className="num text-[28px]">{total}</b> checked in
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-3" aria-hidden>
              <div className="h-full rounded-full bg-keke transition-[width]" style={{ width: `${total ? Math.min(100, (checkedIn / total) * 100) : 0}%` }} />
            </div>
          </div>

          <div role="radiogroup" aria-label="Check in mode" className="grid grid-cols-2 gap-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => pick(m.id)}
                className={clsx("min-h-[56px] rounded-hz border px-3 py-2 text-left transition-colors", mode === m.id ? "border-orange bg-orange/15" : "border-line bg-ink-2")}
              >
                <span className="block font-display text-[15px] font-black text-cream">{m.name}</span>
                <span className="block font-body text-[12px] leading-tight text-dim">{m.sub}</span>
              </button>
            ))}
          </div>

          <DoorCamera onRead={check} paused={busy || !!pending} />

          <div aria-live="polite">
            {result && <ResultBanner result={result} busy={busy} onConfirm={confirm} onSkip={skip} onClose={skip} />}
            {fail && (
              <p role="alert" className="rounded-hz border-2 border-fireant bg-fireant/15 p-4 font-body text-[15px] text-fireant">
                {fail}
              </p>
            )}
          </div>

          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              check(code);
              setCode("");
            }}
          >
            <label htmlFor="door-code" className="mb-1.5 block font-body text-[13px] text-dim">
              Type the code
            </label>
            <div className="flex gap-2">
              <input
                id="door-code"
                value={code}
                onChange={(ev) => setCode(ev.target.value)}
                placeholder="The short code under the QR"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="min-h-[48px] flex-1 font-mono uppercase"
              />
              <button type="submit" className="btn min-h-[48px] flex-none px-5 normal-case" disabled={busy || !code.trim() || !!pending}>
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
              <label htmlFor="door-token" className="mb-1.5 block font-body text-[13px] text-dim">
                Test with a typed token
              </label>
              <div className="flex gap-2">
                <input
                  id="door-token"
                  value={token}
                  onChange={(ev) => setToken(ev.target.value)}
                  placeholder="Paste a ticket token from /dev/events-r1"
                  autoComplete="off"
                  spellCheck={false}
                  className="min-h-[48px] flex-1 font-mono text-[13px]"
                />
                <button type="submit" className="btn btn-ghost min-h-[48px] flex-none px-5 normal-case" disabled={busy || !token.trim() || !!pending}>
                  Scan
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="mt-6 lg:mt-0">
          <GuestSearch eventId={e.id} busy={busy} onCheckIn={checkInGuest} />
        </div>
      </div>
    </>
  );
}
