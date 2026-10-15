"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock } from "lucide-react";
import type { CampaignLayout } from "@/lib/campaign/layout";
import { useRoomStore, type RoomPopup } from "@/lib/crew-room/roomStore";
import { HEAD_PX, useWorldScale } from "@/lib/crew-room/vibes";
import css from "./PopUps.module.css";

/**
 * The small in-world cards: zone cards and one-second hints at a tap point (design sections 5.5 and 5.6).
 *
 * WORLD LAYER, owned by SOCIAL. Mounted by CampaignWorld inside the scaled world, so the layer is in world pixels; each
 * card is counter-scaled to stay one size on screen at every zoom and is clamped inside the visible world (the nearest
 * overflow-hidden ancestor) with an 8 px margin, flipping below the avatar when there is no room above.
 *
 *   Zone card   Standing in a zone or area for 500 ms (useRoomStore zone) pops one card over my head: the name, one
 *               line, and for a conversation area the lock line with how many are inside. It fades after 3 s, or
 *               on a tap, or when I walk out, and the same zone does not pop again within 60 s. Not while the chat
 *               sheet is full.
 *   Store cards Every useRoomStore popup (pushPopup) is drawn too: title, optional body, anchored on its `tile` or on
 *               me. The layer dismisses each one when its ttl is up (dismissPopup), or on a tap.
 *   Never more than 2 cards at once: the newest two.
 *
 * Reads useRoomStore zone, sheet, popups, me, peers, tile; writes dismissPopup. Copy is the design's section 19.
 */
export type PopUpsProps = { crewId: string; layout: CampaignLayout };

const ZONE_LINE: Record<string, string> = {
  studio: "Headphones on. First listen, before anybody.",
  stage: "Mic is open. Say it loud.",
  awards: "Trophies on the wall. Go look.",
  courtyard: "Fountain, benches, good company.",
  records: "Sit down. Pick your next favourite.",
  campaign: "Meet the sound behind the sound.",
};
const SHOW_AFTER_MS = 500;
const ZONE_MS = 3000;
const AGAIN_MS = 60_000;
const MARGIN = 8;
const GAP = 12;

type Card = { id: string; title: string; body?: string; tile?: { x: number; y: number }; ttlMs: number; lock?: boolean; zone?: boolean };

export default function PopUps({ layout }: PopUpsProps) {
  const root = useRef<HTMLDivElement>(null);
  const zone = useRoomStore((s) => s.zone);
  const popups = useRoomStore((s) => s.popups);
  const dismissPopup = useRoomStore((s) => s.dismissPopup);
  const tile = useRoomStore((s) => s.tile) || layout.grid.tile;
  const [zoneCard, setZoneCard] = useState<Card | null>(null);
  const shownAt = useRef(new Map<string, number>());
  const scene = { width: layout.grid.width * layout.grid.tile, height: layout.grid.height * layout.grid.tile };

  // ------------------------------------------------------------- zone cards --
  useEffect(() => {
    setZoneCard(null);
    if (!zone) return;
    const area = layout.privateAreas.find((a) => a.id === zone);
    const room = layout.zones.find((z) => z.id === zone);
    if (!area && !room) return;
    const timer = setTimeout(() => {
      const state = useRoomStore.getState();
      if (state.zone !== zone || state.sheet === "full") return;
      const last = shownAt.current.get(zone);
      if (last != null && Date.now() - last < AGAIN_MS) return;
      shownAt.current.set(zone, Date.now());
      if (area) {
        const inside = (p: { x: number; y: number }) => p.x >= area.x && p.x < area.x + area.w && p.y >= area.y && p.y < area.y + area.h;
        const count = state.peers.filter(inside).length + (state.me && inside(state.me) ? 1 : 0);
        setZoneCard({
          id: `zone:${zone}`,
          title: area.name,
          body: count > 1 ? `Chat here stays here. ${count} inside.` : "You're first. Chat here stays here.",
          ttlMs: ZONE_MS,
          lock: true,
          zone: true,
        });
      } else if (room) {
        setZoneCard({ id: `zone:${zone}`, title: room.name, body: ZONE_LINE[room.id] ?? room.subtitle, ttlMs: ZONE_MS, zone: true });
      }
    }, SHOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [zone, layout]);

  useEffect(() => {
    if (!zoneCard) return;
    const gone = setTimeout(() => setZoneCard((c) => (c?.id === zoneCard.id ? null : c)), zoneCard.ttlMs);
    return () => clearTimeout(gone);
  }, [zoneCard]);

  // ------------------------------------------------------ the store's cards --
  useEffect(() => {
    const timers = popups.map((p) => setTimeout(() => dismissPopup(p.id), Math.max(200, p.ttlMs)));
    return () => timers.forEach(clearTimeout);
  }, [popups, dismissPopup]);

  const cards: Card[] = useMemo(() => {
    const fromStore: Card[] = popups.map((p: RoomPopup) => ({ id: p.id, title: p.title, body: p.body, tile: p.tile, ttlMs: p.ttlMs }));
    return [...(zoneCard ? [zoneCard] : []), ...fromStore].slice(-2);
  }, [popups, zoneCard]);

  const close = useCallback(
    (card: Card) => {
      if (card.zone) setZoneCard((c) => (c?.id === card.id ? null : c));
      else dismissPopup(card.id);
    },
    [dismissPopup]
  );

  // ----------------------------------------------------------- positioning --
  const els = useRef(new Map<string, HTMLDivElement>());
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const eased = useRef(new Map<string, { x: number; y: number }>());
  const meRef = useRef(useRoomStore.getState().me);
  useEffect(() => useRoomStore.subscribe((s) => void (meRef.current = s.me)), []);

  // Each frame: ease the card onto its anchor, counter-scale it, clamp it into the visible world, point the tail.
  const frame = useRef<(s: number, layer: DOMRect, clip: DOMRect, dt: number) => void>(() => {});
  frame.current = (s, layer, clip, dt) => {
    const stacked = new Map<string, number>();
    for (const card of cardsRef.current) {
      const el = els.current.get(card.id);
      if (!el) continue;
      const at = card.tile ?? meRef.current;
      if (!at) {
        el.style.visibility = "hidden";
        continue;
      }
      const tx = (at.x + 0.5) * tile;
      const ty = (at.y + 0.5) * tile - HEAD_PX;
      let pos = eased.current.get(card.id);
      if (!pos) {
        pos = { x: tx, y: ty };
        eased.current.set(card.id, pos);
      }
      const k = 1 - Math.exp(-dt / 0.05);
      pos.x += (tx - pos.x) * k;
      pos.y += (ty - pos.y) * k;
      const ax = layer.left + pos.x * s;
      const ay = layer.top + pos.y * s;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const key = `${at.x},${at.y}`;
      const lift = stacked.get(key) ?? 0;
      stacked.set(key, lift + h + 6);
      let left = ax - w / 2;
      let top = ay - h - GAP - lift;
      const flip = top < clip.top + MARGIN && lift === 0;
      if (flip) top = ay + HEAD_PX * s + 10;
      left = Math.min(Math.max(left, clip.left + MARGIN), Math.max(clip.left + MARGIN, clip.right - MARGIN - w));
      top = Math.min(Math.max(top, clip.top + MARGIN), Math.max(clip.top + MARGIN, clip.bottom - MARGIN - h));
      el.style.transform = `translate3d(${((left - layer.left) / s).toFixed(2)}px, ${((top - layer.top) / s).toFixed(2)}px, 0) scale(${(1 / s).toFixed(4)})`;
      el.style.setProperty("--tx", `${Math.min(Math.max(ax - left, 18), w - 18).toFixed(1)}px`);
      el.dataset.flip = flip ? "1" : "";
      el.style.visibility = "visible";
    }
    for (const id of eased.current.keys()) if (!cardsRef.current.some((c) => c.id === id)) eased.current.delete(id);
  };
  useWorldScale(root, cards.length > 0, (s, layer, clip, dt) => frame.current(s, layer, clip, dt));

  return (
    <div ref={root} className={css.layer} style={{ width: scene.width, height: scene.height }} role="status" aria-live="polite">
      {cards.map((card) => (
        <div
          key={card.id}
          ref={(el) => {
            if (el) els.current.set(card.id, el);
            else els.current.delete(card.id);
          }}
          className={css.anchor}
          data-popup={card.id}
        >
          <div className={css.life} style={{ ["--life" as string]: `${card.ttlMs}ms` }}>
            <div className={`${css.face} animate-stamp`} data-compact={card.body ? undefined : "1"}>
              <button type="button" className={css.hit} onClick={() => close(card)} aria-label={`${card.title}. Tap to close.`}>
                <span className={css.title}>
                  {card.lock && <Lock size={12} aria-hidden strokeWidth={2.4} />}
                  {card.title}
                </span>
                {card.body && <span className={css.body}>{card.body}</span>}
              </button>
              <i className={css.tail} aria-hidden />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
