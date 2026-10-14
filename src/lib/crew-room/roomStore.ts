"use client";

import { create } from "zustand";
import type { Tile } from "@/lib/campaign/geometry";

/**
 * What the room scene shares with the rest of the room screen. The world (CampaignWorld) owns the walker, but the
 * screen chrome (the Game Time banner and win sheet, the voice pill, the welcome card) sits outside it and needs the
 * same facts, so they live here instead of in component state.
 *
 *   me         my tile right now (steps every 85 ms while walking), or null while watching a full room
 *   walkTo     walk my avatar to a tile: the same call a tap on the floor makes (null until the world is mounted)
 *   speaking   user ids heard speaking right now in the voice room (only people you can actually hear, plus you)
 *   huntActive a Game Time is scheduled or live for this room. Game Time sets it. While it is true the door and the
 *              rails ask "Leave the hunt?" before they take anyone out of the room
 *
 * Reset when the world unmounts, so a stale tile never leaks from one crew's room into the next.
 */
type RoomStore = {
  me: Tile | null;
  walkTo: ((x: number, y: number) => void) | null;
  speaking: string[];
  huntActive: boolean;
  setMe: (me: Tile | null) => void;
  setWalkTo: (walkTo: ((x: number, y: number) => void) | null) => void;
  setSpeaking: (ids: string[]) => void;
  setHuntActive: (active: boolean) => void;
  reset: () => void;
};

export const useRoomStore = create<RoomStore>((set) => ({
  me: null,
  walkTo: null,
  speaking: [],
  huntActive: false,
  setMe: (me) => set((s) => (s.me?.x === me?.x && s.me?.y === me?.y ? s : { me })),
  setWalkTo: (walkTo) => set({ walkTo }),
  setSpeaking: (ids) => set((s) => (s.speaking.length === ids.length && s.speaking.every((id, i) => id === ids[i]) ? s : { speaking: ids })),
  setHuntActive: (huntActive) => set({ huntActive }),
  reset: () => set({ me: null, walkTo: null, speaking: [], huntActive: false }),
}));
