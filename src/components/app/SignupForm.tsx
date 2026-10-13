"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { createAccount, continueWithGoogle, logIn } from "@/lib/account";

/** Fired on window after a sign-up or log-in, so the home-screen sheet can offer itself. */
export const SIGNED_IN_EVENT = "hoppaz:signed-in";

/**
 * Sign up or log in, in one small form: name, email, password for a new
 * account; email and password to log in. Used by the sign-up sheet, the
 * gated pages and /account. No email to confirm: you're in the moment it saves.
 */
export default function SignupForm({
  onDone,
  startWith = "create",
}: {
  onDone: (how: "create" | "login") => void;
  startWith?: "create" | "login";
}) {
  const [mode, setMode] = useState<"create" | "login">(startWith);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const err = mode === "create" ? await createAccount({ name, email, password }) : await logIn(email, password);
    setBusy(false);
    if (err) return setError(err);
    window.dispatchEvent(new Event(SIGNED_IN_EVENT));
    onDone(mode);
  };

  const flip = () => {
    setMode((m) => (m === "create" ? "login" : "create"));
    setError(null);
  };

  const google = async () => {
    if (busy || googleBusy) return;
    setError(null);
    setGoogleBusy(true);
    let next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (window.location.pathname === "/account") {
      const requested = new URLSearchParams(window.location.search).get("next");
      next = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/me";
    }
    let err: string | null;
    try {
      err = await continueWithGoogle(next, mode === "create");
    } catch {
      err = "Could not start Google sign-in. Please try again.";
    }
    setGoogleBusy(false);
    if (err) setError(err);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <button type="button" onClick={google} className="btn btn-ghost w-full" disabled={busy || googleBusy}>
        <GoogleMark />
        {googleBusy ? "CONNECTING…" : "CONTINUE WITH GOOGLE"}
      </button>
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-[10px] tracking-[0.12em] text-dim">OR EMAIL</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      {mode === "create" && (
        <div>
          <label className="label" htmlFor="su-name">Your name</label>
          <input
            id="su-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            autoComplete="given-name"
            autoCapitalize="words"
            enterKeyHint="next"
            required
          />
        </div>
      )}
      <div>
        <label className="label" htmlFor="su-email">Email</label>
        <input
          id="su-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete={mode === "create" ? "email" : "username"}
          inputMode="email"
          autoCapitalize="none"
          enterKeyHint="next"
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="su-pass">Password</label>
        <div className="relative">
          <input
            id="su-pass"
            type={show ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={mode === "create" ? 8 : undefined}
            autoComplete={mode === "create" ? "new-password" : "current-password"}
            enterKeyHint="go"
            className="pr-12"
            required
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-dim"
          >
            {show ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
          </button>
        </div>
        {mode === "create" && <p className="hint mt-1">8 characters or more.</p>}
      </div>

      {error && (
        <p role="alert" className="font-body text-[14px] font-medium text-fireant">
          {error}
        </p>
      )}

      <button type="submit" className="btn mt-1 w-full" disabled={busy || googleBusy}>
        {busy ? "ONE SEC…" : mode === "create" ? "MAKE MY ACCOUNT" : "LOG IN"}
      </button>
      <button type="button" onClick={flip} className="min-h-[44px] font-body text-[14px] text-dim underline underline-offset-4">
        {mode === "create" ? "Already have an account? Log in" : "New here? Make an account"}
      </button>
      {mode === "create" && (
        <p className="hint text-center">Free. Your XP so far comes with you. Your email is never shown to other Hoppers.</p>
      )}
    </form>
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
