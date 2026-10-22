import { notFound } from "next/navigation";
import CreatePage from "@/components/events-r1/create/CreatePage";
import { EVENTS_R1 } from "@/lib/events-r1/flags";

/** Release 1 one page create (events and rooms). With the flag off there is no such page: /drop is the old way. */
export default function Page() {
  if (!EVENTS_R1) notFound();
  return <CreatePage />;
}
