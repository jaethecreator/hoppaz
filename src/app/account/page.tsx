"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/components/app/PageHeader";
import LoadingStub from "@/components/app/LoadingStub";
import SignupForm from "@/components/app/SignupForm";
import { useSession } from "@/lib/useSession";
import { logOut } from "@/lib/account";

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="h-full px-4 pt-16"><LoadingStub label="Loading" lines={2} /></div>}>
      <Account />
    </Suspense>
  );
}

/**
 * Make an account or log in. Three fields to sign up (name, email, password);
 * anything else (gender, then birthday) is asked later, one question at a time.
 * The session is shared app-wide, so signing in or out needs no reload.
 */
function Account() {
  const params = useSearchParams();
  const router = useRouter();
  // Only same-site paths: never bounce to wherever a link says.
  const raw = params.get("next") ?? "/me";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/me";
  const loginMode = params.get("mode") === "login";
  const accountCaption = params.get("detail")
    ?? (params.get("reason") ? `Create an account to ${params.get("reason")}.` : loginMode ? "Log in to your Hoppaz account." : "Create your Hoppaz account to keep your nights.");
  const { email: signedIn, profile, state } = useSession();

  return (
    <div className="h-full overflow-y-auto px-4 pb-8">
      <PageHeader
        backTo={params.get("reason") ? "/" : next}
        title={signedIn ? "Your account" : loginMode ? "Log in" : "Sign up"}
        caption={signedIn ? "Signed in" : accountCaption}
      />

      {state === "loading" ? (
        <LoadingStub label="Loading your account" lines={2} />
      ) : signedIn ? (
        <div className="card">
          <p className="label">Signed in as</p>
          <p className="font-display text-[22px] font-black leading-tight">{profile?.display_name ?? "Hopper"}</p>
          <p className="hint">{signedIn}{profile?.handle ? ` · @${profile.handle}` : ""}</p>
          <button
            className="btn btn-ghost mt-4 w-full"
            onClick={async () => {
              await logOut();
              router.push("/");
            }}
          >
            LOG OUT
          </button>
          <p className="hint mt-2">Log back in any time with Google or your email.</p>
        </div>
      ) : (
        <div className="card">
          <SignupForm startWith={loginMode ? "login" : "create"} onDone={() => router.push(next)} />
        </div>
      )}
    </div>
  );
}
