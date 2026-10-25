"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

/**
 * The voice half of a Speed Meet chat: connect to the session's LiveKit room, show the countdown, mute and hang up.
 * `onEnd` fires once, when time runs out or someone hangs up, with the reason.
 */
export default function Call({
  sessionId,
  peerName,
  secondsLeft,
  onEnd,
}: {
  sessionId: string;
  peerName: string;
  secondsLeft: number;
  onEnd: (why: "time" | "hangup" | "error") => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const roomRef = useRef<import("livekit-client").Room | null>(null);
  const ended = useRef(false);
  const [left, setLeft] = useState(secondsLeft);
  const [muted, setMuted] = useState(false);
  const [state, setState] = useState<"connecting" | "live">("connecting");
  const [error, setError] = useState("");

  const finish = (why: "time" | "hangup" | "error") => {
    if (ended.current) return;
    ended.current = true;
    roomRef.current?.disconnect();
    roomRef.current = null;
    onEnd(why);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sb = getSupabase();
        const { data } = (await sb?.auth.getSession()) ?? { data: { session: null } };
        if (!data.session?.access_token) throw new Error("Sign in to use Speed Meet.");
        const res = await fetch("/api/meet/token", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
          body: JSON.stringify({ sessionId }),
        });
        const out = (await res.json()) as { token?: string; serverUrl?: string; error?: string };
        if (!res.ok || !out.token || !out.serverUrl) throw new Error(out.error ?? "Could not start the call.");
        const { Room, RoomEvent } = await import("livekit-client");
        if (cancelled) return;
        const room = new Room({ adaptiveStream: true });
        roomRef.current = room;
        room.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === "audio" && host.current) {
            const el = track.attach();
            el.autoplay = true;
            host.current.appendChild(el);
          }
        });
        room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()));
        room.on(RoomEvent.Disconnected, () => finishRef.current("hangup"));
        await room.connect(out.serverUrl, out.token);
        await room.localParticipant.setMicrophoneEnabled(true);
        if (!cancelled) setState("live");
      } catch (e) {
        if (cancelled) return;
        const denied = e instanceof Error && /permission|denied|notallowed/i.test(`${e.name} ${e.message}`);
        setError(denied ? "Allow the microphone to talk." : e instanceof Error ? e.message : "Could not start the call.");
        finishRef.current("error");
      }
    })();
    return () => {
      cancelled = true;
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    const t = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (left === 0) finishRef.current("time");
  }, [left]);

  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <div className="card text-center">
      <div ref={host} className="sr-only" aria-hidden="true" />
      <p className="label">{state === "live" ? "TALKING TO" : "CONNECTING TO"}</p>
      <p className="font-display text-[26px] font-black leading-tight">{peerName}</p>
      <p className="my-4 font-mono text-[40px] tracking-wider" aria-live="off">{clock}</p>
      {error && <p role="alert" className="hint mb-3 text-keke">{error}</p>}
      <div className="flex gap-2">
        <button
          className="btn btn-ghost min-h-11 flex-1"
          onClick={() => {
            const next = !muted;
            setMuted(next);
            void roomRef.current?.localParticipant.setMicrophoneEnabled(!next);
          }}
          disabled={state !== "live"}
        >
          {muted ? "UNMUTE" : "MUTE"}
        </button>
        <button className="btn min-h-11 flex-1" onClick={() => finish("hangup")}>END</button>
      </div>
    </div>
  );
}
