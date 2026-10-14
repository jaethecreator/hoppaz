"use client";

import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { music } from "@/lib/sound/music";
import { sfx } from "@/lib/sound/sfx";
import css from "./Campaign.module.css";

/**
 * The room music is the app's music (lib/sound/music.ts, played by <MusicHost />): the owner's own loop when they set
 * one, otherwise the room theme. It starts on the first tap in the room, never by itself. This is the same Music
 * switch as Me, Settings, put where you hear it.
 */
export function MusicSwitch() {
  const on = useSyncExternalStore(music.subscribe, music.isOn, () => true);
  const muted = useSyncExternalStore(sfx.subscribe, sfx.isMuted, () => false);
  const Icon = on && !muted ? Volume2 : VolumeX;
  return (
    <button
      type="button"
      className={css.musicSwitch}
      aria-pressed={on}
      onClick={() => music.setOn(!on)}
      title={muted ? "Sound is off in Me, Settings" : undefined}
    >
      <Icon size={13} aria-hidden />
      {on ? (muted ? "Music on, Sound off" : "Music on") : "Music off"}
    </button>
  );
}

/** The Listening Studio's line about what the room is playing, with the switch. */
export default function RoomMusic({ audio, title }: { audio: string | null; title: string }) {
  const failed = useSyncExternalStore(music.subscribe, () => !!audio && music.failed(audio), () => false);
  return (
    <div className={css.roomMusic}>
      <p>
        {failed
          ? "This room's own track can't play on this phone, so the room plays its theme instead."
          : audio
            ? `The room plays ${title || "its own track"} on a loop.`
            : "The room plays the Hoppaz room theme on a loop."}{" "}
        It starts on your first tap.
      </p>
      <MusicSwitch />
    </div>
  );
}
