import type { PopAudience, Visibility } from "./types";

/**
 * May a Pop also go to the host room's Announcements? Never for an invite only event (the address and codes stay with
 * the guests). On a community event only when it is for those going or for everyone.
 */
export function roomCopyAllowed(visibility: Visibility, audience: PopAudience): boolean {
  if (visibility === "invite") return false;
  return visibility !== "community" || audience === "going" || audience === "everyone";
}
