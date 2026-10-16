/**
 * Who a listener hears while staff are on the stage, and how loud. PURE (no imports), so it is checked alone
 * (scripts/crew-room/check-stage-mix.mjs).
 *
 *   stage speakers   full volume wherever they stand (0 when the listener muted the stage on their phone)
 *   mixed rooms      the people near me are still heard, but no louder than HUSH while the stage is live, so the stage leads
 *   stage rooms      nobody else is heard: a general voice channel with no crowd noise
 *
 * Stage speakers count first toward the cap of MAX_HEARD voices at once (the nearest people fill what is left).
 * `heard` is the proximity map (voice.ts whoHears), nearest first. `me` is never in the answer.
 */
export const HUSH = 0.5;
export const MAX_HEARD = 8;

export function stageMix(args: { stage: readonly string[]; heard: ReadonlyMap<string, number>; me: string; mode: "mixed" | "stage"; stageMuted: boolean }): Map<string, number> {
  const { stage, heard, me, mode, stageMuted } = args;
  const out = new Map<string, number>();
  const speakers = stage.filter((id) => id !== me);
  for (const id of speakers) {
    if (out.size >= MAX_HEARD) break;
    out.set(id, stageMuted ? 0 : 1);
  }
  if (mode === "stage") return out;
  const cap = speakers.length ? HUSH : 1;
  for (const [id, volume] of heard) {
    if (out.size >= MAX_HEARD) break;
    if (id === me || out.has(id)) continue;
    out.set(id, Math.min(volume, cap));
  }
  return out;
}
