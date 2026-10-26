/**
 * A YouTube link the owner pasted as the room's music ("Room music loop" in the room settings): one video, or a playlist.
 * Anything else (a hosted audio file) is not YouTube and is null here, so it plays through the loop player as before.
 */
export type YouTubeMix = { video: string | null; list: string | null };

const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"]);
const ID = /^[A-Za-z0-9_-]{11}$/;
const LIST = /^[A-Za-z0-9_-]{10,60}$/;

export function parseYouTube(value: string | null | undefined): YouTubeMix | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  let video: string | null = null;
  if (url.hostname.toLowerCase().endsWith("youtu.be")) video = parts[0] ?? null;
  else if (url.pathname === "/watch") video = url.searchParams.get("v");
  else if (["live", "embed", "shorts", "v"].includes(parts[0] ?? "")) video = parts[1] ?? null;
  const list = url.searchParams.get("list");
  const mix: YouTubeMix = {
    video: video && ID.test(video) ? video : null,
    list: list && LIST.test(list) ? list : null,
  };
  return mix.video || mix.list ? mix : null;
}
