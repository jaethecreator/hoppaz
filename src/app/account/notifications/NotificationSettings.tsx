"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Switch from "@/components/events-r1/host/pops/Switch";
import SignInSheet from "@/components/events-r1/SignInSheet";
import PageHeader from "@/components/app/PageHeader";
import LoadingStub from "@/components/app/LoadingStub";
import { useR1Auth } from "@/lib/events-r1/hooks";
import { loadMyPrefs, saveMyPrefs, type MyPrefs } from "@/lib/notify/myPrefs";

const ROWS: Array<{ key: keyof MyPrefs; title: string; line: string }> = [
  { key: "email_reminders", title: "Reminders", line: "The day before and about an hour before an event you're going to, and a thank-you the morning after." },
  { key: "email_pops", title: "Pops from hosts", line: "An email when a host sends a Pop to the people going. You still see every Pop in the app." },
];

/**
 * Which emails Hoppaz may send a signed-in person. Tickets, receipts and event changes are not on this list: they are about the person's
 * own tickets and always arrive. WhatsApp has no switches yet (they come with the WhatsApp step); a line says so.
 * Works on the fake data too: pick a person at /dev/events-r1 and their choices are kept in this browser.
 */
export default function NotificationSettings() {
  const { ready, user } = useR1Auth();
  const [prefs, setPrefs] = useState<MyPrefs | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const busyRef = useRef(false);
  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    setFailed(false);
    try {
      setPrefs(await loadMyPrefs(userId));
    } catch {
      setFailed(true);
    }
  }, [userId]);

  useEffect(() => {
    setPrefs(null);
    setNote("");
    void load();
  }, [load]);

  const change = async (key: keyof MyPrefs, on: boolean) => {
    if (!userId || !prefs || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNote("");
    const before = prefs;
    setPrefs({ ...prefs, [key]: on });
    try {
      setPrefs(await saveMyPrefs(userId, { [key]: on }));
      setNote(on ? "Turned on." : "Turned off.");
    } catch {
      setPrefs(before);
      setNote("That did not save. Check your connection and try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-4 pb-8">
      <div className="mx-auto w-full max-w-[480px]">
        <PageHeader title="Email settings" caption="Which emails you get" back="/account" />

        {!ready ? (
          <LoadingStub label="Loading" lines={2} />
        ) : !userId ? (
          <div className="card">
            <p className="font-display text-[20px] font-black leading-tight">Sign in to change this</p>
            <p className="hint mt-2">Your email settings belong to your account.</p>
            <button type="button" className="btn mt-4 w-full text-[15px] font-bold normal-case tracking-normal" onClick={() => setSignIn(true)}>
              Sign in
            </button>
          </div>
        ) : failed ? (
          <div className="card">
            <p className="font-body text-[15px] font-semibold">We couldn&apos;t load your settings.</p>
            <button type="button" className="btn btn-ghost mt-3 w-full text-[15px] font-bold normal-case tracking-normal" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : !prefs ? (
          <LoadingStub label="Loading your settings" lines={2} />
        ) : (
          <>
            <p className="hint mb-3">Sent to {user?.email}</p>
            <div className="overflow-hidden rounded-hz border border-line bg-ink-2 [&>*+*]:border-t [&>*+*]:border-line">
              {ROWS.map((r) => (
                <div key={r.key} className="flex items-center gap-3 px-4 py-3.5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-body text-[15px] font-semibold leading-tight">{r.title}</span>
                    <span className="hint mt-0.5 block">{r.line}</span>
                  </span>
                  <Switch on={prefs[r.key]} label={r.title} disabled={busy} onChange={(v) => void change(r.key, v)} />
                </div>
              ))}
            </div>
            <p className="hint mt-3 min-h-[20px]" aria-live="polite">{note}</p>
            <p className="hint mt-3">Your tickets, receipts, and any change or cancellation to an event you&apos;re going to always reach you. They&apos;re about your own tickets.</p>
            <div className="card mt-5">
              <p className="seclabel">WhatsApp</p>
              <p className="hint mt-1.5">WhatsApp reminders are on the way, for paid tickets only. You&apos;ll be asked when you buy a ticket, so there is nothing to set here yet.</p>
            </div>
          </>
        )}
      </div>
      <SignInSheet open={signIn} reason="Change your email settings" onClose={() => setSignIn(false)} onSignedIn={() => setSignIn(false)} />
    </div>
  );
}
