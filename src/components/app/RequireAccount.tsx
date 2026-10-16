"use client";

import { useEffect } from "react";
import LoadingStub from "@/components/app/LoadingStub";
import { supabaseConfigured } from "@/lib/supabase/client";
import { useSession } from "@/lib/useSession";
import { goToAccount } from "@/lib/accountGate";

/**
 * Wraps a page that needs an account (Crew, Me, the avatar editor). Anonymous
 * Hoppers are sent to the account page and come back to this screen once they
 * are in; the moment they are, the page itself renders. Without a database
 * (local demo) nothing is gated.
 */
export default function RequireAccount({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  const { hasAccount, state } = useSession();
  const needsAccount = supabaseConfigured() && state !== "offline" && state !== "loading" && !hasAccount;
  useEffect(() => {
    if (needsAccount) goToAccount(title.toLowerCase().replace(/[.!?]$/, ""), "create", caption, { replace: true });
  }, [needsAccount, title, caption]);
  if (!supabaseConfigured() || state === "offline" || hasAccount) return <>{children}</>;
  if (state === "loading") {
    return (
      <div className="h-full px-4 pt-16">
        <LoadingStub label="Loading" lines={2} />
      </div>
    );
  }
  return (
    <div className="h-full px-4 pt-16">
      <LoadingStub label="Opening sign up" lines={2} />
    </div>
  );
}
