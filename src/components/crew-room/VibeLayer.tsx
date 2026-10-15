"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import type { CampaignLayout } from "@/lib/campaign/layout";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import { useSessionStore } from "@/lib/useSession";
import { haptics } from "@/lib/haptics";
import { sfx } from "@/lib/sound/sfx";
import {
  HEAD_PX,
  NEAR_TILES,
  VIBES,
  VIBE_MS,
  findClip,
  sayHi,
  sayResult,
  subscribeVibes,
  useVibes,
  useWorldScale,
  type ActiveVibe,
  type VibeId,
} from "@/lib/crew-room/vibes";
import css from "./VibeLayer.module.css";

/**
 * A vibe a Hopper sent shows over their avatar for 3 seconds (design section 8.2): a drawn sticker with its lettering,
 * a "TO YOU" plate when it is for me, and a ring at their feet. Up to 3 on screen and 2 over one head, oldest dropped.
 *
 * WORLD LAYER, owned by SOCIAL. Mounted by CampaignWorld inside the scaled world, so everything is positioned in world
 * pixels and counter-scaled (`--hz-inv`, measured here) to stay one size at every zoom. This layer also owns the Realtime
 * feed of vibes and wave taps for the crew (src/lib/crew-room/vibes.ts):
 *   - a vibe for me: the sticker over the sender, a sound and a tap (Android); if the sender is off my screen, the hint
 *     chip "ADA VIBED YOU" (HopperMenu draws the chip);
 *   - a vibe for someone else within 8 tiles of me: the sticker only;
 *   - a wave for me: the hint chip "ADA WAVED AT YOU" with WAVE BACK.
 * Reads useRoomStore me, peers, tile; useSessionStore userId. Hidden from screen readers (the picture and sound carry it).
 */
export type VibeLayerProps = { crewId: string; layout: CampaignLayout };

type Palette = { bg: string; ink: string };
const ART: Record<VibeId, Palette> = {
  outside: { bg: "#FFC400", ink: "#0E0B0A" },
  big: { bg: "#FF4D00", ink: "#0E0B0A" },
  omo: { bg: "#22B8F0", ink: "#0E0B0A" },
  fresh: { bg: "#5B2EFF", ink: "#F5EBDD" },
  wahala: { bg: "#2FD35C", ink: "#0E0B0A" },
};
const CREAM = "#F5EBDD";
const INK = "#0E0B0A";

/** The five stickers, drawn. 44 x 44; no emoji. Used by the menu's chips and by the world sticker. */
export function VibeArt({ id, size = 44 }: { id: VibeId; size?: number }) {
  const { bg } = ART[id];
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden focusable="false" className={css.art}>
      <rect x="1" y="1" width="42" height="42" rx="10" fill={bg} stroke={INK} strokeWidth="1.5" />
      {id === "outside" && (
        <g>
          <rect x="16" y="5.5" width="12" height="5" rx="1.5" fill={INK} />
          <rect x="8" y="10" width="28" height="24" rx="5" fill={INK} />
          <rect x="11" y="13" width="22" height="10" rx="2" fill={CREAM} />
          <path d="M22 13v10" stroke={INK} strokeWidth="1.5" />
          <circle cx="14.5" cy="28.5" r="2.6" fill={bg} />
          <circle cx="29.5" cy="28.5" r="2.6" fill={bg} />
          <rect x="19" y="27" width="6" height="3.2" rx="1" fill={CREAM} />
          <rect x="10" y="33" width="6" height="4.5" rx="1.2" fill={INK} />
          <rect x="28" y="33" width="6" height="4.5" rx="1.2" fill={INK} />
        </g>
      )}
      {id === "big" && (
        <g>
          <rect x="12" y="7" width="20" height="30" rx="4" fill={INK} />
          <circle cx="22" cy="15" r="3.2" fill={CREAM} />
          <circle cx="22" cy="27" r="8" fill={CREAM} />
          <circle cx="22" cy="27" r="3.6" fill={INK} />
          <path d="M36 17q3 5 0 10M39 14q5.5 8 0 16" fill="none" stroke={CREAM} strokeWidth="2" strokeLinecap="round" />
          <path d="M8 17q-3 5 0 10M5 14q-5.5 8 0 16" fill="none" stroke={CREAM} strokeWidth="2" strokeLinecap="round" />
        </g>
      )}
      {id === "omo" && (
        <g>
          <ellipse cx="14.5" cy="24" rx="8" ry="10.5" fill={CREAM} stroke={INK} strokeWidth="1.5" />
          <ellipse cx="29.5" cy="24" rx="8" ry="10.5" fill={CREAM} stroke={INK} strokeWidth="1.5" />
          <circle cx="15.5" cy="25.5" r="4" fill={INK} />
          <circle cx="28.5" cy="25.5" r="4" fill={INK} />
          <circle cx="16.8" cy="24" r="1.2" fill={CREAM} />
          <circle cx="29.8" cy="24" r="1.2" fill={CREAM} />
          <path d="M6 10l12-3M26 7l12 3" stroke={INK} strokeWidth="3" strokeLinecap="round" />
        </g>
      )}
      {id === "fresh" && (
        <g>
          <path d="M21 5l4.6 12.4L38 22l-12.4 4.6L21 39l-4.6-12.4L4 22l12.4-4.6z" fill={CREAM} />
          <path d="M35 5l1.6 3.9 3.9 1.6-3.9 1.6L35 16l-1.6-3.9-3.9-1.6 3.9-1.6z" fill="#FFC400" />
          <path d="M34 30l1.2 2.8 2.8 1.2-2.8 1.2L34 38l-1.2-2.8L30 34l2.8-1.2z" fill="#FFC400" />
        </g>
      )}
      {id === "wahala" && (
        <g stroke={INK} strokeWidth="1.5" strokeLinejoin="round" fill={CREAM}>
          <rect x="12" y="20" width="21" height="17" rx="7" />
          <rect x="12.5" y="9" width="4.4" height="19" rx="2.2" />
          <rect x="17.8" y="6" width="4.4" height="22" rx="2.2" />
          <rect x="23.1" y="6.5" width="4.4" height="21.5" rx="2.2" />
          <rect x="28.4" y="10" width="4.4" height="18" rx="2.2" />
          <path d="M13 29l-6.5-6a2.3 2.3 0 0 1 3.3-3.2l6.2 5.5z" />
        </g>
      )}
    </svg>
  );
}

/** A sticker as it hangs over a head: the art on a cream keyline card with its lettering. */
function Sticker({ id, toYou }: { id: VibeId; toYou: boolean }) {
  const def = VIBES.find((v) => v.id === id)!;
  return (
    <div className={css.sticker} data-vibe={id}>
      {toYou && <span className={css.toYou}>TO YOU</span>}
      <div className={css.card}>
        <VibeArt id={id} size={34} />
        <b className={css.lettering}>
          {def.lines.map((line, i) => (
            <span key={i}>{line}</span>
          ))}
        </b>
      </div>
    </div>
  );
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export default function VibeLayer({ crewId, layout }: VibeLayerProps) {
  const root = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const tile = useRoomStore((s) => s.tile) || layout.grid.tile;
  const me = useRoomStore((s) => s.me);
  const peers = useRoomStore((s) => s.peers);
  const userId = useSessionStore((s) => s.userId);
  const active = useVibes((s) => s.active);
  const scene = { width: layout.grid.width * layout.grid.tile, height: layout.grid.height * layout.grid.tile };

  // One size at every zoom, only while there is something to draw.
  useWorldScale(root, active.length > 0);

  // Each sticker leaves after 3 s.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    for (const v of active) {
      if (timers.current.has(v.id)) continue;
      timers.current.set(
        v.id,
        setTimeout(() => {
          timers.current.delete(v.id);
          useVibes.getState().removeVibe(v.id);
        }, VIBE_MS)
      );
    }
    for (const [id, t] of timers.current) {
      if (!active.some((v) => v.id === id)) {
        clearTimeout(t);
        timers.current.delete(id);
      }
    }
  }, [active]);
  useEffect(() => {
    const held = timers.current;
    return () => {
      held.forEach((t) => clearTimeout(t));
      held.clear();
      useVibes.getState().reset();
    };
  }, []);

  // The live feed: vibes and wave taps for this crew.
  const open = useRef((dm: string) => router.push(`/chat/dm/${dm}`));
  open.current = (dm: string) => router.push(`/chat/dm/${dm}`);
  useEffect(() => {
    if (!userId) return;
    return subscribeVibes(crewId, (v) => {
      if (v.from === userId) return; // my own: shown the moment I sent it
      const room = useRoomStore.getState();
      const sender = room.peers.find((p) => p.id === v.from);
      const name = (sender?.name ?? "A Hopper").toUpperCase();
      if (v.sticker === "wave") {
        if (v.to !== userId) return;
        sfx.wave();
        haptics.buzz("wave");
        // I waved at them first this visit, so this is their wave coming back: it is mutual now, and the same SAY HI says so
        // (CONNECTED, with OPEN DM) instead of offering to wave back at someone I already waved at.
        if (useVibes.getState().waved[v.from]) {
          void sayHi(crewId, { id: v.from, name: sender?.name ?? "A Hopper", key: sender?.key }).then((r) => sayResult(r, open.current));
          return;
        }
        useVibes.getState().say(`${name} WAVED AT YOU`, 6000, {
          label: "WAVE BACK",
          onPress: () => {
            useVibes.getState().clearHint();
            void sayHi(crewId, { id: v.from, name: sender?.name ?? "A Hopper", key: sender?.key }).then((r) => sayResult(r, open.current));
          },
        });
        return;
      }
      const forMe = v.to === userId;
      const near = !!sender && !!room.me && dist(sender, room.me) <= NEAR_TILES;
      if (!forMe && !near) return;
      if (sender) {
        const item: ActiveVibe = { id: v.id, sticker: v.sticker, from: v.from, to: v.to, at: v.at, mine: false };
        useVibes.getState().addVibe(item);
      }
      if (forMe) {
        sfx.vibe();
        haptics.buzz("wave");
        // Off my screen: say so with a chip, since the sticker would be somewhere I cannot see.
        const layer = root.current;
        let visible = false;
        if (layer && sender) {
          const rect = layer.getBoundingClientRect();
          const s = rect.width / (layer.offsetWidth || 1) || 1;
          const clip = (findClip(layer) ?? document.documentElement).getBoundingClientRect();
          const px = rect.left + (sender.x + 0.5) * room.tile * s;
          const py = rect.top + ((sender.y + 0.5) * room.tile - HEAD_PX) * s;
          visible = px > clip.left && px < clip.right && py > clip.top && py < clip.bottom;
        }
        if (!visible) useVibes.getState().say(`${name} VIBED YOU`, 2500);
      }
    });
  }, [crewId, userId]);

  // Group by the head they hang over.
  const groups = useMemo(() => {
    const by = new Map<string, { id: string; x: number; y: number; items: ActiveVibe[] }>();
    for (const v of active) {
      const at = v.mine || v.from === userId ? me : peers.find((p) => p.id === v.from);
      if (!at) continue;
      const g = by.get(v.from) ?? { id: v.from, x: at.x, y: at.y, items: [] };
      g.items.push(v);
      by.set(v.from, g);
    }
    return [...by.values()];
  }, [active, peers, me, userId]);

  return (
    <div ref={root} className={css.layer} style={{ width: scene.width, height: scene.height }} aria-hidden>
      {groups.map((g) => (
        <div key={g.id} className={css.head} style={{ transform: `translate3d(${(g.x + 0.5) * tile}px, ${(g.y + 0.5) * tile - HEAD_PX}px, 0)` }}>
          <div className={css.stack}>
            {g.items.map((v) => (
              <Sticker key={v.id} id={v.sticker} toYou={!v.mine && v.to === userId} />
            ))}
          </div>
          {g.items.some((v) => !v.mine && v.to === userId) && <span className={css.ring} style={{ top: HEAD_PX - 8 }} />}
        </div>
      ))}
    </div>
  );
}
