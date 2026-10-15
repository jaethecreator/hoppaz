"use client";

import { create } from "zustand";

/**
 * Unsent crew room messages. They live here, above the room screen, so a session that expires, a rejoin, a second
 * tab or a trip back to the crew list never loses one: the chat can unmount and come back and the words are still
 * there. One draft per crew and conversation: `<crew>:general`, and `<crew>:area:<area id>` for each conversation area.
 *
 * An area draft remembers the area session it was written in (`circle`). If that area has started a fresh session
 * since (everyone left), the chat asks before sending it there. A private draft is never moved to General.
 *
 * Memory only: a reload starts clean, and nothing private is written to the phone's storage.
 */
export type Draft = { text: string; circle: string | null };

type DraftState = {
  drafts: Record<string, Draft>;
  set: (key: string, draft: Draft) => void;
};

export const useRoomDrafts = create<DraftState>((set) => ({
  drafts: {},
  set: (key, draft) => set((s) => ({ drafts: { ...s.drafts, [key]: draft } })),
}));

export const draftKey = (crew: string, area: string | null) => (area ? `${crew}:area:${area}` : `${crew}:general`);
