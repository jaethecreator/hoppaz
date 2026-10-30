import { notFound } from "next/navigation";
import { Suspense } from "react";
import RoomAdmin from "@/components/events-r1/workspace/RoomAdmin";
import { EVENTS_R1 } from "@/lib/events-r1/flags";

/** Release 1 room admin at /rooms/<slug>/admin (and /r/<slug>/admin, which comes here). Owners and admins only; the page sends anyone else to the room. */
export default function Page() {
  if (!EVENTS_R1) notFound();
  return (
    <Suspense fallback={<div className="h-full" />}>
      <RoomAdmin />
    </Suspense>
  );
}
