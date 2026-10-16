import type { ReactNode } from "react";
import type { Spawner } from "@/components/admin/SpawnerSection";
import type { HotspotsAdmin } from "@/app/api/admin/game/hotspots";

/**
 * The small pieces the desk's section files share: the data the desk loads from /api/admin/game (Queue), the POST helper
 * every section gets (Act), and the card, row and heading the sections are drawn with. They lived in the old admin page;
 * they moved here so each section can be its own file.
 */

/** GET /api/admin/game: everything the old desk's cards read. */
export type Queue = {
  events: { id: string; title: string; venue_name: string; area: string | null; starts_at: string; ig_url: string | null }[];
  liveEvents: { id: string; title: string; venue_name: string; area: string | null }[];
  rules: { key: string; score: number }[];
  photos: { id: string; event_id: string; url: string | null; events: unknown }[];
  claims: { id: string; event_id: string | null; evidence: string | null; quests: unknown }[];
  reports: { id: string; kind: string; excerpt: string | null; reason: string; created_at: string }[];
  drops: { id: string; title: string; active: boolean; claimed_count: number; max_claims: number | null }[];
  partners: { id: string; name: string; active: boolean }[];
  spawner: Spawner;
  hotspots: HotspotsAdmin;
};

/** POST an action to /api/admin/game. Resolves the answer, or null after telling staff why not. It reloads the queue when it worked. */
export type Act = (body: Record<string, unknown>) => Promise<Record<string, unknown> | null>;

/** The top of a section: its name and one line on what it is for. */
export function SectionHead({ title, hint }: { title: string; hint: string }) {
  return (
    <header className="mb-4">
      <h1 className="font-display text-2xl font-black">{title}</h1>
      <p className="hint mt-1">{hint}</p>
    </header>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card mb-4 p-3">
      <h2 className="seclabel mb-3 text-orange">{title}</h2>
      {children}
    </section>
  );
}

export function Row({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-0">
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-bold">{title}</p>
        <p className="hint truncate">{sub}</p>
      </div>
      {children}
    </div>
  );
}
