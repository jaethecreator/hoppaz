/**
 * The create page keeps what was typed in sessionStorage, so nothing is lost on a reload or on the trip out to Google and back.
 * Every read and write is wrapped: storage can be blocked or full, and the page must work without it.
 * The cover picture is a data URL that can be too big, so it has its own key: if it does not fit, the rest is still kept.
 */
const KEY = "hz-create-draft";
const COVER = "hz-create-draft-cover";

export type Mode = "event" | "room";
export type Draft = {
  mode?: Mode;
  /** Set while the sign up wall is open: after sign up (or the return from Google) the thing is made at once. */
  pending?: Mode | null;
  event?: Record<string, unknown>;
  room?: Record<string, unknown>;
};

export function readDraft(): Draft {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Draft) : {};
  } catch {
    return {};
  }
}

export function patchDraft(patch: Partial<Draft>): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...readDraft(), ...patch }));
  } catch {
    /* storage is blocked or full: the page still works, it just cannot remember */
  }
}

export function readCover(): string | null {
  try {
    return window.sessionStorage.getItem(COVER);
  } catch {
    return null;
  }
}

export function writeCover(cover: string | null): void {
  try {
    if (cover) window.sessionStorage.setItem(COVER, cover);
    else window.sessionStorage.removeItem(COVER);
  } catch {
    /* too big to keep: the draft goes on without the cover */
  }
}

export function clearDraft(): void {
  try {
    window.sessionStorage.removeItem(KEY);
    window.sessionStorage.removeItem(COVER);
  } catch {
    /* nothing to clear */
  }
}

export const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
export const bool = (v: unknown, d = false): boolean => (typeof v === "boolean" ? v : d);
