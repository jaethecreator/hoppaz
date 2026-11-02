"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";
import { googleCallback, IDENTITY_TAKEN } from "@/lib/account";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState("/me");

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const providerError = params.get("error_description") ?? params.get("error")
      ?? hashParams.get("error_description") ?? hashParams.get("error");
    const rawNext = params.get("next") ?? "/me";
    const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/me";
    setReturnTo(next);

    const finish = async () => {
      const sb = getSupabase();
      // Sign-up tried to link this Google account to the guest, but it already has a Hoppaz account: they have been here
      // before, so sign them in to it. Once only (`again`), so a refusal can never loop.
      const taken = IDENTITY_TAKEN.test(`${providerError ?? ""} ${params.get("error_code") ?? hashParams.get("error_code") ?? ""}`);
      if (sb && taken && !params.has("again")) {
        const redirectTo = new URL(googleCallback(next));
        redirectTo.searchParams.set("again", "1");
        const { error: again } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo.toString() } });
        if (!again) return; // on its way to Google
      }
      if (providerError) throw new Error(providerError);
      if (!sb) throw new Error("Not connected");
      // createBrowserClient has detectSessionInUrl enabled. It handles the PKCE
      // code or implicit tokens during initialization, so manually exchanging
      // the same code here can fail with an already-used code error.
      const { data: { session }, error: sessionError } = await sb.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Google sign-in did not finish. Please try again.");
      if (cancelled) return;
      // In first, tidy after: the Google name fills an empty display name behind the redirect, not in front of it.
      const user = session.user;
      const googleName = user.user_metadata?.full_name ?? user.user_metadata?.name;
      if (typeof googleName === "string" && googleName.trim()) {
        void (async () => {
          const { data: profile } = await sb.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
          if (!profile?.display_name) await sb.from("profiles").update({ display_name: googleName.trim().slice(0, 24) }).eq("id", user.id);
        })();
      }
      window.dispatchEvent(new Event("hoppaz:signed-in"));
      router.replace(next);
    };

    void finish().catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not finish Google sign-in.");
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const identityConflict = !!error && IDENTITY_TAKEN.test(error);

  return (
    <main className="grid h-full place-items-center px-6 text-center">
      <div className="max-w-sm">
        {error ? (
          <>
            <h1 className="font-display text-2xl font-black">Sign-in didn&apos;t finish</h1>
            {identityConflict ? (
              <>
                <p role="alert" className="hint mt-2">This Google account is already linked to a different Hoppaz account.</p>
                <p className="hint mt-2">Log in with that Google account to use it. Guest activity from this session won&apos;t merge automatically.</p>
                <Link href={`/account?mode=login&next=${encodeURIComponent(returnTo)}`} className="btn mt-5">LOG IN WITH GOOGLE</Link>
              </>
            ) : (
              <>
                <p role="alert" className="hint mt-2">{error}</p>
                <Link href={`/account?next=${encodeURIComponent(returnTo)}`} className="btn mt-5">BACK TO SIGN IN</Link>
              </>
            )}
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-black">Finishing sign-in…</h1>
            <p className="hint mt-2">Taking you back to Hoppaz.</p>
          </>
        )}
      </div>
    </main>
  );
}
