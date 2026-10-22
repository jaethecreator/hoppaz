import { isTestHost } from "@/lib/testHost";
import { BUS_INTRO_ENABLED } from "./flags";

/**
 * Who gets the city title sequence (src/components/TitleSequence.tsx): someone opening Hoppaz for the first time on this device,
 * once. It plays on the map, before the first run's cards (which wait while it is on the screen: it is a dialog).
 *
 * "First time on this device" is the absence of every sign that this phone has used Hoppaz: the title's own mark, a first run
 * that has got past its first card, the location answer, and a saved location or avatar in the settings. A link to one thing (an
 * event, a hotspot, a room, a day) is not met with the title, and it is marked seen so it does not turn up later: the same people
 * the first run leaves alone. Skipping it, finishing it or leaving the app mid-way all count as seen: the mark is written when it
 * starts.
 *
 * What the device looked like is read once, when this module first loads on the phone (before any effect has run), because the
 * first run starts writing its own step as soon as the app is up.
 */
export const BUS_INTRO_KEY = "hz-bus-intro-v1";

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

function usedBefore(): boolean {
  if (read(BUS_INTRO_KEY) || read("hoppaz.locationAsk")) return true;
  // The first run saves "location" for everyone at the start; any later step means they went on from the first card.
  const first = read("hz-first-v2");
  if (first && first !== "location") return true;
  try {
    const raw = JSON.parse(read("hoppaz.v1") ?? "null") as { state?: { fix?: unknown; look?: unknown; seenTitle?: boolean; seenIntro?: boolean } } | null;
    const st = raw?.state;
    return !!(st && (st.fix || st.look || st.seenTitle || st.seenIntro));
  } catch {
    return false;
  }
}

function landedOnLink(): boolean {
  const q = new URLSearchParams(window.location.search);
  const p = window.location.pathname;
  return q.has("e") || q.has("hotspot") || q.has("date") || p.startsWith("/room/") || p.startsWith("/event/");
}

const ON_PHONE = typeof window !== "undefined";
const WAS_USED = ON_PHONE ? usedBefore() : true;
const VIA_LINK = ON_PHONE ? landedOnLink() : false;

function markSeen() {
  try {
    localStorage.setItem(BUS_INTRO_KEY, "1");
  } catch {
    /* private window: this visit only (the claim below remembers it), it may play again next visit */
  }
}

/** Private windows cannot save, so the answer is also kept for this visit. null: not asked yet. */
let decision: boolean | null = null;
let claimedAt = 0;
/** React's strict mode runs an effect twice, a moment apart: the second ask inside this window gets the same yes. */
const SAME_BREATH_MS = 500;

/**
 * Ask once the map page has mounted. True means play the title now: the mark is already written, so a reload or a tab switch
 * never brings it back. On a test host, /?bus-intro plays it again.
 */
export function claimBusIntro(): boolean {
  if (!ON_PHONE || !BUS_INTRO_ENABLED) return false;
  if (decision === null) {
    if (isTestHost() && new URLSearchParams(window.location.search).has("bus-intro")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("bus-intro");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      decision = true;
    } else if (WAS_USED) {
      decision = false;
    } else if (VIA_LINK) {
      markSeen();
      decision = false;
    } else {
      decision = true;
    }
    if (decision) {
      markSeen();
      claimedAt = Date.now();
    }
    return decision;
  }
  return decision && Date.now() - claimedAt < SAME_BREATH_MS;
}

/** This device has not seen the title and is about to (or on its next map visit). The short opening stays out of its way. */
export function busIntroPending(): boolean {
  if (!ON_PHONE || !BUS_INTRO_ENABLED) return false;
  if (decision !== null) return decision;
  return !WAS_USED && !VIA_LINK;
}
