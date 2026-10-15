"use client";

import { FaceDisc } from "@/components/Avatar";
import type { CrewCard } from "@/lib/crew-room/hub";

/** "N in the room now", with their faces: the hub's strip and the invite page's. The card refreshes every 15 s. */
export default function RoomNow({ card, quiet = "Walk in first and the music starts with you.", none = "Nobody in the room yet" }: { card: CrewCard; quiet?: string; none?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-hz border border-line bg-ink-2 px-3 py-2.5" data-room-now={card.in_room}>
      {card.heads.length > 0 && (
        <span className="flex flex-none">
          {card.heads.slice(0, 5).map((h, i) => (
            <FaceDisc key={h.id} look={h.look} initial={h.name} size={30} className={i ? "-ml-2.5 ring-2 ring-ink-2" : "ring-2 ring-ink-2"} />
          ))}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <b className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
          {card.in_room > 0 && <span aria-hidden className="h-2 w-2 flex-none animate-pulse2 rounded-full bg-keke" />}
          {card.in_room > 0 ? `${card.in_room} in the room now` : none}
        </b>
        <span className="hint block truncate">{card.in_room > 0 ? card.heads.slice(0, 3).map((h) => h.name).join(", ") : quiet}</span>
      </span>
    </div>
  );
}
