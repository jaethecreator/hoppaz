import clsx from "clsx";
import type { RoomAnnouncement } from "@/lib/events-r1/types";
import { whenWord } from "./words";

/** "Pop · Afro Soirée" or "Announcement", then who and when. */
export default function AnnouncementTag({ a, now }: { a: RoomAnnouncement; now: number }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-body text-[13px] text-dim">
      <span
        className={clsx(
          "rounded-full border px-2 py-0.5 text-[12px] font-semibold",
          a.event_id ? "border-orange/60 text-orange" : "border-line text-cream"
        )}
      >
        {a.event_id ? `Pop · ${a.event_title}` : "Announcement"}
      </span>
      <span>
        {a.author_name} · {whenWord(a.created_at, now)}
      </span>
    </p>
  );
}
