"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { DoorOpen } from "lucide-react";
import { MAP_TABLE, type CampaignLayout } from "@/lib/campaign/layout";
import { tilesFrom, usePlaceAction } from "@/lib/crew-room/featured";
import { useGoOut } from "@/lib/crew-room/rails";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import css from "./Places.module.css";

/**
 * The door's readable EXIT TO MAP label and its tap (design section 12). The prop id is MAP_TABLE (entry-map-table).
 *
 * WORLD LAYER, owned by PLACES. Mounted by CampaignWorld inside the world container (the scaled `.world` div), so
 * children are positioned in world pixels: a tile (x, y) sits at left x * tile, top y * tile, tile = layout.grid.tile
 * (also useRoomStore().tile). The wrapper is click-through; the plate opts in to pointer events itself.
 *
 * Walking never leaves the room. Only a tap does:
 *   the plate, when I stand against the door   goes to the map
 *   the plate, from anywhere else              walks me to the tile in front of the door; the pill shows there
 *   the pill "EXIT TO MAP" (roomStore action id "exit", priority 10)   goes to the map
 *   watching a full room (no avatar)            the plate goes straight to the map
 * The way out is useGoOut() (rails.ts), so a running Game Time asks "Leave the hunt?" first.
 *
 * The plate is counter-scaled: the world is scaled by the camera, and the plate cancels it, so it is the same 28 px on
 * screen at the full view and at 2x. It uses the shell's --cam-inv on the world element. When that variable is not
 * there, a probe element 64 world px wide measures the camera's scale instead (--inv), so the plate still reads.
 */
export type ExitDoorProps = { crewId: string; layout: CampaignLayout };

/** The pill appears against the door only (orthogonal contact), and goes at 2 tiles. */
const ENTER = 1;
const LEAVE = 2;
const PROBE = 64;

export default function ExitDoor({ crewId, layout }: ExitDoorProps) {
  void crewId;
  const goOut = useGoOut();
  const door = layout.props.find((p) => p.id === MAP_TABLE);
  const block = useMemo(() => (door ? { x: door.x, y: door.y, w: door.w, h: door.h } : null), [door?.x, door?.y, door?.w, door?.h]); // eslint-disable-line react-hooks/exhaustive-deps
  const anchor = useRef<HTMLDivElement>(null);
  const me = useRoomStore((s) => s.me);

  const leave = useCallback(() => goOut("/"), [goOut]);
  usePlaceAction({ id: "exit", label: block ? "EXIT TO MAP" : null, priority: 10, block, enter: ENTER, leave: LEAVE, onPress: leave });

  // Cancel the camera's scale so the plate stays one size on screen. Written straight to the element: React never
  // re-renders for it, and the check is one bounding box read, every frame while the zoom moves and 5 times a second
  // otherwise.
  useEffect(() => {
    const el = anchor.current;
    if (!el) return;
    let stopped = false;
    let last = 0;
    let moving = 0;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      const w = el.getBoundingClientRect().width;
      const s = w / PROBE;
      if (s > 0.05 && Math.abs(s - last) > 0.002) {
        last = s;
        moving = performance.now();
        el.style.setProperty("--inv", String(Math.round((1 / s) * 1000) / 1000));
      }
    };
    const loop = () => {
      if (stopped) return;
      read();
      if (performance.now() - moving < 500) raf = requestAnimationFrame(loop);
      else
        timer = setTimeout(() => {
          timer = null;
          raf = requestAnimationFrame(loop);
        }, 200);
    };
    raf = requestAnimationFrame(loop);
    // The shell sets --cam-inv every camera frame. If it is there a moment after mount, the probe is not needed.
    const check = setTimeout(() => {
      if (getComputedStyle(el).getPropertyValue("--cam-inv").trim()) {
        stopped = true;
        cancelAnimationFrame(raf);
        if (timer) clearTimeout(timer);
        el.style.removeProperty("--inv");
      }
    }, 600);
    return () => {
      stopped = true;
      clearTimeout(check);
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, [block]);

  if (!door || !block) return null;
  const tile = layout.grid.tile;
  const near = !!me && tilesFrom(me, block) <= ENTER;

  const tap = () => {
    const { me: at, walkTo } = useRoomStore.getState();
    if (!at) return leave(); // watching a full room: no avatar to walk
    if (tilesFrom(at, block) <= ENTER) return leave();
    // Walk to the tile in front of the door, on the side I am on.
    const x = Math.min(block.x + block.w - 1, Math.max(block.x, at.x));
    walkTo?.(x, block.y + block.h);
  };

  return (
    <div ref={anchor} className={css.doorAnchor} style={{ left: (door.x + door.w / 2) * tile - PROBE / 2, top: door.y * tile - 6 }}>
      <button
        type="button"
        className={`${css.plate} ${near ? css.plateNear : ""}`}
        data-room-object={MAP_TABLE}
        aria-label="Exit to the map"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          tap();
        }}
      >
        <DoorOpen size={12} strokeWidth={2.4} aria-hidden />
        EXIT TO MAP
      </button>
    </div>
  );
}
