import type { R1Event } from "@/lib/events-r1/types";
import AboutBlock from "./AboutBlock";
import HostPops from "./HostPops";

/** Under the button on the event page: the host's updates, then About this event. */
export default function PageSections({ event }: { event: R1Event }) {
  return (
    <>
      <HostPops event={event} />
      <AboutBlock event={event} />
    </>
  );
}
