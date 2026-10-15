"use client";

import { create } from "zustand";
import type { Tile } from "@/lib/campaign/geometry";

/**
 * What the room scene shares with the rest of the room screen. The world (CampaignWorld) owns the walker, but the
 * screen chrome (the chat sheet, the Hopper menu, the action pill, the Game Time banner and win sheet, the HUD) sits
 * outside it and needs the same facts, so they live here instead of in component state. Owned by the SHELL builder;
 * every other room file reads and writes the fields below and nothing else.
 *
 * ME AND WALKING
 *   me         my tile right now (steps every 85 ms while walking), or null while watching a full room
 *   walkTo     walk my avatar to a tile: the same call a tap on the floor makes (null until the world is mounted)
 *   tile       px per tile in world space (layout.grid.tile, 32). Set by the world when it mounts
 *   zone       the area or zone id I am standing in ("stage", "studio", "awards", "courtyard", "records", "campaign"
 *              for the zones; an area id for a conversation area, which wins over the zone), or null
 *
 * PEOPLE
 *   peers      everyone else in the room right now: id, name, tile x/y, avatar look, and the wave key when the room
 *              has one (src/lib/chat.ts wave(key)). Set by the world. Never includes me
 *   tappedPeer the id of the Hopper whose avatar I just tapped, or null. The world sets it, the Hopper menu reads it
 *              and clears it (setTappedPeer(null))
 *   speaking   user ids heard speaking right now in the voice room (only people you can actually hear, plus you)
 *
 * IN-GAME UI
 *   action     the ONE pill above the bottom nav. Many files register an action (setAction with a priority, clearAction
 *              by id); the store keeps them all and exposes only the highest priority as `action`. Priorities in use:
 *              100 Game Time, 50 the fountain, 40 the event sheet, 10 the exit door. Equal priority: the newest wins
 *   popups     the small cards inside the world (zone cards, "can't walk there" hints). pushPopup replaces a popup with
 *              the same id. The popup layer (PopUps.tsx) draws them and calls dismissPopup when they fade; the store
 *              also drops each one itself a little after its ttlMs, so a layer that never mounts cannot pile them up
 *   sheet      the chat sheet: "closed" (nothing drawn but the CHAT button), "peek", "half" or "full". The shell's CHAT
 *              button sets "half"; the sheet (ChatSheet) owns every change after that and writes the new state here
 *   sheetHeight px from the bottom of the stage (the world area between the header and the tab bar) up to the top edge of
 *              the sheet, keyboard lift included; 0 when closed. ChatSheet writes it when the sheet settles and when
 *              the keyboard changes it (not on every drag frame). The camera keeps my avatar above this line and the
 *              bottom row (action pill, buttons) rides on it
 *   unread     General messages from others I have not seen. ChatSheet owns it (reset to 0 when the sheet shows the
 *              bottom of General); the CHAT button in the shell shows it
 *   view       the camera: "full" shows the whole room, "me" follows my avatar. The HUD button and the open sequence
 *              set it; the world reads it
 *
 * GAME TIME
 *   huntActive a Game Time is scheduled or live for this room. Game Time sets it. While it is true the door and the
 *              rails ask "Leave the hunt?" before they take anyone out of the room
 *
 * Reset when the world unmounts, so a stale tile never leaks from one crew's room into the next.
 */
export type RoomAction = { id: string; label: string; priority: number; onPress: () => void };
export type RoomPopup = { id: string; title: string; body?: string; tile?: { x: number; y: number }; ttlMs: number };
export type RoomPeerPoint = { id: string; name: string; x: number; y: number; look: unknown; key?: string };
export type RoomSheet = "closed" | "peek" | "half" | "full";
export type RoomView = "full" | "me";

type RoomStore = {
  me: Tile | null;
  walkTo: ((x: number, y: number) => void) | null;
  speaking: string[];
  huntActive: boolean;
  /** The one action pill that shows: the highest priority registered, or null. */
  action: RoomAction | null;
  popups: RoomPopup[];
  peers: RoomPeerPoint[];
  tile: number;
  tappedPeer: string | null;
  sheet: RoomSheet;
  sheetHeight: number;
  unread: number;
  zone: string | null;
  view: RoomView;
  setMe: (me: Tile | null) => void;
  setWalkTo: (walkTo: ((x: number, y: number) => void) | null) => void;
  setSpeaking: (ids: string[]) => void;
  setHuntActive: (active: boolean) => void;
  setAction: (action: RoomAction) => void;
  clearAction: (id: string) => void;
  pushPopup: (popup: RoomPopup) => void;
  dismissPopup: (id: string) => void;
  setPeers: (peers: RoomPeerPoint[]) => void;
  setTile: (tile: number) => void;
  setTappedPeer: (id: string | null) => void;
  setSheet: (sheet: RoomSheet) => void;
  setSheetHeight: (px: number) => void;
  setUnread: (n: number) => void;
  setZone: (zone: string | null) => void;
  setView: (view: RoomView) => void;
  reset: () => void;
};

/** All registered actions by id, kept outside the store state so `action` is the only thing a listener sees. */
let registered: RoomAction[] = [];
const best = () => registered.reduce<RoomAction | null>((top, a) => (!top || a.priority >= top.priority ? a : top), null);

/** A popup is dropped by the store this long after its ttl, in case the popup layer never dismisses it. */
const POPUP_GRACE = 700;
const MAX_POPUPS = 4;
const popupTimers = new Map<string, ReturnType<typeof setTimeout>>();
const clearPopupTimer = (id: string) => {
  const t = popupTimers.get(id);
  if (t) clearTimeout(t);
  popupTimers.delete(id);
};

const samePeers = (a: RoomPeerPoint[], b: RoomPeerPoint[]) =>
  a.length === b.length && a.every((p, i) => p.id === b[i].id && p.x === b[i].x && p.y === b[i].y && p.name === b[i].name && p.key === b[i].key && p.look === b[i].look);

const initial = {
  me: null,
  walkTo: null,
  speaking: [] as string[],
  huntActive: false,
  action: null,
  popups: [] as RoomPopup[],
  peers: [] as RoomPeerPoint[],
  tile: 32,
  tappedPeer: null,
  sheet: "closed" as RoomSheet,
  sheetHeight: 0,
  unread: 0,
  zone: null,
  view: "full" as RoomView,
};

export const useRoomStore = create<RoomStore>((set, get) => ({
  ...initial,
  setMe: (me) => set((s) => (s.me?.x === me?.x && s.me?.y === me?.y ? s : { me })),
  setWalkTo: (walkTo) => set({ walkTo }),
  setSpeaking: (ids) => set((s) => (s.speaking.length === ids.length && s.speaking.every((id, i) => id === ids[i]) ? s : { speaking: ids })),
  setHuntActive: (huntActive) => set({ huntActive }),
  setAction: (action) => {
    registered = [...registered.filter((a) => a.id !== action.id), action];
    set({ action: best() });
  },
  clearAction: (id) => {
    if (!registered.some((a) => a.id === id)) return;
    registered = registered.filter((a) => a.id !== id);
    set({ action: best() });
  },
  pushPopup: (popup) => {
    clearPopupTimer(popup.id);
    popupTimers.set(
      popup.id,
      setTimeout(() => get().dismissPopup(popup.id), Math.max(200, popup.ttlMs) + POPUP_GRACE),
    );
    set((s) => ({ popups: [...s.popups.filter((p) => p.id !== popup.id), popup].slice(-MAX_POPUPS) }));
  },
  dismissPopup: (id) => {
    clearPopupTimer(id);
    set((s) => (s.popups.some((p) => p.id === id) ? { popups: s.popups.filter((p) => p.id !== id) } : s));
  },
  setPeers: (peers) => set((s) => (samePeers(s.peers, peers) ? s : { peers })),
  setTile: (tile) => set((s) => (s.tile === tile ? s : { tile })),
  setTappedPeer: (tappedPeer) => set((s) => (s.tappedPeer === tappedPeer ? s : { tappedPeer })),
  setSheet: (sheet) => set((s) => (s.sheet === sheet ? s : { sheet })),
  setSheetHeight: (px) => set((s) => (s.sheetHeight === px ? s : { sheetHeight: px })),
  setUnread: (unread) => set((s) => (s.unread === unread ? s : { unread })),
  setZone: (zone) => set((s) => (s.zone === zone ? s : { zone })),
  setView: (view) => set((s) => (s.view === view ? s : { view })),
  reset: () => {
    registered = [];
    for (const id of [...popupTimers.keys()]) clearPopupTimer(id);
    set({ ...initial });
  },
}));
