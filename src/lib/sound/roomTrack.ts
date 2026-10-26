"use client";

import { create } from "zustand";

/**
 * What a crew room screen tells <MusicHost /> (docs/CREW-ROOMS.md): whether the Hopper is in the room yet (the gate,
 * a join or a room open in another tab stays silent), and the loop its owner set ("Direct audio link"), or null for
 * the room theme. Nothing here makes a sound.
 */
export const useRoomTrack = create<{
  inside: boolean;
  url: string | null;
  /** The owner set a YouTube mix (RoomMix plays it): the room theme stays silent under it. */
  mix: boolean;
  set: (inside: boolean, url: string | null, mix?: boolean) => void;
}>((set) => ({
  inside: false,
  url: null,
  mix: false,
  set: (inside, url, mix = false) => set({ inside, url, mix }),
}));
