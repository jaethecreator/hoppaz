"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const providerError = params.get("error_description") ?? params.get("error");
    const rawNext = params.get("next") ?? "/me";
    const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/me";

    const finish = async () => {
      if (providerError) throw new Error(providerError);
      if (!code) throw new Error("Google sign-in did not finish. Please try again.");
      const sb = getSupabase();
      if (!sb) throw new Error("Not connected");
      const { error: exchangeError } = await sb.auth.exchangeCodeForSession(code);
      if (exchangeError) throw exchangeError;
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

  return (
    <main className="grid h-full place-items-center px-6 text-center">
      <div className="max-w-sm">
        {error ? (
          <>
            <h1 className="font-display text-2xl font-black">Sign-in didn&apos;t finish</h1>
            <p role="alert" className="hint mt-2">{error}</p>
            <Link href="/account" className="btn mt-5">BACK TO SIGN IN</Link>
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
