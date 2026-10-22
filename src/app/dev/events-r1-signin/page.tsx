"use client";

import { useState } from "react";
import SignInSheet from "@/components/events-r1/SignInSheet";
import { EVENTS_R1_FAKE } from "@/lib/events-r1/flags";
import { useR1Auth } from "@/lib/events-r1/hooks";
import type { AuthUser } from "@/lib/events-r1/types";

/** Release 1 dev page: a button that opens the sign-in sheet, and a line for who is signed in. Fake flag only. */
export default function SignInDevPage() {
  if (!EVENTS_R1_FAKE) {
    return (
      <main className="absolute inset-0 overflow-y-auto bg-ink px-4 py-6 text-cream">
        <p className="hint">The Release 1 fake data is off. Start the app with NEXT_PUBLIC_EVENTS_R1_FAKE=1.</p>
      </main>
    );
  }
  return <Page />;
}

function Page() {
  const { user, signOut } = useR1Auth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("Register for Afro Soirée");
  const [log, setLog] = useState<string[]>([]);

  const signedIn = (u: AuthUser) => setLog((l) => [`onSignedIn: ${u.name} (${u.email})`, ...l]);

  return (
    <main className="absolute inset-0 overflow-y-auto bg-ink px-4 py-6 text-cream">
      <div className="mx-auto flex max-w-[420px] flex-col gap-3">
        <h1 className="font-display text-[22px] font-black">Sign-in sheet</h1>
        <p className="hint" data-testid="who">{user ? `Signed in as ${user.name} (${user.email})` : "Nobody is signed in"}</p>
        <label className="hint" htmlFor="reason">Reason line</label>
        <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button type="button" className="btn" onClick={() => setOpen(true)}>Open the sheet</button>
        <button type="button" className="btn btn-ghost" onClick={() => void signOut()} disabled={!user}>Sign out</button>
        <ul className="hint">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </div>
      <SignInSheet open={open} reason={reason} onClose={() => setOpen(false)} onSignedIn={signedIn} />
    </main>
  );
}
