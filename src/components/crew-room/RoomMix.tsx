"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play } from "lucide-react";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import type { CampaignLayout } from "@/lib/campaign/layout";
import { music } from "@/lib/sound/music";
import { parseYouTube, type YouTubeMix } from "@/lib/sound/youtube";
import css from "./RoomMix.module.css";

/**
 * The room's DJ mix: a YouTube video or playlist the owner set, played for everyone in the room from the moment they are
 * inside. The player is tucked away (transparent, not clickable) and only a small DJ button shows. The sound comes from the
 * DJ booth: full volume beside it, fading to a bed at the far end of the room.
 * (YouTube's terms ask for a visible player; this room has chosen not to show it.)
 *
 * Everyone hears the same part of a single mix: the start point is the wall clock modulo the video's length, so a person
 * who walks in is dropped into the set where the room already is, like a radio. A playlist plays from its start.
 * The Music switch in Settings pauses it. A phone may refuse sound until a tap: then the card says so and one tap starts it.
 */

type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(volume: number): void;
  destroy(): void;
};
type YTApi = {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
};
declare global {
  interface Window {
    YT?: YTApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTApi> | null = null;
function loadApi(): Promise<YTApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTApi>((resolve, reject) => {
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      before?.();
      if (window.YT) resolve(window.YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    tag.onerror = () => {
      apiPromise = null;
      reject(new Error("youtube"));
    };
    document.head.appendChild(tag);
  });
  return apiPromise;
}

const useMusicOn = () =>
  useSyncExternalStore(
    (fn) => music.subscribe(fn),
    () => music.isOn(),
    () => true
  );

export default function RoomMix({ url, ready, layout }: { url: string; ready: boolean; layout: CampaignLayout }) {
  const mix: YouTubeMix | null = parseYouTube(url);
  const on = useMusicOn();
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const wantPlaying = useRef(false);
  const [state, setState] = useState<"loading" | "playing" | "paused" | "blocked" | "failed">("loading");
  const key = mix ? `${mix.video ?? ""}|${mix.list ?? ""}` : "";

  wantPlaying.current = on;

  // Louder near the DJ booth, quieter far from it.
  const me = useRoomStore((s) => s.me);
  const booth = layout.props.find((p) => p.id === "dj-booth");
  const volume = (() => {
    if (!me || !booth) return 70;
    const dx = me.x - (booth.x + booth.w / 2);
    const dy = me.y - (booth.y + booth.h / 2);
    const d = Math.sqrt(dx * dx + dy * dy);
    return Math.round(Math.max(25, Math.min(85, 90 - d * 5)));
  })();
  useEffect(() => {
    player.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    if (!mix || !ready || !host.current) return;
    let dead = false;
    const slot = document.createElement("div");
    host.current.appendChild(slot);
    let blockedTimer: ReturnType<typeof setTimeout> | undefined;
    void loadApi()
      .then((YT) => {
        if (dead) return;
        const vars: Record<string, unknown> = { autoplay: 1, playsinline: 1, controls: 0, rel: 0, modestbranding: 1, disablekb: 1 };
        if (mix.list) Object.assign(vars, { listType: "playlist", list: mix.list, loop: 1 });
        else if (mix.video) Object.assign(vars, { loop: 1, playlist: mix.video });
        player.current = new YT.Player(slot, {
          width: 200,
          height: 200,
          videoId: mix.list ? undefined : (mix.video ?? undefined),
          playerVars: vars,
          events: {
            onReady: (e: { target: YTPlayer }) => {
              const p = e.target;
              p.setVolume(volume);
              // A single mix: join the set where the room is (wall clock modulo its length).
              const len = !mix.list ? p.getDuration() : 0;
              if (len > 30) p.seekTo(Math.floor(Date.now() / 1000) % Math.floor(len), true);
              if (wantPlaying.current) {
                p.playVideo();
                blockedTimer = setTimeout(() => !dead && p.getPlayerState() !== YT.PlayerState.PLAYING && wantPlaying.current && setState("blocked"), 2500);
              } else setState("paused");
            },
            onStateChange: (e: { data: number }) => {
              if (e.data === YT.PlayerState.PLAYING) setState("playing");
              else if (e.data === YT.PlayerState.PAUSED) setState("paused");
              else if (e.data === YT.PlayerState.ENDED && !mix.list) {
                player.current?.seekTo(0, true);
                player.current?.playVideo();
              }
            },
            onAutoplayBlocked: () => !dead && setState("blocked"),
            onError: () => !dead && setState("failed"),
          },
        });
      })
      .catch(() => !dead && setState("failed"));
    return () => {
      dead = true;
      if (blockedTimer) clearTimeout(blockedTimer);
      try {
        player.current?.destroy();
      } catch {
        /* the frame is already gone */
      }
      player.current = null;
      slot.remove();
      setState("loading");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the mix is identified by `key`
  }, [key, ready]);

  // The Music switch: off pauses the mix, on plays it again.
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    if (on) p.playVideo();
    else p.pauseVideo();
  }, [on]);

  if (!mix || state === "failed") return null;
  const tap = () => {
    const p = player.current;
    if (!p) return;
    if (state === "playing") p.pauseVideo();
    else p.playVideo();
  };
  return (
    <div className={css.card} data-room-mix>
      <div ref={host} className={css.frame} aria-hidden />
      <button type="button" className={css.bar} onClick={tap} disabled={state === "loading"}>
        {state === "playing" ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
        <span>{state === "blocked" ? "TAP TO HEAR THE MIX" : state === "playing" ? "MIX PLAYING" : state === "loading" ? "LOADING MIX" : "PLAY THE MIX"}</span>
      </button>
    </div>
  );
}
