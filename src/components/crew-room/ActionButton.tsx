"use client";

import { useEffect, useRef, useState } from "react";
import { DoorOpen, Mic, Search, Ticket } from "lucide-react";
import type { CampaignLayout } from "@/lib/campaign/layout";
import { useRoomStore, type RoomAction } from "@/lib/crew-room/roomStore";
import css from "./Places.module.css";

/**
 * The one thumb-sized pill above the bottom nav (design section 7). Renders useRoomStore().action; label and onPress come from whoever registered it.
 *
 * SCREEN CHROME, owned by PLACES. Mounted by CampaignExperience over the room, outside the scaled world, in screen
 * pixels. The mount is an absolutely positioned wrapper that fills the area between the header and the bottom nav
 * (the room stage) and is click-through: opt in to pointer events on your own surfaces (`pointer-events: auto`).
 *
 * Where it sits: the bottom row at `bottom: var(--room-bottom)` (the shell sets it on the chrome wrapper: 12 px, plus the
 * chat sheet's height while it is open; my own 12 px plus roomStore sheetHeight stands in when the variable is missing),
 * from 64 px (right of the CHAT button, which is its 44 px icon while a pill shows) to 12 px from the right edge. At
 * sheet "full" it is hidden. Only the highest priority
 * action shows (the store decides); a new one stamps in, the last one fades out in 120 ms. On a keyboard, E presses it.
 *
 * Icon by action id, since the store's action has no icon field: "gt-*" and "search" get Search, "exit" the door,
 * "go-live" the mic, "fountain-event" (and anything else) the ticket.
 */
export type ActionButtonProps = { crewId: string; layout: CampaignLayout };

function PillIcon({ id }: { id: string }) {
  const props = { size: 18, strokeWidth: 2.4, "aria-hidden": true } as const;
  if (id.startsWith("gt-") || id === "search") return <Search {...props} />;
  if (id === "exit") return <DoorOpen {...props} />;
  if (id === "go-live") return <Mic {...props} />;
  return <Ticket {...props} />;
}

/** The pill's side padding and icon, so the label can be fitted to the room left in the row. */
const CHROME = 20 * 2 + 18 + 8;
/** Poppins Black caps: an em fraction per letter, with the 0.02em tracking. */
const ADVANCE = 0.76;

export default function ActionButton({ crewId, layout }: ActionButtonProps) {
  void crewId;
  void layout;
  const action = useRoomStore((s) => s.action);
  const sheet = useRoomStore((s) => s.sheet);
  const sheetHeight = useRoomStore((s) => s.sheetHeight);
  const [shown, setShown] = useState<RoomAction | null>(action);
  const [leaving, setLeaving] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);

  useEffect(() => {
    if (action) {
      setShown(action);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const t = setTimeout(() => {
      setShown(null);
      setLeaving(false);
    }, 120);
    return () => clearTimeout(t);
  }, [action]);

  // How much width the row has, to step the label down 14, 13, 12 px instead of cutting it.
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setRoom(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [shown !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Desktop: E presses the pill (design 21). Never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "e" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.matches("input, textarea, select") || t.isContentEditable)) return;
      useRoomStore.getState().action?.onPress();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!shown || sheet === "full") return null;
  const big = shown.id.startsWith("gt-");
  const width = Math.max(0, room);
  let font = 14;
  while (font > 12 && width && CHROME + shown.label.length * ADVANCE * font > width) font -= 1;
  const lift = sheet !== "closed" && sheetHeight > 0 ? sheetHeight : 0;

  return (
    <div ref={row} className={css.pillRow} style={{ bottom: `var(--room-bottom, ${12 + lift}px)` }} data-action-row>
      {/* The stamp animation sits on the wrapper: its fill would override the lip button's press (a transform). */}
      <div key={shown.id} className={`${css.pillWrap} ${leaving ? css.pillOut : "animate-stamp"}`}>
        <button
          type="button"
          className={`btn ${css.pill}`}
          data-action={shown.id}
          tabIndex={leaving ? -1 : 0}
          aria-hidden={leaving || undefined}
          onClick={() => !leaving && shown.onPress()}
          style={{ borderRadius: 24, minHeight: big ? 56 : 48, minWidth: big ? 168 : undefined, paddingLeft: 20, paddingRight: 20, fontSize: font, lineHeight: "16px", letterSpacing: "0.02em", pointerEvents: leaving ? "none" : "auto" }}
        >
          <PillIcon id={shown.id} />
          {shown.label}
        </button>
      </div>
    </div>
  );
}
