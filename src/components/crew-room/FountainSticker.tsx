"use client";

import { useCallback, useMemo, useState } from "react";
import type { CampaignLayout } from "@/lib/campaign/layout";
import { deviceTier } from "@/lib/deviceTier";
import { STICKER, ribbonFont, useEventSheet, useFeatured, usePlaceAction } from "@/lib/crew-room/featured";
import { useLiveStore } from "@/lib/crew-room/voice";
import { sfx } from "@/lib/sound/sfx";
import css from "./Places.module.css";

/**
 * The featured event's flyer over the courtyard fountain, with the owner's ribbon (design section 11). Non solid, under
 * avatars (z-index 1; the walkers are 2). The fountain keeps blocking underneath: this changes no walkable tile.
 *
 * WORLD LAYER, owned by PLACES. Mounted by CampaignWorld inside the world container (the scaled `.world` div), so
 * children are positioned in world pixels: a tile (x, y) sits at left x * tile, top y * tile, tile = layout.grid.tile
 * (also useRoomStore().tile). The wrapper is click-through; the sticker opts in to pointer events itself.
 *
 *   tap the sticker   opens the event sheet (EventSheet.tsx). No walking needed: it only informs.
 *   stand by the fountain   registers the pill "SEE THE DAVE NIGHT" (roomStore action id "fountain-event", priority 50)
 *   the stage lights  while the crew owner is live (voice.ts), four soft cream cones over the 360 Stage
 *
 * The tap stops the pointer event here, so the world does not also walk to it. No featured event, or the event has
 * ended: nothing is drawn and no pill is registered.
 */
export type FountainStickerProps = { crewId: string; layout: CampaignLayout };

/** The sticker's pill: within 2 tiles of the fountain, gone past 3. */
const ENTER = 2;
const LEAVE = 3;

export default function FountainSticker({ crewId, layout }: FountainStickerProps) {
  const { featured } = useFeatured(crewId);
  const show = useEventSheet((s) => s.show);
  const fountain = layout.props.find((p) => p.kind === "fountain");
  const block = useMemo(() => (fountain ? { x: fountain.x, y: fountain.y, w: fountain.w, h: fountain.h } : null), [fountain?.x, fountain?.y, fountain?.w, fountain?.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = useCallback(() => {
    sfx.swish();
    show();
  }, [show]);

  usePlaceAction({ id: "fountain-event", label: featured && block ? featured.pill : null, priority: 50, block, enter: ENTER, leave: LEAVE, onPress: open });

  return (
    <>
      {featured && fountain && <Sticker featured={featured} fountain={fountain} tile={layout.grid.tile} onOpen={open} />}
      <StageLights layout={layout} />
    </>
  );
}

function Sticker({ featured, fountain, tile, onOpen }: { featured: NonNullable<ReturnType<typeof useFeatured>["featured"]>; fountain: { x: number; y: number; w: number; h: number }; tile: number; onOpen: () => void }) {
  // Height follows the flyer, between square and 1.38 times the width (112 to 155 px): until it loads, 4:5.
  const [ratio, setRatio] = useState(1.25);
  const [broken, setBroken] = useState(false);
  const calm = useMemo(() => deviceTier() === "low", []);
  const width = STICKER.tiles * tile;
  const height = Math.round(width * ratio);
  const cx = (fountain.x + fountain.w / 2) * tile;
  const cy = (fountain.y + fountain.h / 2) * tile;
  const font = featured.ribbon ? ribbonFont(featured.ribbon, width + STICKER.ribbonOverhang * 2) : 11;
  const label = `${featured.title}, ${featured.day}${featured.ribbon ? `, ${featured.ribbon}` : ""}. Open the night.`;

  return (
    <button
      type="button"
      className={`${css.sticker} ${calm ? css.calm : ""}`}
      data-room-object="fountain-sticker"
      data-featured={featured.id}
      aria-label={label}
      style={{ left: cx - width / 2, top: cy - height / 2, width, height }}
      // The world walks on a tap anywhere else; a tap on the sticker is for the sticker.
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <span className={css.bob} style={{ display: "block" }}>
        <span className={css.card} style={{ display: "block" }}>
          {featured.flyerUrl && !broken ? (
            // eslint-disable-next-line @next/next/no-img-element -- an event flyer, uploaded by its organiser
            <img
              className={css.flyer}
              src={featured.flyerUrl}
              alt=""
              width={Math.round(width)}
              height={height}
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={(e) => {
                const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                if (w && h) setRatio(Math.min(1.38, Math.max(1, h / w)));
              }}
              onError={() => setBroken(true)}
            />
          ) : (
            <span className={css.fallback}>{featured.title}</span>
          )}
        </span>
        {featured.ribbon && (
          <span className={css.ribbon} style={{ fontSize: font }} data-ribbon>
            {featured.ribbon}
          </span>
        )}
      </span>
    </button>
  );
}

/** Four soft cones from the lamps over the stage console while the crew owner is live to the room. Under avatars. */
function StageLights({ layout }: { layout: CampaignLayout }) {
  const live = useLiveStore((s) => s.liveBy);
  const stage = layout.zones.find((z) => z.id === "stage");
  if (!live || !stage) return null;
  const tile = layout.grid.tile;
  // The lamps sit at x 359, 398, 560 and 599 in the 30 wide room, where the stage starts at tile 10.
  const shift = (stage.x - 10) * tile;
  const top = (stage.y + 1) * tile;
  const height = Math.max(tile * 4, (stage.h - 1) * tile);
  return (
    <>
      {[359, 398, 560, 599].map((x) => (
        <span key={x} className={css.cone} aria-hidden style={{ left: x + shift - 30, top, width: 60, height }} />
      ))}
    </>
  );
}
