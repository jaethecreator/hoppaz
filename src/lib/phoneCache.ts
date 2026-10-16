/**
 * What the phone already holds, shown at once, then refreshed quietly.
 *
 * Memory first, then localStorage under `hz.c1.`. Every storage call is wrapped: a private window, a full disk or a
 * thumbnail renderer must never break the app, it just loses the disk copy. One copy and one request in flight are
 * shared by every screen that asks for the same key.
 *
 * Keys that belong to one person contain `u.<userId>.` and are wiped on sign-out or when the user changes.
 */

const PREFIX = "hz.c1.";
/** A copy bigger than this is kept in memory only. */
const MAX_BYTES = 1_500_000;

type Entry<T> = { v: 1; at: number; data: T };

const mem = new Map<string, Entry<unknown>>();
const subs = new Map<string, Set<() => void>>();
const flights = new Map<string, Promise<unknown>>();

function disk(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The copy the phone holds for a key, or null. `at` is when it was last fetched (ms). */
export function read<T>(key: string): { data: T; at: number } | null {
  const hit = mem.get(key) as Entry<T> | undefined;
  if (hit) return { data: hit.data, at: hit.at };
  const ls = disk();
  if (!ls) return null;
  try {
    const raw = ls.getItem(PREFIX + key);
    if (!raw) return null;
    const e = JSON.parse(raw) as Entry<T>;
    if (!e || e.v !== 1 || typeof e.at !== "number" || e.data === undefined) return null;
    mem.set(key, e);
    return { data: e.data, at: e.at };
  } catch {
    return null;
  }
}

/** Store a copy (memory and disk) and tell everyone listening to the key. */
export function write<T>(key: string, data: T): void {
  const e: Entry<T> = { v: 1, at: Date.now(), data };
  mem.set(key, e);
  const ls = disk();
  if (ls) {
    try {
      const json = JSON.stringify(e);
      if (json.length <= MAX_BYTES) ls.setItem(PREFIX + key, json);
      else ls.removeItem(PREFIX + key);
    } catch {
      /* quota or blocked storage: the memory copy still serves this visit */
    }
  }
  subs.get(key)?.forEach((f) => f());
}

/** Forget every key that `drop` says yes to (memory and disk). Listeners are told, and read null. */
function removeWhere(drop: (key: string) => boolean): void {
  const hit = new Set<string>();
  for (const k of [...mem.keys()]) {
    if (drop(k)) {
      mem.delete(k);
      hit.add(k);
    }
  }
  const ls = disk();
  if (ls) {
    try {
      const gone: string[] = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && k.startsWith(PREFIX) && drop(k.slice(PREFIX.length))) gone.push(k);
      }
      gone.forEach((k) => {
        ls.removeItem(k);
        hit.add(k.slice(PREFIX.length));
      });
    } catch {
      /* blocked storage */
    }
  }
  hit.forEach((k) => subs.get(k)?.forEach((f) => f()));
}

/** Forget every key that starts with `prefix` (memory and disk). */
export function remove(prefix: string): void {
  removeWhere((k) => k.startsWith(prefix));
}

/** Wipe one person's copies (their profile, check-ins, stats), or every person's when no id is given. */
export function clearUser(userId?: string | null): void {
  remove(userId ? `u.${userId}.` : "u.");
}

/** Wipe every person's copies but this one's: a phone that changed hands never shows the last person's data. */
export function clearUsersExcept(userId: string): void {
  removeWhere((k) => k.startsWith("u.") && !k.startsWith(`u.${userId}.`));
}

/** Called whenever `write` or `remove` changes the key. Returns the unsubscribe. */
export function subscribe(key: string, fn: () => void): () => void {
  let set = subs.get(key);
  if (!set) subs.set(key, (set = new Set()));
  set.add(fn);
  return () => {
    set?.delete(fn);
  };
}

/**
 * Make sure the copy for `key` is current.
 * - A request already out for the key is shared (one network call, whoever asks).
 * - A copy younger than `freshMs` is kept without any network, unless `force`.
 * - On success the copy is replaced and listeners hear it. On null (the fetch failed) the old copy stays.
 * Resolves to the data now held, or null when there is none.
 */
export function revalidate<T>(
  key: string,
  fetcher: () => Promise<T | null>,
  opts: { freshMs: number; force?: boolean }
): Promise<T | null> {
  const flying = flights.get(key) as Promise<T | null> | undefined;
  if (flying) return flying;
  const have = read<T>(key);
  if (!opts.force && have && Date.now() - have.at < opts.freshMs) return Promise.resolve(have.data);
  const p = (async () => {
    try {
      const fresh = await fetcher();
      if (fresh === null || fresh === undefined) return read<T>(key)?.data ?? null;
      write(key, fresh);
      return fresh;
    } catch {
      return read<T>(key)?.data ?? null;
    } finally {
      flights.delete(key);
    }
  })();
  flights.set(key, p);
  return p;
}

/** Today's date in Lagos (UTC+1 all year), "YYYY-MM-DD". Keys that expire with the day use it. */
export function lagosDate(now = Date.now()): string {
  return new Date(now + 3.6e6).toISOString().slice(0, 10);
}
