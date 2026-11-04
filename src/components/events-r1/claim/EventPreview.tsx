import { initials } from "@/components/events-r1/workspace/admin/ui";
import { whenLagos } from "./words";

/**
 * A small picture of the event page as it is today, for the claim page. Not a link, not a button: aria-hidden, nothing in it
 * takes focus. It is drawn from the preview's own fields only (event title, date, room name), so it can say nothing more.
 */
export default function EventPreview({ title, startsAt, roomName, kind }: { title: string; startsAt: string; roomName: string; kind: "claim" | "handover" }) {
  return (
    <div className="mt-3 select-none" aria-hidden data-claim-preview>
      <div className="pointer-events-none rounded-hz border border-line bg-ink-3/40 p-3">
        <div className="flex items-start gap-3">
          <span className="grid h-14 w-14 flex-none place-items-center rounded-hz bg-ink-3 font-display text-[18px] font-black text-dim">{initials(title)}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[15px] font-black leading-tight">{title}</p>
            <p className="mt-0.5 truncate font-body text-[12.5px] text-dim">{whenLagos(startsAt)}</p>
            <p className="mt-1 font-body text-[12.5px] font-semibold text-dim">{kind === "claim" ? "Listed by Hoppaz" : `Hosted by ${roomName}`}</p>
          </div>
        </div>
        <div className="mt-3 flex min-h-[40px] items-center justify-center rounded-hz bg-ink-3 font-body text-[14px] font-bold text-dim">{kind === "claim" ? "Get tickets" : "Register"}</div>
      </div>
    </div>
  );
}
