"use client";

import { useEffect, useRef } from "react";
import { haptics } from "@/lib/haptics";
import { sfx } from "@/lib/sound/sfx";
import { useServerNow } from "@/lib/game-time/clock";
import { announceGo } from "@/lib/game-time/controller";
import { isMystery } from "@/lib/game-time/drops";
import { useGameTime } from "@/lib/game-time/store";
import css from "./GameTime.module.css";

/**
 * The last ten seconds before it opens (design 13.7), for whoever is in the room: the world dims, big numbers stamp
 * 10 to 1, the last three go red, then GO! with the horn and every star popping once. SEARCH works from that frame because
 * the controller asks the server at opens_at minus half a second and again just after. Worked out from the server's clock.
 * Drop 2 onward of a mystery series (drops.ts) has no countdown: the world only dims for GO.
 */

const WINDOW_MS = 10_500;
const GO_MS = 800;

export default function Hype({ isWatcher }: { isWatcher: boolean }) {
  const game = useGameTime((s) => s.game);
  const member = useGameTime((s) => s.me.member);
  const idle = useServerNow(500);
  if (!game || isWatcher || !member || game.status === "over") return null;
  const ms = Date.parse(game.opens_at) - idle;
  // Upcoming and close, or just opened (GO still on screen).
  if (ms > WINDOW_MS || ms < -GO_MS - 600) return null;
  return <Run opensAt={Date.parse(game.opens_at)} mystery={isMystery(game)} />;
}

function Run({ opensAt, mystery }: { opensAt: number; mystery: boolean }) {
  const now = useServerNow(100);
  const ms = opensAt - now;
  const secs = Math.ceil(ms / 1000);
  const go = ms <= 0;
  const last = useRef<number | null>(null);
  const wentGo = useRef(false);

  useEffect(() => {
    if (go) {
      if (wentGo.current) return;
      wentGo.current = true;
      sfx.danfoHorn();
      haptics.buzz("levelUp");
      announceGo();
      return;
    }
    // Drop 2 onward: no ticking, the room only hears GO.
    if (mystery || secs > 10 || last.current === secs) return;
    last.current = secs;
    sfx.tick(10 - secs);
  }, [secs, go, mystery]);

  if (mystery && !go) return null;
  if (go && ms < -GO_MS) return null;
  if (!go && secs > 10) return null;
  return (
    <div className={css.hype} data-gt-hype aria-hidden>
      <span className={css.hypeLabel}>{go ? "SEARCH IS ON" : "GAME TIME STARTS IN"}</span>
      <span key={go ? "go" : secs} className={`${css.hypeNum} ${go ? css.hypeGo : secs <= 3 ? css.hypeRed : ""}`}>
        {go ? "GO!" : secs}
      </span>
    </div>
  );
}
