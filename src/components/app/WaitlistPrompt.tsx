"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import SignupForm from "@/components/app/SignupForm";
import { useFirstRun } from "@/lib/firstRun";
import { useSession } from "@/lib/useSession";

const SNOOZE = "hoppaz.waitlist-snooze";
const DAY = 24 * 3.6e6;
/** Time on the map before the card comes: the opening and the first look at the events land first. */
const SETTLE_MS = 12_000;
/** The first run's location card is answered first, unless it is left sitting there this long. */
const LOCATION_WAIT_MS = 25_000;

/**
 * Early access on the map: a small card asks a guest to join the waitlist. Nothing dims and the map stays usable; the
 * sign up form (SignupForm: Google, or email and password) only opens when they tap JOIN THE WAITLIST. Joining makes the
 * account, so the guest's progress is kept and the waitlist is the accounts list. It comes once, after the opening and
 * the location card; "Explore first" or the x hides it for 3 days and leaves a small JOIN WAITLIST pill on the map.
 * Anyone with an account never sees either.
 */
export default function WaitlistPrompt() {
  const path = usePathname();
  const { hasAccount, profile, state } = useSession();
  const step = useFirstRun((s) => s.step);
  const [open, setOpen] = useState(false);
  const [joined, setJoined] = useState(false);
  const [snoozed, setSnoozed] = useState(true);
  const [settled, setSettled] = useState(false);
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    try {
      setSnoozed(Date.now() < Number(localStorage.getItem(SNOOZE) ?? 0));
    } catch {
      setSnoozed(false);
    }
  }, []);

  const onMap = path === "/";
  const guest = state === "ready" && !hasAccount;
  useEffect(() => {
    if (!onMap) return;
    const a = window.setTimeout(() => setSettled(true), SETTLE_MS);
    const b = window.setTimeout(() => setWaited(true), LOCATION_WAIT_MS);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [onMap]);

  useEffect(() => {
    if (onMap && guest && !snoozed && settled && (step !== "location" || waited)) setOpen(true);
  }, [onMap, guest, snoozed, settled, step, waited]);

  const close = () => {
    setOpen(false);
    setSnoozed(true);
    try {
      localStorage.setItem(SNOOZE, String(Date.now() + 3 * DAY));
    } catch {
      /* private mode: it may ask again next visit */
    }
  };

  // The card stays up after joining to say so; the account then keeps both away for good.
  if (!open && !guest) return null;
  // The pill keeps out of the way of the save-your-XP banner, which takes the same corner.
  const pill = onMap && guest && snoozed && !open && (profile?.xp ?? 0) === 0;
  return (
    <>
      {pill && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed left-4 z-[41] rounded-full border border-line bg-ink-2 px-4 py-2 font-mono text-[11px] tracking-[0.12em] text-cream shadow-sheet"
          style={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom, 0px))" }}
        >
          JOIN WAITLIST
        </button>
      )}
      {open && onMap && <Card joined={joined} onJoined={() => setJoined(true)} onClose={close} />}
    </>
  );
}

function Card({ joined, onJoined, onClose }: { joined: boolean; onJoined: () => void; onClose: () => void }) {
  const [form, setForm] = useState(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    // No backdrop: the map around the card keeps working.
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[45] grid place-items-center px-4" style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))" }}>
      <div
        role="dialog"
        aria-labelledby="wl-title"
        className="pointer-events-auto relative max-h-full w-full max-w-[380px] animate-rise overflow-y-auto rounded-hz border border-line bg-ink-2 px-4 pb-4 pt-5 text-cream shadow-sheet"
      >
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-1.5 top-1.5 grid h-10 w-10 place-items-center text-dim">
          <X size={18} aria-hidden />
        </button>
        {joined ? (
          <>
            <p className="font-mono text-[11px] tracking-[0.14em] text-fireant">YOU&apos;RE IN</p>
            <h2 id="wl-title" className="mt-1.5 font-display text-[22px] font-black leading-tight">You&apos;re on the list.</h2>
            <p className="mt-1.5 font-body text-[14px] text-dim">
              Your account is saved. We&apos;ll email you the moment everything opens. Keep exploring.
            </p>
            <button type="button" onClick={onClose} className="btn mt-4 w-full">
              KEEP EXPLORING
            </button>
          </>
        ) : (
          <>
            <p className="font-mono text-[11px] tracking-[0.14em] text-fireant">EARLY ACCESS · LAGOS</p>
            <h2 id="wl-title" className="mt-1.5 pr-8 font-display text-[22px] font-black leading-tight">You&apos;re early, Hopper.</h2>
            <p className="mt-1.5 font-body text-[14px] text-dim">
              Hoppaz is still being built. The map and this week&apos;s events are open now, so look around. Rooms, crews and
              tickets open soon. Join the waitlist and you hear first.
            </p>
            {form ? (
              <div className="mt-4">
                <SignupForm createLabel="JOIN THE WAITLIST" onDone={onJoined} />
              </div>
            ) : (
              <button type="button" onClick={() => setForm(true)} className="btn mt-4 w-full">
                JOIN THE WAITLIST
              </button>
            )}
            <button type="button" onClick={onClose} className="btn btn-ghost mt-2 w-full normal-case">
              Explore first
            </button>
          </>
        )}
      </div>
    </div>
  );
}
