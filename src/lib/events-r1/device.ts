/**
 * A random id this browser keeps so an outside ticket tap can be counted once per device per day without knowing who the person is.
 * It is a random string, never derived from anything about the person or the phone, and it is only ever sent with a ticket tap.
 * localStorage can be blocked (private window): then a tab-long id is used, so the count may be a little higher, never wrong in the other direction.
 */
const KEY = "hz.r1.device";
let mem: string | null = null;

function make(): string {
  const b = new Uint8Array(16);
  const c = typeof crypto !== "undefined" ? crypto : null;
  if (c && c.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function deviceId(): string {
  if (mem) return mem;
  try {
    const have = window.localStorage.getItem(KEY);
    if (have && /^[A-Za-z0-9_-]{8,64}$/.test(have)) return (mem = have);
    const next = make();
    window.localStorage.setItem(KEY, next);
    return (mem = next);
  } catch {
    return (mem = make());
  }
}
