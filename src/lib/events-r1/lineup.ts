/** The lineup or programme of an event: rows of an optional time and a name. The host picks the heading. */
export type LineupKind = "lineup" | "programme";
export type LineupRow = { time?: string; name: string; note?: string };
export type Lineup = { kind: LineupKind; rows: LineupRow[] };

export const LINEUP_MAX = 30;
export const EMPTY_LINEUP: Lineup = { kind: "lineup", rows: [] };
/** The card title and the event page heading. */
export const LINEUP_TITLE: Record<LineupKind, string> = { lineup: "Lineup", programme: "Programme" };

/**
 * What gets saved: trimmed, rows with no name dropped (a half typed row stays on the host's screen only), at most 30 rows.
 * The same rules are in supabase/events_r1_lineup.sql, so the database never holds anything this would not.
 */
export function cleanLineup(l: Partial<Lineup> | null | undefined): Lineup {
  const kind: LineupKind = l?.kind === "programme" ? "programme" : "lineup";
  const rows: LineupRow[] = [];
  for (const r of l?.rows ?? []) {
    const name = String(r?.name ?? "").trim().slice(0, 80);
    if (!name) continue;
    const time = String(r?.time ?? "").trim().slice(0, 20);
    const note = String(r?.note ?? "").trim().slice(0, 200);
    rows.push({ ...(time ? { time } : {}), name, ...(note ? { note } : {}) });
    if (rows.length >= LINEUP_MAX) break;
  }
  return { kind, rows };
}
