/**
 * "Mute vibes" (design 8.3): a switch in Me, Settings. On: vibes other Hoppers send show over heads in a crew room, with
 * their sound and buzz. Off: they do not show, sound or buzz at all. Sending is never affected, and a wave (a tap on the
 * shoulder you can answer) still arrives. Kept in this browser (localStorage "hz-mute-vibes": "on" for muted), the way the
 * Buzz switch is. A blocked person is never shown either way, on the server.
 */
const KEY = "hz-mute-vibes";
let muted = false;
const listeners = new Set<() => void>();

try {
  muted = typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "on";
} catch {
  /* storage blocked: vibes stay on for this visit */
}

export const vibeMute = {
  isMuted: () => muted,
  setMuted(next: boolean) {
    if (muted === next) return;
    muted = next;
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      /* kept for this visit only */
    }
    listeners.forEach((cb) => cb());
  },
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => void listeners.delete(cb);
  },
};
