"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useR1Api, useR1Auth } from "@/lib/events-r1/hooks";
import { CLAIM_ASK } from "@/lib/events-r1/listing";
import { useClaimsOn } from "../claim/useClaimsOn";
import SignInSheet from "../SignInSheet";
import { looksLikeEmail } from "../signin/helpers";
import { useDialogFocus } from "../signin/useDialogFocus";

/**
 * "Is this your event?": an organiser says so, from the page of a listing. Anyone can ask, signed in or not. It lands in the
 * staff tracker (api.claims.requestClaim); asking twice with the same email is one request. A bottom sheet on a phone, a centred
 * card on a wide screen, in the same style as SignInSheet.
 */
export type ClaimSheetProps = {
  open: boolean;
  eventId: string;
  eventTitle: string;
  onClose: () => void;
};

const field = "mb-1.5 block font-body text-[13px] text-dim";
const btn = "btn w-full text-[15px] font-bold normal-case tracking-normal";

/**
 * The sheet "Is this your event?" opens. With the event_claims flag off it is the old request form (name and email, staff write back). With the
 * flag on it is the ask to claim: sign in, add a note, and staff approve or decline. Hoppaz keeps the name on the account and the note, never an email
 * or a phone number.
 */
export default function ClaimSheet(props: ClaimSheetProps) {
  const claims = useClaimsOn();
  return claims ? <AskSheet {...props} /> : <EmailClaimSheet {...props} />;
}

function EmailClaimSheet({ open, eventId, eventTitle, onClose }: ClaimSheetProps) {
  const api = useR1Api();
  const { user } = useR1Auth();
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = open && mounted;
  useEffect(() => setMounted(true), []);

  useDialogFocus(show, box, onClose);

  // A fresh start each time it is opened. A signed in person has their name and email filled in.
  useEffect(() => {
    if (!open) {
      setName("");
      setEmail("");
      setPhone("");
      setNote("");
      setBusy(false);
      setSent(false);
      setError(null);
      busyRef.current = false;
      return;
    }
    if (user) {
      setName((n) => n || user.name);
      setEmail((m) => m || user.email);
    }
  }, [open, user]);

  useEffect(() => {
    if (show && !sent) nameRef.current?.focus({ preventScroll: true });
  }, [show, sent]);

  if (!show) return null;

  const cleanName = name.trim();
  const cleanEmail = email.trim();
  const ok = cleanName.length > 0 && looksLikeEmail(cleanEmail);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || !api || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.claims.requestClaim(eventId, {
        name: cleanName,
        email: cleanEmail,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setSent(true);
    } catch {
      setError("That did not send. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[94dvh] w-full max-w-[420px] animate-rise overflow-y-auto rounded-t-[12px] border border-b-0 border-line bg-ink-2 px-4 pt-3 text-cream shadow-sheet sm:animate-none sm:rounded-hz sm:border-b sm:px-6 sm:pb-6 sm:pt-6"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" />
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-1.5 top-1.5 grid h-11 w-11 place-items-center sm:right-3 sm:top-3">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-line text-cream">
            <X size={18} strokeWidth={2.4} aria-hidden />
          </span>
        </button>

        {sent ? (
          <div className="flex flex-col gap-3">
            <div className="pr-10">
              <h2 id={titleId} className="font-display text-[22px] font-black leading-[1.15]">
                Thanks. We will email you.
              </h2>
              <p className="hint mt-1.5">We will reply about {eventTitle}.</p>
            </div>
            <p className="sr-only" role="status">
              Your request was sent
            </p>
            <button type="button" className={btn} onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" noValidate>
            <div className="pr-10">
              <h2 id={titleId} className="font-display text-[22px] font-black leading-[1.15]">
                {CLAIM_ASK}
              </h2>
              <p className="hint mt-1.5">Tell us who you are. We will email you to set it up.</p>
            </div>
            <div>
              <label className={field} htmlFor={`${titleId}-name`}>
                Your name
              </label>
              <input
                ref={nameRef}
                id={`${titleId}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoComplete="name"
                autoCapitalize="words"
                enterKeyHint="next"
              />
            </div>
            <div>
              <label className={field} htmlFor={`${titleId}-email`}>
                Email
              </label>
              <input
                id={`${titleId}-email`}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                placeholder="you@email.com"
              />
            </div>
            <div>
              <label className={field} htmlFor={`${titleId}-phone`}>
                Phone (optional)
              </label>
              <input id={`${titleId}-phone`} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" maxLength={30} enterKeyHint="next" />
            </div>
            <div>
              <label className={field} htmlFor={`${titleId}-note`}>
                Note (optional)
              </label>
              <textarea id={`${titleId}-note`} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <p className="hint">We use this only to reply about this event.</p>
            {error && (
              <p role="alert" className="font-body text-[14px] font-medium text-fireant">
                {error}
              </p>
            )}
            <button type="submit" className={btn} disabled={!ok || !api || busy}>
              {busy ? "Sending…" : "Send"}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}

/** The ask to claim (event_claims on). Signed out: sign in first. Signed in: an optional note, then Ask to claim. */
function AskSheet({ open, eventId, eventTitle, onClose }: ClaimSheetProps) {
  const api = useR1Api();
  const { user } = useR1Auth();
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const [mounted, setMounted] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState(false);

  const show = open && mounted;
  useEffect(() => setMounted(true), []);
  useDialogFocus(show && !signIn, box, onClose);
  useEffect(() => {
    if (!open) {
      setNote("");
      setBusy(false);
      setSent(false);
      setError(null);
      setSignIn(false);
      busyRef.current = false;
    }
  }, [open]);
  if (!show) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!api || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.claims.askToClaim(eventId, { note: note.trim() });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "That did not send. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      data-claim-ask
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[94dvh] w-full max-w-[420px] animate-rise overflow-y-auto rounded-t-[12px] border border-b-0 border-line bg-ink-2 px-4 pt-3 text-cream shadow-sheet sm:animate-none sm:rounded-hz sm:border-b sm:px-6 sm:pb-6 sm:pt-6"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" />
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-1.5 top-1.5 grid h-11 w-11 place-items-center sm:right-3 sm:top-3">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-line text-cream">
            <X size={18} strokeWidth={2.4} aria-hidden />
          </span>
        </button>

        {sent ? (
          <div className="flex flex-col gap-3">
            <div className="pr-10">
              <h2 id={titleId} className="font-display text-[22px] font-black leading-[1.15]">
                Thanks. We will check and get back to you.
              </h2>
              <p className="hint mt-1.5">We will reply about {eventTitle}.</p>
            </div>
            <p className="sr-only" role="status">
              Your ask was sent
            </p>
            <button type="button" className={btn} onClick={onClose}>
              Done
            </button>
          </div>
        ) : !user ? (
          <div className="flex flex-col gap-3">
            <div className="pr-10">
              <h2 id={titleId} className="font-display text-[22px] font-black leading-[1.15]">
                {CLAIM_ASK} Claim it
              </h2>
              <p className="hint mt-1.5">Sign in, then ask to take over {eventTitle} and its room. Hoppaz checks and gets back to you.</p>
            </div>
            <button type="button" className={btn} onClick={() => setSignIn(true)}>
              Sign in to ask
            </button>
            <p className="hint">Got a claim link from Hoppaz? Open it to take over straight away.</p>
            <SignInSheet open={signIn} reason={`Claim ${eventTitle}`} onClose={() => setSignIn(false)} onSignedIn={() => setSignIn(false)} />
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" noValidate>
            <div className="pr-10">
              <h2 id={titleId} className="font-display text-[22px] font-black leading-[1.15]">
                {CLAIM_ASK} Claim it
              </h2>
              <p className="hint mt-1.5">Ask to take over {eventTitle} and its room as {user.name}.</p>
            </div>
            <div>
              <label className={field} htmlFor={`${titleId}-note`}>
                Anything we should know? (optional)
              </label>
              <textarea id={`${titleId}-note`} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <p className="hint">We keep your name and this note. We do not keep an email or a phone number.</p>
            {error && (
              <p role="alert" className="font-body text-[14px] font-medium text-fireant">
                {error}
              </p>
            )}
            <button type="submit" className={btn} disabled={!api || busy}>
              {busy ? "Sending…" : "Ask to claim"}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}

/**
 * The text link that opens the sheet. Put it under the Listed by line. `className` styles the link (the surrounding screen
 * knows its own colours: the tinted event page and the dark cards differ).
 */
export function ClaimLink({ eventId, eventTitle, className }: { eventId: string; eventTitle: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const claims = useClaimsOn();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className ?? "min-h-[44px] text-left font-body text-[13px] text-dim underline underline-offset-4"}>
        {claims ? `${CLAIM_ASK} Claim it` : CLAIM_ASK}
      </button>
      <ClaimSheet open={open} eventId={eventId} eventTitle={eventTitle} onClose={() => setOpen(false)} />
    </>
  );
}
