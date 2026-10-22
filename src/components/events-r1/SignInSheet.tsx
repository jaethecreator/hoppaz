"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useR1Api, useR1Auth } from "@/lib/events-r1/hooks";
import type { AuthUser } from "@/lib/events-r1/types";
import { clock, looksLikeEmail, nameFromEmail, sixDigits } from "./signin/helpers";
import { useDialogFocus } from "./signin/useDialogFocus";

/**
 * Release 1 sign in: email, six digit code, or Google. Asked only on Register or Create.
 * A bottom sheet on a phone, a centred card on a wide screen. Signing in and signing up are the same thing:
 * a new email makes the account.
 */
export type SignInSheetProps = {
  open: boolean;
  /** One line that says why, e.g. "Register for Afro Soirée". */
  reason: string;
  onClose: () => void;
  onSignedIn: (user: AuthUser) => void;
};

const RESEND_SECS = 30;

const field = "mb-1.5 block font-body text-[13px] text-dim";
/** The app's lip button, but in sentence case like the rest of Release 1. */
const btn = "btn w-full text-[15px] font-bold normal-case tracking-normal";
const link = "min-h-[44px] font-body text-[14px] text-dim underline underline-offset-4 disabled:no-underline";

export default function SignInSheet({ open, reason, onClose, onSignedIn }: SignInSheetProps) {
  const api = useR1Api();
  const { ready, sendCode, verifyCode, google } = useR1Auth();
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  // The layer is drawn straight into the page body: it belongs above everything, wherever the screen that asks for it sits.
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [busy, setBusy] = useState<null | "email" | "code" | "google">(null);
  const [error, setError] = useState<string | null>(null);
  const [secs, setSecs] = useState(RESEND_SECS);
  const [resent, setResent] = useState(false);

  const show = open && mounted;
  useEffect(() => setMounted(true), []);

  useDialogFocus(show, box, onClose);

  // A fresh start each time it is opened.
  useEffect(() => {
    if (open) return;
    setStep("email");
    setEmail("");
    setCode("");
    setName("");
    setNameEdited(false);
    setBusy(null);
    setError(null);
    setSecs(RESEND_SECS);
    setResent(false);
    busyRef.current = false;
  }, [open]);

  // Focus follows the step.
  useEffect(() => {
    if (!show) return;
    (step === "email" ? emailRef : codeRef).current?.focus({ preventScroll: true });
  }, [show, step]);

  // The resend countdown, one second at a time.
  useEffect(() => {
    if (!show || step !== "code" || secs <= 0) return;
    const id = window.setTimeout(() => setSecs((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [show, step, secs]);

  if (!show) return null;

  const cleanEmail = email.trim();
  const emailOk = looksLikeEmail(cleanEmail);

  /** Run one action at a time; the first to start wins. */
  const run = async (which: "email" | "code" | "google", fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(which);
    setError(null);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const done = (user: AuthUser) => {
    onSignedIn(user);
    onClose();
  };

  const submitEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailOk || !ready) return;
    void run("email", async () => {
      try {
        await sendCode(cleanEmail);
      } catch {
        setError("Could not send the code. Try again.");
        return;
      }
      if (!nameEdited) setName(nameFromEmail(cleanEmail));
      setCode("");
      setSecs(RESEND_SECS);
      setResent(false);
      setStep("code");
    });
  };

  const verify = (digits: string) => {
    if (digits.length !== 6) return setError("Enter the 6 digit code");
    void run("code", async () => {
      try {
        done(await verifyCode(cleanEmail, digits, name.trim() || undefined));
      } catch {
        setError("That code did not work");
        setCode("");
        codeRef.current?.focus({ preventScroll: true });
      }
    });
  };

  const onCode = (raw: string) => {
    const digits = sixDigits(raw);
    setCode(digits);
    setError(null);
    if (digits.length === 6) verify(digits);
  };

  const resend = () => {
    if (secs > 0) return;
    void run("email", async () => {
      try {
        await sendCode(cleanEmail);
      } catch {
        setError("Could not send the code. Try again.");
        return;
      }
      setSecs(RESEND_SECS);
      setResent(true);
      // The Resend link is gone now; keep focus in the sheet.
      codeRef.current?.focus({ preventScroll: true });
    });
  };

  const changeEmail = () => {
    setStep("email");
    setCode("");
    setError(null);
  };

  const withGoogle = () =>
    void run("google", async () => {
      try {
        done(await google());
      } catch {
        setError("Google did not work. Try again.");
      }
    });

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
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-1.5 top-1.5 grid h-11 w-11 place-items-center sm:right-3 sm:top-3"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-line text-cream">
            <X size={18} strokeWidth={2.4} aria-hidden />
          </span>
        </button>

        {step === "email" ? (
          <form onSubmit={submitEmail} className="flex flex-col gap-3" noValidate>
            <div className="pr-10">
              <h2 id={titleId} className="font-display text-[22px] font-black leading-[1.15]">{reason.trim() || "Sign in"}</h2>
              <p className="hint mt-1.5">Enter your email. We send you a code.</p>
            </div>
            <div>
              <label className={field} htmlFor={`${titleId}-email`}>Email</label>
              <input
                ref={emailRef}
                id={`${titleId}-email`}
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                placeholder="you@email.com"
              />
            </div>
            {error && <ErrorLine text={error} />}
            <button type="submit" className={btn} disabled={!emailOk || !ready || busy !== null}>
              {busy === "email" ? "Sending…" : "Continue"}
            </button>
            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-line" />
              <span className="font-body text-[13px] text-dim">or</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            <button type="button" onClick={withGoogle} className="btn btn-ghost w-full text-[15px] font-bold normal-case tracking-normal" disabled={!ready || busy !== null}>
              <GoogleMark />
              {busy === "google" ? "Connecting…" : "Continue with Google"}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verify(code);
            }}
            className="flex flex-col gap-3"
            noValidate
          >
            <div className="pr-10">
              <h2 id={titleId} className="font-display text-[22px] font-black leading-[1.15]">Enter your code</h2>
              <p className="hint mt-1.5 break-words">
                We sent a 6-digit code to <span className="text-cream">{cleanEmail}</span>
              </p>
            </div>
            <div>
              <label className={field} htmlFor={`${titleId}-code`}>6 digit code</label>
              <input
                ref={codeRef}
                id={`${titleId}-code`}
                value={code}
                onChange={(e) => onCode(e.target.value)}
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="go"
                placeholder="000000"
                disabled={busy === "code"}
                className="text-center font-mono text-[28px] tracking-[0.5em] placeholder:opacity-40"
                style={{ paddingLeft: "0.5em" }}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              {secs > 0 ? (
                <span className="font-body text-[14px] text-dim" role="timer">Resend in {clock(secs)}</span>
              ) : (
                <button type="button" onClick={resend} disabled={busy !== null} className={link}>Resend</button>
              )}
              <button type="button" onClick={changeEmail} disabled={busy !== null} className={link}>Change email</button>
            </div>
            <div>
              <label className={field} htmlFor={`${titleId}-name`}>Your name (shown on your ticket)</label>
              <input
                id={`${titleId}-name`}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameEdited(true);
                }}
                maxLength={24}
                autoComplete="name"
                autoCapitalize="words"
                enterKeyHint="go"
              />
            </div>
            <p className="sr-only" role="status">{resent ? "We sent a new code" : ""}</p>
            {error && <ErrorLine text={error} />}
            <button type="submit" className={btn} disabled={busy !== null}>
              {busy === "code" ? "Checking…" : "Continue"}
            </button>
          </form>
        )}
        {api?.mode === "fake" && <p className="mt-3 text-center font-mono text-[11px] text-dim">Fake mode: any 6 digits work</p>}
      </div>
    </div>,
    document.body
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p role="alert" className="font-body text-[14px] font-medium text-fireant">
      {text}
    </p>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="h-4 w-4">
      <path fill="#FFC107" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z" />
      <path fill="#FF3D00" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5.1c-1.8 1.2-4 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z" />
      <path fill="#4CAF50" d="M12.6 27.7a12 12 0 0 1 0-7.4V15H5.8a20 20 0 0 0 0 18l6.8-5.3Z" />
      <path fill="#1976D2" d="M24 12.1c3 0 5.6 1 7.7 3.1l5.8-5.8C34 6.1 29.5 4 24 4A20 20 0 0 0 5.8 15l6.8 5.3c1.6-4.8 6.1-8.2 11.4-8.2Z" />
    </svg>
  );
}
