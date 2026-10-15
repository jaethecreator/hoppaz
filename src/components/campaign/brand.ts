/**
 * How a room's name is written wherever a person can read it. The brand is "360Playlist", one word. Rooms saved before
 * the rename (and a crew typed by hand) may still carry the space, so every place that shows the name goes through here.
 */
export const roomName = (name: string) => name.replace(/\b360\s+play\s*list\b/gi, "360Playlist").trim();

/** The name for a sign: upper case, so 360PLAYLIST. */
export const roomSign = (name: string) => roomName(name).toUpperCase();
