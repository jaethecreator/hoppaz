import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import ClaimPage from "@/components/events-r1/claim/ClaimPage";
import { EVENTS_R1 } from "@/lib/events-r1/flags";

/** The link carries a secret: no search engine indexes it and no outgoing link tells another site where it came from. */
export const metadata: Metadata = {
  title: "Take over your room | Hoppaz",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** The page an organiser opens from the link we send. /claim/<token>. With the flag off there is no such page. */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  if (!EVENTS_R1) notFound();
  const { token } = await params;
  return (
    <Suspense fallback={<div className="h-full" />}>
      <ClaimPage token={token} />
    </Suspense>
  );
}
