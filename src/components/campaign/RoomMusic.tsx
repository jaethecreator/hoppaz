"use client";

import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { music } from "@/lib/sound/music";
import { sfx } from "@/lib/sound/sfx";

/**
 * The room music is the app's music (lib/sound/music.ts, played by <MusicHost />): the owner's own loop when they set
 * one, otherwise the room theme, at the room's quiet level. It starts on the first tap in the room, never by itself.
 * This is the same Music switch as Me, Settings, put where you hear it, as one small icon in the HUD.
 */
export function useMusicSwitch(audio: string | null) {
  const on = useSyncExternalStore(music.subscribe, music.isOn, () => true);
  const muted = useSyncExternalStore(sfx.subscribe, sfx.isMuted, () => false);
  const failed = useSyncExternalStore(music.subscribe, () => !!audio && music.failed(audio), () => false);
  return {
    on,
    muted,
    failed,
    sounding: on && !muted,
    toggle: () => music.setOn(!on),
  };
}

/** The icon that matches the switch: a speaker with waves while it plays, a crossed one when it does not. */
export function MusicIcon({ sounding, size = 20 }: { sounding: boolean; size?: number }) {
  const Icon = sounding ? Volume2 : VolumeX;
  return <Icon size={size} aria-hidden />;
}
