"use client";

import { useEffect, useState } from "react";
import { CLAIMS_KEY, eventClaimsOn } from "@/lib/events-r1/flags";

/**
 * Is "claim an event" on right now (the event_claims flag)? Read after mount (the demo switch lives in localStorage, so the server render
 * is always Off) and again when the switch changes in another tab.
 */
export function useClaimsOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn(eventClaimsOn());
    read();
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === CLAIMS_KEY) read();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return on;
}
