"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Block, EmptyCard, LiveDropCard, PastDropCard, UpcomingDrops } from "./DropCards";
import { isOver, plural } from "./format";
import type { GameTimeDeskApi } from "./types";

export type DropsSectionProps = {
  gt: GameTimeDeskApi;
  /** Open a crew's room in the Rooms section (and its add-a-drop button). */
  onOpenRoom: (crewId: string) => void;
};

const PAST_STEP = 10;

/**
 * Every Game Time drop in every room: what is live, what is coming up and every past drop on its own card. Drops are added
 * from a room, so this view only reads, closes, starts and edits. The shell gives it a container that scrolls.
 */
export default function DropsSection({ gt, onOpenRoom }: DropsSectionProps) {
  const [pastShown, setPastShown] = useState(PAST_STEP);
  const games = gt.desk?.games;

  if (!games) {
    return gt.error ? (
      <div className="mx-auto w-full max-w-[900px] px-4 py-5 lg:px-6">
        <p className="text-[14px] text-fireant">{gt.error}</p>
        <button type="button" className="btn btn-ghost mt-3" onClick={() => void gt.load()}>
          TRY AGAIN
        </button>
      </div>
    ) : (
      <p className="mx-auto w-full max-w-[900px] px-4 py-5 text-[14px] text-dim lg:px-6">Loading drops…</p>
    );
  }

  const at = (g: { opens_at: string }) => Date.parse(g.opens_at);
  const live = games.filter((g) => g.phase === "live").sort((a, b) => at(a) - at(b));
  const upcoming = games.filter((g) => g.phase === "upcoming");
  const past = games.filter((g) => isOver(g.phase)).sort((a, b) => at(b) - at(a));

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-5 lg:px-6 lg:py-7" data-desk-drops>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-black">Drops</h2>
          <p className="hint mt-1">Every Game Time drop in every room. Add new drops from a room.</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => void gt.exportCsv(null, "game-time-winners.csv")}>
          <Download size={14} aria-hidden /> EXPORT ALL WINNERS
        </button>
      </header>

      {gt.error && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 flex-1 text-[13px] text-fireant">{gt.error}</p>
          <button type="button" className="btn btn-ghost min-h-[36px] px-3 py-1.5" onClick={() => void gt.load()}>
            TRY AGAIN
          </button>
        </div>
      )}

      <div className="mt-7 space-y-7">
        <Block title="Live now">
          {live.length ? (
            <div className="grid gap-3">
              {live.map((g) => (
                <LiveDropCard key={g.id} game={g} gt={gt} showCrew onOpenRoom={onOpenRoom} />
              ))}
            </div>
          ) : (
            <EmptyCard>Nothing live.</EmptyCard>
          )}
        </Block>

        <Block title="Coming up" note={upcoming.length ? plural(upcoming.length, "drop") : undefined}>
          {upcoming.length ? <UpcomingDrops games={upcoming} gt={gt} showCrew /> : <EmptyCard>Nothing planned.</EmptyCard>}
        </Block>

        <Block title="Past drops" note="Each drop on its own card">
          {past.length ? (
            <div className="grid gap-3">
              {past.slice(0, pastShown).map((g) => (
                <PastDropCard key={g.id} game={g} gt={gt} showCrew />
              ))}
              {past.length > pastShown && (
                <button type="button" className="btn btn-ghost" onClick={() => setPastShown((n) => n + PAST_STEP)}>
                  SHOW MORE ({past.length - pastShown})
                </button>
              )}
            </div>
          ) : (
            <EmptyCard>No past drops yet.</EmptyCard>
          )}
        </Block>
      </div>
    </div>
  );
}
