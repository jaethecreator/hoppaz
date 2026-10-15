"use client";

import { useRouter } from "next/navigation";
import { Compass } from "lucide-react";
import { RowButton } from "@/components/me/Rows";
import { INTRO_ENABLED } from "@/lib/intro/flag";
import { introReplay } from "@/lib/intro/store";
import { REPLAY_ROW } from "@/lib/intro/lines";

/**
 * "Replay the tour" for Me. Starts Paz's tour again from the top, then sends
 * the Hopper to the map, where it begins. Drop it into a RowGroup.
 * It draws nothing while the intro is switched off (src/lib/intro/flag.ts).
 */
export default function ReplayTourRow({ onStart }: { onStart?: () => void }) {
  const router = useRouter();
  if (!INTRO_ENABLED) return null;
  return (
    <RowButton
      icon={Compass}
      title={REPLAY_ROW.title}
      hint={REPLAY_ROW.hint}
      onClick={() => {
        introReplay();
        onStart?.();
        router.push("/"); // the tour starts on the map
      }}
    />
  );
}
