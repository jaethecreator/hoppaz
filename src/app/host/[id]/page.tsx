import { notFound } from "next/navigation";
import { Suspense } from "react";
import HostDashboard from "@/components/events-r1/host/HostDashboard";
import { EVENTS_R1 } from "@/lib/events-r1/flags";

/** Release 1 host dashboard. With the flag off there is no such page. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!EVENTS_R1) notFound();
  const { id } = await params;
  return (
    <Suspense fallback={<div className="h-full" />}>
      <HostDashboard id={id} />
    </Suspense>
  );
}
