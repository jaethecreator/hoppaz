"use client";

import { create } from "zustand";

/**
 * What a crew room screen tells <MusicHost /> (docs/CREW-ROOMS.md): whether the Hopper is in the room yet (the gate,
 * a join or a room open in another tab stays silent), and the loop its owner set ("Direct audio link"), or null for
 * the room theme. Nothing here makes a sound.
 */
export const useRoomTrack = create<{ inside: boolean; url: string | null; set: (inside: boolean, url: string | null) => void }>(
  (set) => ({
    inside: false,
    url: null,
    set: (inside, url) => set({ inside, url }),
  })
);
