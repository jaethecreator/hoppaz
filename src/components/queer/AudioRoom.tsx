"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

export default function AudioRoom({ roomId }: { roomId: string }) {
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(true);
  const [people, setPeople] = useState(0);
  const [error, setError] = useState("");
  const audioHost = useRef<HTMLDivElement>(null);
  const roomRef = useRef<import("livekit-client").Room | null>(null);

  useEffect(() => () => {
    roomRef.current?.disconnect();
    roomRef.current = null;
  }, []);

  const join = async () => {
    setBusy(true);
    setError("");
    try {
      const sb = getSupabase();
      const { data } = await sb?.auth.getSession() ?? { data: { session: null } };
      if (!data.session?.access_token) throw new Error("Sign in to join this room.");
      const response = await fetch("/api/queer/rooms/token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ roomId }),
      });
      const payload = await response.json() as { token?: string; serverUrl?: string; error?: string };
      if (!response.ok || !payload.token || !payload.serverUrl) throw new Error(payload.error ?? "Could not join the room.");

      const { Room, RoomEvent } = await import("livekit-client");
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      const attach = (track: import("livekit-client").Track) => {
        if (track.kind !== "audio" || !audioHost.current) return;
        const audio = track.attach();
        audio.autoplay = true;
        audioHost.current.appendChild(audio);
      };
      const detach = (track: import("livekit-client").Track) => track.detach().forEach((element) => element.remove());
      room.on(RoomEvent.TrackSubscribed, (track) => attach(track));
      room.on(RoomEvent.TrackUnsubscribed, (track) => detach(track));
      room.on(RoomEvent.ParticipantConnected, () => setPeople(room.numParticipants));
      room.on(RoomEvent.ParticipantDisconnected, () => setPeople(room.numParticipants));
      room.on(RoomEvent.Disconnected, () => {
        setJoined(false);
        setPeople(0);
        roomRef.current = null;
      });
      await room.connect(payload.serverUrl, payload.token);
      await room.localParticipant.setMicrophoneEnabled(false);
      room.remoteParticipants.forEach((participant) => participant.trackPublications.forEach((publication) => {
        if (publication.track) attach(publication.track);
      }));
      setPeople(room.numParticipants);
      setJoined(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join the room.");
      roomRef.current?.disconnect();
      roomRef.current = null;
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = async () => {
    const nextMuted = !muted;
    await roomRef.current?.localParticipant.setMicrophoneEnabled(!nextMuted);
    setMuted(nextMuted);
  };

  const leave = () => {
    roomRef.current?.disconnect();
    roomRef.current = null;
    setJoined(false);
    setPeople(0);
  };

  return <div className="mt-3">
    <div ref={audioHost} className="sr-only" aria-hidden="true" />
    {!joined ? (
      <button className="btn min-h-11 w-full" onClick={() => void join()} disabled={busy}>
        {busy ? "CONNECTING…" : "JOIN LIVE AUDIO"}
      </button>
    ) : (
      <div className="flex items-center gap-2">
        <span className="hint flex-1">LIVE · {people} {people === 1 ? "person" : "people"}</span>
        <button className="btn btn-ghost min-h-11 px-3" onClick={() => void toggleMic()}>{muted ? "UNMUTE" : "MUTE"}</button>
        <button className="btn min-h-11 px-3" onClick={leave}>LEAVE</button>
      </div>
    )}
    {error && <p role="alert" className="hint mt-2 text-keke">{error}</p>}
  </div>;
}
