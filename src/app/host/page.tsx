import { notFound } from "next/navigation";
import { Suspense } from "react";
import PersonalHome from "@/components/events-r1/workspace/PersonalHome";
import { EVENTS_R1 } from "@/lib/events-r1/flags";

/** Release 1 host workspace, Personal: your events and the rooms you are in. With the flag off there is no such page. */
export default function Page() {
  if (!EVENTS_R1) notFound();
  return (
    <Suspense fallback={<div className="h-full" />}>
      <PersonalHome />
    </Suspense>
  );
}
