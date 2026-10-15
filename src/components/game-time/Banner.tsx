"use client";

import { useEffect, useState } from "react";
import { clockText, useServerNow } from "@/lib/game-time/clock";
import { openTicket } from "@/lib/game-time/controller";
import { useGameTime } from "@/lib/game-time/store";
import type { GtGame, GtOverReason } from "@/lib/game-time/types";
import css from "./GameTime.module.css";

/**
 * The Game Time banner, top left of the world (design 13.1 and 13.2): what is on, how long, how many boxes are left.
 * It is the only permanent Game Time furniture; everything else appears for a moment. Countdowns come from the server's
 * clock. The end state shows for 10 seconds and folds away.
 */

const OVER_WORD: Record<GtOverReason, string> = { all_found: "ALL FOUND", time_up: "TIME UP", closed: "CLOSED" };
const SOON_MS = 10 * 60_000;
const OVER_MS = 10_000;

function Pips({ total, left, text }: { total: number; left: number; text: string }) {
  if (total > 10) return <div className={css.pips}><span className={css.pipText} style={{ marginLeft: 0 }}>{text}</span></div>;
  return (
    <div className={css.pips} aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={`${css.pip} ${i < left ? "" : css.pipOff}`} />
      ))}
      <span className={css.pipText}>{text}</span>
    </div>
  );
}

const leftText = (g: GtGame) => (g.boxes_total > 10 ? `${g.boxes_left} / ${g.boxes_total} LEFT` : `${g.boxes_left} LEFT`);

/** What a screen reader hears, and only when it changes: no countdown, which would be read out every second. */
function Announce({ game, won }: { game: GtGame | null; won: boolean }) {
  if (!game) return null;
  const text =
    game.status === "over"
      ? `Game Time is over. ${OVER_WORD[game.over_reason ?? "closed"].toLowerCase()}.`
      : game.status === "upcoming"
        ? "Game Time is coming up."
        : won
          ? `You got a ticket. ${game.boxes_left} left.`
          : `Game Time is live. ${game.boxes_left} of ${game.boxes_total} boxes left.`;
  return (
    <span className="sr-only" role="status" aria-live="polite">
      {text}
    </span>
  );
}

function BannerBody({ isWatcher }: { isWatcher: boolean }) {
  const game = useGameTime((s) => s.game);
  const me = useGameTime((s) => s.me);
  const offline = useGameTime((s) => s.offline);
  const now = useServerNow(500);

  // The end state folds away 10 seconds after it first shows, once per game.
  const [folded, setFolded] = useState<string | null>(null);
  const overId = game?.status === "over" ? game.id : null;
  useEffect(() => {
    if (!overId) return;
    const t = setTimeout(() => setFolded(overId), OVER_MS);
    return () => clearTimeout(t);
  }, [overId]);

  if (!game || !me.member) {
    // A guest or a non-member cannot be inside the room, but a stale answer must not paint a banner for them.
    return null;
  }
  if (game.status === "over" && folded === game.id) return null;

  const total = game.boxes_total;
  const closeIn = Date.parse(game.closes_at) - now;
  const openIn = Date.parse(game.opens_at) - now;

  if (!game.room_ok) {
    return (
      <div className={css.banner} data-gt-banner="paused">
        <span className={css.label}>
          <i className={`${css.dotLive} ${css.dotOff}`} />
          GAME TIME
        </span>
        <b className={css.title} style={{ gridColumn: "1 / -1" }}>GAME TIME PAUSED</b>
      </div>
    );
  }

  if (game.status === "upcoming") {
    const soon = openIn <= SOON_MS;
    const cls = openIn <= 10_000 ? css.hurry : openIn <= 60_000 ? css.warn : "";
    return (
      <div className={css.banner} data-gt-banner="upcoming" data-soon={soon || undefined}>
        <span className={css.label}>
          <i className={`${css.dotLive} ${soon ? css.dotSoon : css.dotOff}`} />
          {soon ? "STARTING SOON" : "GAME TIME"}
        </span>
        <span className={css.count}>
          <span className={css.countKicker}>OPENS IN</span>
          <span className={cls}>{clockText(openIn)}</span>
        </span>
        <b className={css.title}>{game.title}</b>
      </div>
    );
  }

  if (game.status === "over") {
    const found = total - game.boxes_left;
    return (
      <div className={css.banner} data-gt-banner="over">
        <span className={css.label}>
          <i className={`${css.dotLive} ${css.dotOff}`} />
          GAME TIME
        </span>
        <span className={`${css.count} ${css.countSmall}`}>{OVER_WORD[game.over_reason ?? "closed"]}</span>
        <b className={css.title}>{game.title}</b>
        <Pips total={total} left={game.boxes_left} text={`${found} FOUND`} />
      </div>
    );
  }

  // Live.
  const cls = closeIn <= 10_000 ? css.hurry : closeIn <= 60_000 ? css.warn : "";
  const count = <span className={`${css.count} ${cls}`}>{clockText(closeIn)}</span>;

  if (isWatcher) {
    return (
      <div className={css.banner} data-gt-banner="watching" data-muted>
        <span className={css.label}>
          <i className={css.dotLive} />
          GAME TIME
        </span>
        {count}
        <b className={css.title}>WATCHING. WALK IN TO HUNT.</b>
        <Pips total={total} left={game.boxes_left} text={leftText(game)} />
      </div>
    );
  }

  if (me.won) {
    const content = (
      <>
        <span className={css.label}>
          <i className={css.dotLive} />
          GAME TIME
        </span>
        {count}
        <b className={css.title}>YOU GOT IT. WATCH THE REST.</b>
        <Pips total={total} left={game.boxes_left} text={me.code ? `${leftText(game)} · MY TICKET` : leftText(game)} />
      </>
    );
    return me.code ? (
      <button type="button" className={css.banner} data-gt-banner="won" data-muted onClick={openTicket} aria-label="You got a ticket. Show it.">
        {content}
      </button>
    ) : (
      <div className={css.banner} data-gt-banner="won" data-muted>
        {content}
      </div>
    );
  }

  return (
    <div className={css.banner} data-gt-banner="live" aria-label={`Game Time, ${game.title}, ${game.boxes_left} boxes left`}>
      <span className={css.label}>
        <i className={`${css.dotLive} ${offline ? css.dotOff : ""}`} />
        GAME TIME
      </span>
      {count}
      <b className={css.title}>{game.title}</b>
      <Pips total={total} left={game.boxes_left} text={leftText(game)} />
    </div>
  );
}

export default function Banner({ isWatcher }: { isWatcher: boolean }) {
  const game = useGameTime((s) => s.game);
  const won = useGameTime((s) => s.me.won);
  const member = useGameTime((s) => s.me.member);
  return (
    <>
      <Announce game={member ? game : null} won={won} />
      <BannerBody isWatcher={isWatcher} />
    </>
  );
}
