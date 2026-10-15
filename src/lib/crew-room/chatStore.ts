"use client";

import { create } from "zustand";

/**
 * What the chat sheet shares that roomStore has no field for.
 *
 *   dock  when the chat is a side panel instead of a bottom sheet (a landscape phone: 320 px, a tablet or desktop:
 *         360 px) and it is open, its width in px; otherwise 0. In that mode the sheet takes the right edge of the room
 *         stage for its full height and roomStore.sheetHeight stays 0, so the camera should treat `dock` px of the
 *         world's width as taken (keep my avatar in the left part) and keep the bottom row and action pill clear of it.
 *
 * The sheet's state (closed, peek, half, full), its height and the unread count are in roomStore (sheet, sheetHeight,
 * unread). Memory only; ChatSheet resets it when it unmounts.
 */
type ChatDock = {
  dock: number;
  setDock: (dock: number) => void;
};

export const useChatDock = create<ChatDock>((set) => ({
  dock: 0,
  setDock: (dock) => set((s) => (s.dock === dock ? s : { dock })),
}));
