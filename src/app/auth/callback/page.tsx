"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";

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
      if (providerError) throw new Error(providerError);
      const sb = getSupabase();
      if (!sb) throw new Error("Not connected");
      // createBrowserClient has detectSessionInUrl enabled. It handles the PKCE
      // code or implicit tokens during initialization, so manually exchanging
      // the same code here can fail with an already-used code error.
      const { data: { session }, error: sessionError } = await sb.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Google sign-in did not finish. Please try again.");
      if (cancelled) return;
      const { data: userData } = await sb.auth.getUser();
      const googleName = userData.user?.user_metadata?.full_name ?? userData.user?.user_metadata?.name;
      if (userData.user && typeof googleName === "string" && googleName.trim()) {
        const { data: profile } = await sb.from("profiles").select("display_name").eq("id", userData.user.id).maybeSingle();
        if (!profile?.display_name) {
          await sb.from("profiles").update({ display_name: googleName.trim().slice(0, 24) }).eq("id", userData.user.id);
        }
      }
      if (cancelled) return;
      window.dispatchEvent(new Event("hoppaz:signed-in"));
      router.replace(next);
      router.refresh();
    };

    void finish().catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not finish Google sign-in.");
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const identityConflict = !!error && /identity_already_exists|identity already exists|already linked to another user/i.test(error);

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
