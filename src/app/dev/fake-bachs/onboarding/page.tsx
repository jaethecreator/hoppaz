"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EVENTS_R1_FAKE } from "@/lib/events-r1/flags";
import { useR1Auth } from "@/lib/events-r1/hooks";
import type { HostPayoutStatus } from "@/lib/events-r1/pay";

type Dev = (typeof import("@/lib/events-r1/fake"))["fakeDev"];

const btn = "w-full rounded-lg border border-neutral-300 bg-white px-4 py-3 text-[15px] font-medium text-neutral-900 disabled:opacity-50";
const btnMain = "w-full rounded-lg bg-neutral-900 px-4 py-3 text-[15px] font-medium text-white disabled:opacity-50";

/** Stands in for the hosted host onboarding page (fake data only). Each button sets the signed-in host's payout setup and goes back. */
export default function FakeOnboardingPage() {
  if (!EVENTS_R1_FAKE) {
    return (
      <main className="absolute inset-0 overflow-y-auto bg-neutral-100 px-4 py-6 text-neutral-900">
        <p>The Release 1 fake data is off. Start the app with NEXT_PUBLIC_EVENTS_R1_FAKE=1.</p>
      </main>
    );
  }
  return <Page />;
}

function Page() {
  const router = useRouter();
  const { user } = useR1Auth();
  const [dev, setDev] = useState<Dev | null>(null);
  const [back, setBack] = useState("/");
  const [error, setError] = useState("");

  useEffect(() => {
    void import("@/lib/events-r1/fake").then((m) => setDev(m.fakeDev));
    const r = new URLSearchParams(window.location.search).get("return") ?? "/";
    setBack(r.startsWith("/") && !r.startsWith("//") ? r : "/");
  }, []);

  const set = (status: HostPayoutStatus) => {
    if (!dev || !user) return;
    try {
      dev.setPayoutOf(user.id, status);
      router.push(back);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main className="absolute inset-0 overflow-y-auto bg-neutral-100 px-4 py-8 text-neutral-900">
      <div className="mx-auto max-w-[420px] rounded-2xl bg-white p-5 shadow-sm">
        <p className="text-[12px] text-neutral-500">Test onboarding page. Nothing here is real.</p>
        <h1 className="mt-3 text-[20px] font-semibold">Verify your details</h1>
        <p className="mt-1 text-[14px] text-neutral-600">{user ? `Setting up payouts for ${user.name}.` : "Sign in first."}</p>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" className={btnMain} disabled={!user || !dev} onClick={() => set("ready")}>Finish</button>
          <button type="button" className={btn} disabled={!user || !dev} onClick={() => set("in_progress")}>Leave unfinished</button>
          <button type="button" className={btn} disabled={!user || !dev} onClick={() => set("restricted")}>Restrict</button>
        </div>
        {error && <p className="mt-3 text-[14px] text-red-600">{error}</p>}
      </div>
    </main>
  );
}
