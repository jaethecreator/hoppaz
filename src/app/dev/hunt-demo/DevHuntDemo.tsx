"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import CampaignWorld, { type OpenPhase } from "@/components/campaign/CampaignWorld";
import ActionButton from "@/components/crew-room/ActionButton";
import { ChatButton } from "@/components/crew-room/Hud";
import { ChromeBody } from "@/components/game-time/GameTimeChrome";
import { HUNT_DEMO_ON, forgetDemo } from "@/lib/game-time/huntDemo";
import { NO_ME, useGameTime } from "@/lib/game-time/store";
import type { GtGame } from "@/lib/game-time/types";
import { CLUBHOUSE, type CampaignLayout } from "@/lib/campaign/layout";
import { EVENT_ROOMS } from "@/lib/campaign/templates";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import type { SocialWorld } from "@/lib/crew-room/types";
import { DEFAULT_LOOK, normalizeLook } from "@/lib/avatar";
import { useSession } from "@/lib/useSession";
import { useDemoPeers } from "../room-templates/DevRoomTemplates";
import css from "@/components/campaign/Campaign.module.css";

type Entry = { key: string; name: string; layout: CampaignLayout };
const ENTRIES: Entry[] = [{ key: "clubhouse", name: "Clubhouse", layout: CLUBHOUSE }, ...EVENT_ROOMS.map((r) => ({ key: r.key, name: r.name, layout: r.layout }))];

type Mode = "upcoming" | "live" | "mystery";

/** A made-up Game Time for the banner and the practice to read. It lives in the phone's store only; nothing here calls the server. */
function fakeGame(mode: Mode, mins: number): GtGame {
  const now = Date.now();
  const live = mode === "live";
  const opens = live ? now - 90_000 : now + mins * 60_000;
  return {
    id: "dev-hunt-demo",
    crew_id: "dev",
    crew_name: "360Playlist",
    brand: "360Playlist",
    title: "Dave's concert",
    drop: mode === "mystery" ? { i: 2, n: 5 } : null,
    status: live ? "live" : "upcoming",
    over_reason: null,
    opens_at: new Date(opens).toISOString(),
    closes_at: new Date(opens + 60 * 60_000).toISOString(),
    ended_at: null,
    boxes_total: 3,
    boxes_left: 3,
    search_gap_ms: 3000,
    room_ok: true,
    join_in_time: true,
    // No hiding places are published here: the real shimmer and the real SEARCH stay out of the way of the practice.
    objects: [],
    feed_tail: 0,
    found: [],
  };
}

/**
 * DEV · HUNT DEMO. The Game Time practice hunt over a room template, with a made-up Game Time and no server (the real
 * controller never starts). Query: `room=<clubhouse|event-...>`, `mode=upcoming|live|mystery`, `mins=<minutes to the opening>`
 * (default 45), `keep=1` (keep what this phone remembers; by default it is forgotten, like a first-timer's phone),
 * `chrome=0` (hide the picker for clean phone screenshots), `peers=<n>`.
 */
export default function DevHuntDemo() {
  const { profile } = useSession();
  const [key, setKey] = useState(ENTRIES[0].key);
  const [mode, setMode] = useState<Mode>("upcoming");
  const [mins, setMins] = useState(45);
  const [peerCount, setPeerCount] = useState(5);
  const [keep, setKeep] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [run, setRun] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const q = new URLSearchParams(window.location.search);
    const room = q.get("room");
    if (room && ENTRIES.some((e) => e.key === room)) setKey(room);
    const m = q.get("mode");
    if (m === "live" || m === "mystery" || m === "upcoming") setMode(m);
    const n = Number(q.get("mins"));
    if (q.get("mins") !== null && Number.isFinite(n)) setMins(Math.max(0, Math.round(n)));
    const p = Number(q.get("peers"));
    if (q.get("peers") !== null && Number.isFinite(p)) setPeerCount(Math.max(0, Math.min(40, Math.round(p))));
    if (q.get("keep") === "1") setKeep(true);
    if (q.get("chrome") === "0") setChrome(false);
  }, []);

  /** The countdown reaches zero: the made-up hunt goes live, as it would at the opening (a running practice must end). */
  const goLive = () => {
    const st = useGameTime.getState();
    if (!st.game) return;
    st.patch({ game: { ...st.game, status: "live", opens_at: new Date(Date.now() - 1000).toISOString() }, me: { ...st.me, can_search: true } });
  };

  const entry = ENTRIES.find((e) => e.key === key) ?? ENTRIES[0];
  const avatar = profile?.avatar;
  const look = useMemo(() => (avatar ? normalizeLook(avatar) : DEFAULT_LOOK), [avatar]);

  return (
    <div className="absolute inset-0 flex flex-col bg-[#101214] text-[#F5EBDD]">
      {chrome && (
        <div className="flex-none border-b border-white/10 px-2 pb-2 pt-[max(8px,env(safe-area-inset-top))]">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] tracking-[0.08em] text-[#FF4D00]">DEV · HUNT DEMO</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-white/60">{HUNT_DEMO_ON ? "flag on" : "NEXT_PUBLIC_HUNT_DEMO is off: nothing will play"}</span>
            <button type="button" onClick={goLive} data-dev-go-live className="rounded border border-white/20 px-2 py-1 font-mono text-[10px]" aria-label="Open the made-up hunt now, as the countdown would">
              GO LIVE
            </button>
            <button type="button" onClick={() => setRun((n) => n + 1)} className="rounded border border-white/20 px-2 py-1 font-mono text-[10px]">
              RESTART
            </button>
          </div>
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
            {(["upcoming", "live", "mystery"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={`flex-none rounded border px-2 py-1 font-mono text-[10px] ${m === mode ? "border-[#FF4D00] bg-[#FF4D00] text-[#0E0B0A]" : "border-white/20 text-white/80"}`}>
                {m.toUpperCase()}
              </button>
            ))}
            {ENTRIES.map((e) => (
              <button key={e.key} type="button" onClick={() => setKey(e.key)} className={`flex-none rounded border px-2 py-1 font-mono text-[10px] ${e.key === key ? "border-[#FF4D00] bg-[#FF4D00] text-[#0E0B0A]" : "border-white/20 text-white/80"}`}>
                {e.name.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden" style={{ isolation: "isolate" }}>
        {mounted && <Room key={`${entry.key}:${mode}:${mins}:${run}`} entry={entry} mode={mode} mins={mins} peers={peerCount} look={look} keep={keep} />}
      </div>
    </div>
  );
}

function Room({ entry, mode, mins, peers: peerCount, look, keep }: { entry: Entry; mode: Mode; mins: number; peers: number; look: unknown; keep: boolean }) {
  const layout = entry.layout;
  const { peers, observedAt } = useDemoPeers(layout, peerCount, false);
  const reset = useMemo(() => ({ x: layout.spawn.x, y: layout.spawn.y, revision: 0 }), [layout]);
  const social: SocialWorld = useMemo(
    () => ({ peers, circles: [], selfId: "me", circleId: null, areaId: null, watching: false, observedAt, reset, onStep: () => true }),
    [peers, observedAt, reset],
  );
  const [phase, setPhase] = useState<OpenPhase | "init">("init");
  const hasAction = useRoomStore((s) => !!s.action);

  // The made-up Game Time goes into the store before anything reads it, and out again when the page goes.
  useEffect(() => {
    if (!keep) forgetDemo("dev-hunt-demo");
    useGameTime.getState().patch({
      ready: true,
      offline: false,
      game: fakeGame(mode, mins),
      me: { ...NO_ME, member: true, can_search: mode === "live" },
    });
    return () => useGameTime.getState().reset(null);
  }, [mode, mins, keep]);

  return (
    <div className={css.experience}>
      <header className={css.header}>
        <span className={css.back} aria-hidden>
          <ChevronLeft size={26} strokeWidth={2.2} />
        </span>
        <div className={css.titleBlock}>
          <div className={css.nameRow}>
            <h1>360Playlist</h1>
          </div>
          <p className={css.sub}>
            <i className={css.dot} aria-hidden />
            <span>{peerCount + 1} here</span>
          </p>
        </div>
        <span className={css.badge} aria-hidden>
          <span className={css.badgeFace}>
            <span className={css.badgeLetter}>3</span>
          </span>
        </span>
      </header>
      <div className={css.stage}>
        <CampaignWorld key={entry.key} layout={layout} look={look} brand={entry.key === "clubhouse" ? "360Playlist" : entry.name} social={social} placeId="dev-hunt-demo" onPhase={setPhase} />
        <ChatButton compact={hasAction} />
        <div className={css.chromeLayer}>
          <ActionButton crewId="dev" layout={layout} />
        </div>
        <div className={css.gameTimeChrome} data-game-time-layer="chrome">
          <ChromeBody layout={layout} isWatcher={false} ready={phase === "done"} />
        </div>
      </div>
    </div>
  );
}
