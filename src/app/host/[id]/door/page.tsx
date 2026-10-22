import { notFound } from "next/navigation";
import { Suspense } from "react";
import DoorScan from "@/components/events-r1/door/DoorScan";
import { EVENTS_R1 } from "@/lib/events-r1/flags";

/** Release 1 door scan. With the flag off there is no such page. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!EVENTS_R1) notFound();
  const { id } = await params;
  return (
    <Suspense fallback={<div className="h-full" />}>
      <DoorScan id={id} />
    </Suspense>
  );
}
