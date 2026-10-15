"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, Compass, MessageCircle, X } from "lucide-react";
import type { CampaignLayout } from "@/lib/campaign/layout";
import { useChatDock } from "@/lib/crew-room/chatStore";
import { useReactions } from "@/lib/crew-room/chatReactions";
import { useRoomStore, type RoomSheet } from "@/lib/crew-room/roomStore";
import type { CrewRoomConnection } from "@/lib/crew-room/types";
import ChatWelcome from "./ChatWelcome";
import CrewRoomChat, { type PullHandlers } from "./CrewRoomChat";
import Explore from "./Explore";
import css from "./ChatSheet.module.css";

/**
 * The translucent chat sheet that slides up over the lower part of the world and pulls down to close (design section
 * 9). Owned by CHAT. Its EXPLORE tab renders <Explore crewId=... /> from ./Explore.
 *
 * SCREEN CHROME, mounted by CampaignExperience over the room (screen pixels), in a wrapper that fills the room stage
 * (the area between the header and the bottom nav) and is click-through. This component opts in to pointer events on
 * the sheet only.
 *
 * It draws nothing while roomStore.sheet is "closed" (the shell's CHAT button opens it by setting "half"). From there it
 * owns every change of state and writes it back: setSheet on every snap (pull-down to "closed" included),
 * setSheetHeight (px from the stage bottom to the sheet's top edge, keyboard lift included, 0 when closed or docked)
 * when it settles, and setUnread. On a landscape phone and on a tablet or desktop it is a side panel instead
 * (useChatDock().dock is its width), with no states.
 *
 *   closed 0   peek 156 (192 in an area)   half clamp(280, 46% of the stage, 420)   full stage height minus 132
 */
export type ChatSheetProps = { crewId: string; layout: CampaignLayout; room: CrewRoomConnection; userId: string };

type Tab = "general" | "area" | "explore";
type Open = Exclude<RoomSheet, "closed">;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** A flick faster than this (px per ms) goes one state in its direction. */
const FLICK = 0.5;
/** A fast flick down from half closes outright. */
const HARD_FLICK = 0.9;
/** A shift of the visual viewport smaller than this is the browser's own bars, not a keyboard. */
const KEYBOARD_MIN = 80;
const CLOSE_MS = 230;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** How far the keyboard (or anything else) covers the bottom of `root`, from the visual viewport. */
function useKeyboardLift(root: React.RefObject<HTMLElement | null>) {
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const el = root.current;
      if (!el || vv.scale > 1.02) return;
      const covered = Math.round(el.getBoundingClientRect().bottom - (vv.offsetTop + vv.height));
      const next = covered >= KEYBOARD_MIN ? covered : 0;
      setLift((old) => (old === next ? old : next));
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [root]);
  return lift;
}

/** Side-panel width: 320 on a landscape phone, 360 on a tablet or desktop, 0 on a portrait phone (a bottom sheet). */
function useDockWidth() {
  const [dock, setDock] = useState(0);
  useEffect(() => {
    const read = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setDock(h < 500 && w > h ? 320 : w >= 900 ? 360 : 0);
    };
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return dock;
}

export default function ChatSheet({ crewId, layout, room, userId }: ChatSheetProps) {
  const sheet = useRoomStore((s) => s.sheet);
  const setSheet = useRoomStore((s) => s.setSheet);
  const setSheetHeight = useRoomStore((s) => s.setSheetHeight);
  const setUnread = useRoomStore((s) => s.setUnread);
  const root = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLElement>(null);
  const [stageH, setStageH] = useState(0);
  const [tab, setTab] = useState<Tab>("general");
  const [note, setNote] = useState("");
  const [areaUnread, setAreaUnread] = useState(0);
  const [entering, setEntering] = useState(false);
  const lift = useKeyboardLift(root);
  const dockWidth = useDockWidth();
  const drag = useRef<{ y0: number; h0: number; s0: Open; lastY: number; lastT: number; v: number; max: number } | null>(null);

  const snapshot = room.snapshot;
  const brand = (snapshot?.room.content.brand || snapshot?.crew.name || "this crew").replace(/360\s*play\s*list/i, "360Playlist");
  const circle = snapshot?.self?.circle_id ?? null;
  const area = layout.privateAreas.find((a) => a.id === room.world?.areaId) ?? null;
  const inArea = !!area && !!circle && !room.watching;
  const members = snapshot?.peers.filter((p) => circle && p.circle_id === circle).length ?? 0;
  const here = snapshot?.peers.length ?? 0;
  const closed = sheet === "closed";
  const docked = dockWidth > 0;
  // Showing the Area tab only makes sense inside an area; leaving one sends the sheet back to General.
  const shown: Tab = tab === "area" && !inArea ? "general" : tab;

  // ------------------------------------------------------------------ sizes --
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const read = () => setStageH(node.clientHeight);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(read);
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  const free = Math.max(0, stageH - lift);
  const heights = useMemo(() => {
    const room8 = Math.max(0, free - 8);
    const peek = Math.min(inArea ? 192 : 156, room8);
    const half = Math.min(clamp(0.46 * stageH, 280, 420), room8);
    const full = Math.max(half, Math.min(stageH - 132, room8));
    return { closed: 0, peek, half, full };
  }, [free, stageH, inArea]);
  const targetH = docked ? stageH - lift : heights[sheet];

  // The sheet's state is read from event handlers and timers, so they get it from a ref.
  const live = useRef({ sheet, heights, docked, tab: shown });
  useLayoutEffect(() => {
    live.current = { sheet, heights, docked, tab: shown };
  });

  // The height is written straight to the element during a drag and a close, so React's own value can be stale:
  // put it back in step whenever the state, the stage or the keyboard changes.
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || drag.current) return;
    node.style.height = docked ? "" : `${targetH}px`;
  }, [targetH, docked, closed, sheet]);

  // Tell the shell where the sheet's top edge is, once it settles (not on every drag frame).
  useEffect(() => {
    setSheetHeight(closed || docked ? 0 : Math.round(targetH + lift));
  }, [closed, docked, targetH, lift, setSheetHeight]);
  useEffect(() => {
    useChatDock.getState().setDock(closed ? 0 : dockWidth);
  }, [closed, dockWidth]);
  useEffect(
    () => () => {
      useRoomStore.getState().setSheetHeight(0);
      useRoomStore.getState().setUnread(0);
      useChatDock.getState().setDock(0);
    },
    []
  );

  // Opening plays the rise once.
  const wasClosed = useRef(true);
  useEffect(() => {
    if (wasClosed.current && !closed) {
      wasClosed.current = false;
      if (!reducedMotion()) {
        setEntering(true);
        const t = setTimeout(() => setEntering(false), 300);
        return () => clearTimeout(t);
      }
    }
    if (closed) wasClosed.current = true;
  }, [closed]);

  // ---------------------------------------------------------------- tabs --
  const lastArea = useRef("");
  useEffect(() => {
    if (area) lastArea.current = area.name;
  }, [area]);
  const wasIn = useRef(inArea);
  useEffect(() => {
    if (wasIn.current && !inArea && lastArea.current && live.current.tab === "general" && tab === "area") {
      setNote(`You left ${lastArea.current}. Back to General.`);
      const t = setTimeout(() => setNote(""), 3000);
      wasIn.current = inArea;
      return () => clearTimeout(t);
    }
    wasIn.current = inArea;
  }, [inArea, tab]);
  useEffect(() => {
    if (!inArea) setAreaUnread(0);
  }, [inArea]);

  // The header (and with it the way back from Explore) is not drawn at peek, so Explore never stays on at peek.
  useEffect(() => {
    if (tab === "explore" && sheet === "peek") setTab("general");
  }, [tab, sheet]);

  const pickTab = (next: Tab) => {
    setTab(next);
    setNote("");
    if (next === "area") setAreaUnread(0);
    if (next === "explore" && live.current.sheet === "peek") setSheet("half");
  };

  // ---------------------------------------------------------------- unread --
  // General messages from other people that come in while the list is not on the newest line of General (sheet closed,
  // another tab, or scrolled up). The Area tab keeps its own count.
  const atBottom = useRef(true);
  const general = room.threads.general?.items;
  const areaItems = circle ? room.threads[circle]?.items : undefined;
  const lastSeen = useRef<{ general?: string; area?: string }>({});
  useEffect(() => {
    const watchThread = (items: RoomMessageList | undefined, key: "general" | "area", add: (n: number) => void) => {
      if (!items?.length) return;
      const last = items[items.length - 1].id;
      const before = lastSeen.current[key];
      lastSeen.current[key] = last;
      if (!before || before === last) return;
      const at = items.findIndex((m) => m.id === before);
      if (at < 0) return;
      const fresh = items.slice(at + 1).filter((m) => m.author_id !== userId).length;
      if (fresh) add(fresh);
    };
    const l = live.current;
    const visibleGeneral = l.sheet !== "closed" && l.tab === "general" && atBottom.current;
    const visibleArea = l.sheet !== "closed" && l.tab === "area" && atBottom.current;
    watchThread(general, "general", (n) => {
      if (!visibleGeneral) setUnread(useRoomStore.getState().unread + n);
    });
    watchThread(areaItems, "area", (n) => {
      if (!visibleArea) setAreaUnread((old) => old + n);
    });
  }, [general, areaItems, userId, setUnread]);
  // Fresh area session: start its count from what is there.
  useEffect(() => {
    lastSeen.current.area = undefined;
  }, [circle]);

  const onAtBottom = useCallback(
    (bottom: boolean) => {
      atBottom.current = bottom;
      if (!bottom) return;
      if (live.current.tab === "general" && live.current.sheet !== "closed") setUnread(0);
      if (live.current.tab === "area") setAreaUnread(0);
    },
    [setUnread]
  );
  // Opening, or coming back to General, at the bottom reads it.
  useEffect(() => {
    if (!closed && shown === "general" && atBottom.current) setUnread(0);
  }, [closed, shown, setUnread]);

  // ------------------------------------------------------- closing, escape --
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = useCallback(() => {
    const node = el.current;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (!node || reducedMotion() || live.current.docked) {
      setSheet("closed");
      return;
    }
    node.style.height = "0px";
    closeTimer.current = setTimeout(() => setSheet("closed"), CLOSE_MS);
  }, [setSheet]);
  useEffect(() => () => void (closeTimer.current && clearTimeout(closeTimer.current)), []);
  useEffect(() => {
    if (closed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closed, close]);

  // ----------------------------------------------------------------- drag --
  const pull = useMemo<PullHandlers>(
    () => ({
      begin: (y) => {
        const node = el.current;
        const l = live.current;
        if (!node || l.docked || l.sheet === "closed") return false;
        node.classList.add(css.dragging);
        drag.current = { y0: y, h0: node.offsetHeight, s0: l.sheet, lastY: y, lastT: performance.now(), v: 0, max: l.heights.full };
        return true;
      },
      move: (y) => {
        const d = drag.current;
        const node = el.current;
        if (!d || !node) return;
        const now = performance.now();
        const dt = now - d.lastT;
        if (dt > 0) d.v = 0.7 * d.v + 0.3 * ((y - d.lastY) / dt);
        d.lastY = y;
        d.lastT = now;
        node.style.height = `${clamp(d.h0 - (y - d.y0), 0, d.max)}px`;
      },
      end: () => {
        const d = drag.current;
        const node = el.current;
        drag.current = null;
        if (!d || !node) return;
        node.classList.remove(css.dragging);
        const l = live.current;
        const stops: { state: RoomSheet; h: number }[] = [
          { state: "closed", h: 0 },
          { state: "peek", h: l.heights.peek },
          { state: "half", h: l.heights.half },
          { state: "full", h: l.heights.full },
        ];
        const here = node.offsetHeight;
        const from = stops.findIndex((s) => s.state === d.s0);
        let to = stops.reduce((best, s, i) => (Math.abs(s.h - here) < Math.abs(stops[best].h - here) ? i : best), 0);
        if (Math.abs(d.v) > FLICK) {
          if (d.v > 0) to = d.v > HARD_FLICK && d.s0 === "half" ? 0 : Math.max(0, from - 1);
          else to = Math.min(3, from + 1);
        }
        const next = stops[to];
        if (next.state === "closed") {
          node.style.height = "0px";
          if (closeTimer.current) clearTimeout(closeTimer.current);
          closeTimer.current = setTimeout(() => setSheet("closed"), CLOSE_MS);
        } else {
          node.style.height = `${next.h}px`;
          setSheet(next.state);
        }
      },
    }),
    [setSheet]
  );

  const onGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button") || e.button > 0) return;
    if (!pull.begin(e.clientY)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onGripMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) pull.move(e.clientY);
  };
  const onGripUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const moved = Math.abs(e.clientY - drag.current.y0) > 6;
    const s0 = drag.current.s0;
    pull.end();
    // A tap on the handle steps the sheet: peek opens, half drops to peek, full drops to half.
    if (!moved && e.type === "pointerup") setSheet(s0 === "peek" ? "half" : s0 === "half" ? "peek" : "half");
  };

  // The keyboard lifts a peeking sheet to half, so the words being typed have room.
  const onInputFocus = useCallback(() => {
    if (live.current.sheet === "peek") setSheet("half");
  }, [setSheet]);
  // Walking to someone from a message: the sheet drops to a peek so the walk shows.
  const onWalked = useCallback(() => {
    if (!live.current.docked) setSheet("peek");
  }, [setSheet]);

  // ---------------------------------------------------------------- reactions --
  const idsOf = (items: { id: string }[] | undefined) => (items ?? []).slice(-60).map((m) => m.id);
  const reactionIds = useMemo(() => [...idsOf(general), ...idsOf(areaItems)], [general, areaItems]);
  const reactions = useReactions(crewId, userId, closed ? [] : reactionIds);

  const peek = !docked && sheet === "peek";
  const explore = shown === "explore";
  const welcomeTop = Math.max(8, (Math.max(0, stageH - (closed ? 0 : targetH + lift)) * 0.3) | 0);

  return (
    <div className={css.root} ref={root} data-chat-root>
      <section
        ref={el}
        className={`${css.sheet} ${docked ? css.docked : ""} ${entering ? css.entering : ""}`}
        hidden={closed}
        aria-label="Chat"
        data-sheet={sheet}
        style={{ height: docked ? undefined : targetH, bottom: lift, "--dock": `${dockWidth}px` } as React.CSSProperties}
      >
        <div
          className={`${css.grip} ${peek ? css.gripPeek : ""}`}
          onPointerDown={docked ? undefined : onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
        >
          {!docked && <span className={css.handle} aria-hidden />}
          {!peek && (
            <div className={css.head}>
              <div className={css.title}>
                <h2>{explore ? "Explore" : "Chat"}</h2>
                {!explore && (
                  <span>
                    <i aria-hidden />
                    {here} here
                  </span>
                )}
              </div>
              <button type="button" className={css.ctl} onClick={() => pickTab(explore ? "general" : "explore")}>
                {explore ? <MessageCircle size={16} aria-hidden /> : <Compass size={16} aria-hidden />}
                {explore ? "Back to chat" : "Explore"}
              </button>
              <button type="button" className={`${css.ctl} ${css.ctlIcon}`} aria-label="Close chat" onClick={close}>
                {docked ? <X size={18} aria-hidden /> : <ChevronDown size={20} aria-hidden />}
              </button>
            </div>
          )}
        </div>
        {inArea && area && !explore && (
          <div className={css.tabs} role="group" aria-label="Conversation">
            <button type="button" className="chip" aria-pressed={shown === "general"} onClick={() => pickTab("general")}>
              General
            </button>
            <button type="button" className="chip" aria-pressed={shown === "area"} onClick={() => pickTab("area")}>
              {area.name} · {members}
              {areaUnread > 0 && shown !== "area" && <i className={css.dot} aria-label="New messages" />}
            </button>
          </div>
        )}
        {note && (
          <p className={css.left} role="status">
            {note}
          </p>
        )}
        {explore ? (
          <div className={css.explore}>
            <Explore crewId={crewId} />
          </div>
        ) : (
          <CrewRoomChat
            key={shown}
            crewId={crewId}
            room={room}
            userId={userId}
            tab={shown === "area" ? "area" : "general"}
            area={area ? { id: area.id, name: area.name } : null}
            circle={circle}
            active={!closed}
            reactions={reactions}
            pull={pull}
            brand={brand}
            onAtBottom={onAtBottom}
            onInputFocus={onInputFocus}
            onWalked={onWalked}
          />
        )}
      </section>
      <ChatWelcome crewId={crewId} brand={brand} top={welcomeTop} />
    </div>
  );
}

type RoomMessageList = CrewRoomConnection["threads"][string]["items"];
