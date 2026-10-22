"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import CampaignWorld from "@/components/campaign/CampaignWorld";
import RoomArt from "@/components/campaign/roomArt";
import { floodFill } from "@/lib/campaign/geometry";
import { canWalkScene, CLUBHOUSE, type CampaignLayout } from "@/lib/campaign/layout";
import { PLACE_ROOMS, ROOM_TEMPLATES } from "@/lib/campaign/templates";
import type { RoomPeer, SocialWorld } from "@/lib/crew-room/types";
import { anonLook, DEFAULT_LOOK, normalizeLook, randomLook } from "@/lib/avatar";
import { hotspotRoomData } from "@/lib/rooms/hotspotRooms";
import { useSession } from "@/lib/useSession";

/** Sample content for an event room's walls: plainly made up, so nobody mistakes it for a real night. */
const SAMPLE = {
  title: "Sample Night",
  line: "Fri 16 Oct · 8pm",
  flyerUrl: null,
  lineup: [
    { name: "DJ One", time: "9PM" },
    { name: "DJ Two", time: "11PM" },
    { name: "Headliner", time: "1AM" },
  ],
};

type Entry = { key: string; name: string; group: string; layout: CampaignLayout };
const ENTRIES: Entry[] = [
  ...PLACE_ROOMS.filter((r) => r.kind === "event").map((r) => ({ key: r.key, name: r.name, group: "EVENT", layout: r.layout })),
  ...PLACE_ROOMS.filter((r) => r.kind === "hotspot").map((r) => ({ key: r.key, name: hotspotRoomData(r.slug)?.place ?? r.name, group: "HOTSPOT", layout: r.layout })),
  { key: "clubhouse", name: "Clubhouse", group: "CREW", layout: CLUBHOUSE },
  // The other crew templates (Lagos HQ), at both widths.
  ...ROOM_TEMPLATES.filter((t) => t.key !== "clubhouse").flatMap((t) => [
    { key: t.key, name: t.name, group: "TEMPLATE", layout: t.layout(30) },
    { key: `${t.key}-36`, name: `${t.name} wide`, group: "TEMPLATE", layout: t.layout(36) },
  ]),
];

/**
 * Hotspot rooms keep aliases (Jae, 15 Oct): people there show as an alias name with an alias look, like hotspot chat
 * today. Never a real avatar or a real name. The demo people below follow the same rule in a hotspot room.
 */
const ALIASES = ["Suya Rider 4F", "Danfo Dave 2K", "Jollof Jedi 9B", "Keke Queen 7A", "Gala Boss 3C", "Zobo Zee 8D", "Okada Ola 5E", "Puff Puff 1G"];
const HOTSPOT_YOU = "Hotspot You";

/** A small deterministic random, so the same room shows the same demo people every time. */
function seeded(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * Demo people for the dev page only: real avatars (the same drawing the app uses for a Hopper), wandering one tile at a
 * time. Nothing here is a person and nothing leaves the page.
 */
export function useDemoPeers(layout: CampaignLayout, count: number, alias: boolean) {
  const [peers, setPeers] = useState<RoomPeer[]>([]);
  const [observedAt, setObservedAt] = useState(() => new Date().toISOString());
  const state = useRef<{ id: string; name: string; look: unknown; x: number; y: number }[]>([]);

  useEffect(() => {
    const flood = floodFill(layout.spawn, layout.grid.width, layout.grid.height, (x, y) => canWalkScene(layout, { x, y }));
    const open: { x: number; y: number }[] = [];
    for (let y = 0; y < layout.grid.height; y++) for (let x = 0; x < layout.grid.width; x++) if (flood.dist[y * flood.w + x] > 0) open.push({ x, y });
    const rand = seeded(layout.id.length * 977 + count);
    state.current = Array.from({ length: open.length ? count : 0 }, (_, i) => {
      const at = open[Math.floor(rand() * open.length)];
      const name = alias ? ALIASES[i % ALIASES.length] : `Demo ${i + 1}`;
      return { id: `demo-${i + 1}`, name, look: alias ? anonLook(name) : randomLook(rand), x: at.x, y: at.y };
    });
    const publish = () => {
      const now = new Date().toISOString();
      setObservedAt(now);
      setPeers(state.current.map((p) => ({ id: p.id, name: p.name, look: p.look, x: p.x, y: p.y, circle_id: null, last_seen: now })));
    };
    publish();
    const timer = window.setInterval(() => {
      for (const p of state.current) {
        if (rand() < 0.35) continue;
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => rand() - 0.5);
        for (const [dx, dy] of dirs) {
          const next = { x: p.x + dx, y: p.y + dy };
          if (canWalkScene(layout, next) && flood.dist[next.y * flood.w + next.x] > 0) {
            p.x = next.x;
            p.y = next.y;
            break;
          }
        }
      }
      publish();
    }, 1400);
    return () => window.clearInterval(timer);
  }, [layout, count, alias]);

  return { peers, observedAt };
}

function Walk({ entry, count, look }: { entry: Entry; count: number; look: unknown }) {
  const { peers, observedAt } = useDemoPeers(entry.layout, count, entry.group === "HOTSPOT");
  const reset = useMemo(() => ({ x: entry.layout.spawn.x, y: entry.layout.spawn.y, revision: 0 }), [entry.layout]);
  const social: SocialWorld = useMemo(
    () => ({ peers, circles: [], selfId: "me", circleId: null, areaId: null, watching: false, observedAt, reset, onStep: () => true }),
    [peers, observedAt, reset]
  );
  const isPlace = entry.group !== "CREW" && entry.group !== "TEMPLATE";
  return (
    <CampaignWorld
      key={entry.key}
      layout={entry.layout}
      look={look}
      brand={isPlace || entry.group === "TEMPLATE" ? entry.name : "360Playlist"}
      social={social}
      placeId={isPlace ? entry.key : undefined}
      roomContent={entry.group === "EVENT" ? SAMPLE : undefined}
    />
  );
}

function Still({ entry }: { entry: Entry }) {
  const isPlace = entry.group !== "CREW" && entry.group !== "TEMPLATE";
  return (
    <div className="grid h-full place-items-center overflow-auto bg-[#15171a] p-2">
      <div className="w-full max-w-[960px] [&>svg]:h-auto [&>svg]:w-full">
        <RoomArt layout={entry.layout} uid="still" brand={isPlace || entry.group === "TEMPLATE" ? entry.name : "360Playlist"} content={entry.group === "EVENT" ? SAMPLE : undefined} />
      </div>
    </div>
  );
}

/**
 * DEV · ROOM TEMPLATES. `?room=<key>` picks the room, `?mode=still|walk`, `?peers=<n>` the demo people (default 6),
 * `?chrome=0` hides the picker (clean phone screenshots).
 */
export default function DevRoomTemplates() {
  const { profile } = useSession();
  const [key, setKey] = useState(ENTRIES[0].key);
  const [mode, setMode] = useState<"still" | "walk">("walk");
  const [count, setCount] = useState(6);
  const [chrome, setChrome] = useState(true);
  // The world reads the window (device tier, camera): draw it on the client only.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const q = new URLSearchParams(window.location.search);
    const room = q.get("room");
    if (room && ENTRIES.some((e) => e.key === room)) setKey(room);
    if (q.get("mode") === "still") setMode("still");
    const n = Number(q.get("peers"));
    if (Number.isFinite(n) && q.get("peers") !== null) setCount(Math.max(0, Math.min(40, Math.round(n))));
    if (q.get("chrome") === "0") setChrome(false);
  }, []);

  const entry = ENTRIES.find((e) => e.key === key) ?? ENTRIES[0];
  const avatar = profile?.avatar;
  const realLook = useMemo(() => (avatar ? normalizeLook(avatar) : DEFAULT_LOOK), [avatar]);
  const aliasLook = useMemo(() => anonLook(HOTSPOT_YOU), []);
  const look = entry.group === "HOTSPOT" ? aliasLook : realLook;

  return (
    <div className="absolute inset-0 flex flex-col bg-[#101214] text-[#F5EBDD]">
      {chrome && (
        <div className="flex-none border-b border-white/10 px-2 pb-2 pt-[max(8px,env(safe-area-inset-top))]">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] tracking-[0.08em] text-[#FF4D00]">DEV · ROOMS</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-white/60">
              {entry.key} · {entry.layout.props.length} props · {entry.layout.zones.length} zones
            </span>
            <button type="button" onClick={() => setMode(mode === "walk" ? "still" : "walk")} className="rounded border border-white/20 px-2 py-1 font-mono text-[10px]" aria-label="Switch between the still and the walkable room">
              {mode === "walk" ? "STILL" : "WALK"}
            </button>
          </div>
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="Rooms">
            {ENTRIES.map((e) => (
              <button
                key={e.key}
                type="button"
                role="tab"
                aria-selected={e.key === key}
                data-room={e.key}
                onClick={() => setKey(e.key)}
                className={`flex-none rounded border px-2 py-1 font-mono text-[10px] ${e.key === key ? "border-[#FF4D00] bg-[#FF4D00] text-[#0E0B0A]" : "border-white/20 text-white/80"}`}
              >
                {e.group === "EVENT" ? "" : e.group === "HOTSPOT" ? "@ " : e.group === "TEMPLATE" ? "# " : "· "}
                {e.name.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden" style={{ isolation: "isolate" }}>
        {!mounted ? null : mode === "walk" ? <Walk key={entry.key} entry={entry} count={count} look={look} /> : <Still entry={entry} />}
      </div>
    </div>
  );
}
