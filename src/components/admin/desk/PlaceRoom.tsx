"use client";

import { ExternalLink, Plus } from "lucide-react";
import type { HotspotRoomRow } from "@/app/api/admin/game/hotspots";
import { hotspotRoom } from "@/lib/campaign/templates";
import { RoomAvatar } from "./RoomOverview";
import RoomPicker from "./RoomPicker";
import { lagos } from "./format";
import type { LiveEvent, SectionKey } from "./types";

const NONE = new Set<string>();

const STATUS_PILL: Record<HotspotRoomRow["status"], string> = { open: "pill-keke", planned: "", paused: "pill-danfo" };

/**
 * An event room or a hotspot room on the staff desk. Only crew rooms can hold a drop today, so both show who and where, the
 * room's picture for a hotspot, and say plainly what is missing (Ola's database update) instead of hiding the button.
 */
export default function PlaceRoom({ kind, event, hotspot, onSection }: { kind: "event" | "hotspot"; event?: LiveEvent; hotspot?: HotspotRoomRow; onSection: (s: SectionKey) => void }) {
  const layout = kind === "hotspot" ? hotspotRoom(hotspot?.slug)?.layout : undefined;
  const name = kind === "event" ? event?.title : hotspot?.place;
  if (!name) return <p className="px-4 py-5 text-[14px] text-dim lg:px-7">That room is gone.</p>;

  const sub =
    kind === "event" && event
      ? ["Event room", event.venue_name, event.area ?? "", event.starts_at ? lagos(event.starts_at) : ""].filter(Boolean).join(" · ")
      : hotspot
        ? `Hotspot room · ${hotspot.zone} · wave ${hotspot.wave}`
        : "";

  return (
    <div className="px-4 py-5 lg:px-7 lg:py-7" data-desk-place-room={kind}>
      <header className="flex flex-wrap items-start gap-x-5 gap-y-4">
        <div className="flex min-w-0 flex-1 basis-[18rem] items-start gap-4">
          <RoomAvatar name={name} size={56} />
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-black leading-tight [overflow-wrap:anywhere]">{name}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[15px] leading-snug text-dim">
              {sub}
              {hotspot && kind === "hotspot" && <span className={`pill ${STATUS_PILL[hotspot.status]}`}>{hotspot.status.toUpperCase()}</span>}
            </p>
            {hotspot && kind === "hotspot" && (
              <p className="hint mt-1">
                <b className="font-bold text-cream">{hotspot.here}</b> here now
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="mt-6 grid max-w-[900px] gap-6">
        {layout && hotspot && (
          <div className="max-w-[560px]">
            <RoomPicker layout={layout} brand={hotspot.place} spots={[]} picked={NONE} />
          </div>
        )}

        <div className="card p-4 lg:p-5">
          <p className="text-[15px] leading-snug">
            {kind === "event" ? "Drops in event rooms need Ola's database update. For now, run drops in a crew room like 360Playlist." : "Drops in hotspot rooms need Ola's database update. For now, run drops in a crew room like 360Playlist."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn" disabled>
              <Plus size={16} aria-hidden /> ADD A DROP
            </button>
            {kind === "event" && event && (
              <a href={`/event/${event.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
                <ExternalLink size={16} aria-hidden /> OPEN THE EVENT
              </a>
            )}
            {kind === "hotspot" && hotspot && (
              <>
                <a href={`/room/${hotspot.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
                  <ExternalLink size={16} aria-hidden /> OPEN ROOM
                </a>
                <button type="button" className="btn btn-ghost" onClick={() => onSection("hotspots")}>
                  MANAGE IN HOTSPOTS
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
