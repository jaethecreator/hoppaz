"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { canWalkScene, scenePath, type CampaignLayout } from "@/lib/campaign/layout";
import { deviceTier } from "@/lib/deviceTier";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import { useGameTime } from "@/lib/game-time/store";
import { nearestSpot, spotRects, tilesFrom, type Rect, type SpotRect } from "@/lib/game-time/proximity";
import css from "./GameTime.module.css";

/**
 * The Game Time half that lives IN the world (design 13.3, 13.4, 13.5). Mounted inside the scaled world container, so a
 * child at `left: x * tile, top: y * tile` lines up with the art at every zoom. Click-through; nothing here takes a tap.
 *
 *   SHIMMER   every object that may hide a box (game.objects) twinkles: a gold four-point star with a halo at its top-right
 *             corner, brighter when I am near, a steady ring on the one I would search, and for the ten nearest a soft
 *             pulsing outline round the whole object. "Shimmers" means "can be searched", never "has a box". Only the ten
 *             nearest animate; the full view shows bigger pulsing dots. A tap on a star walks me next to the object (the
 *             fountain's sticker covers the tiles beside the fountain, so the floor cannot be tapped there).
 *   SEARCH    a dashed frame that shakes 2 px and a gleam that sweeps the object, with dust lifting, for the 2 seconds.
 *   CHIP      the answer (NOTHING HERE, COLD, WARM or HOT, or what went wrong) is drawn by HintLayer in the screen layer,
 *             so a zone label never covers it.
 *   BURST     my win: squares out of the object. Someone else's find: a ring and a few specks where the box was.
 */
export type GameTimeWorldProps = { layout: CampaignLayout; me: { x: number; y: number } | null; isWatcher: boolean; walkTo: (x: number, y: number) => void };

const ANIMATED = 10;
const OUTLINE_LOW = 4;
const BURST_COLOURS = ["#5B2EFF", "#D8B468", "#F5EBDD", "#5B2EFF", "#D8B468", "#F5EBDD", "#FF4D00"];

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 1000;
};

type Level = "far" | "near" | "in";

/** A four-point star, drawn as a path so it can carry a dark edge and a glow (a clip-path would cut both off). */
const Star = () => (
  <svg className={css.star} viewBox="0 0 24 24" aria-hidden>
    <path d="M12 0.5 14.7 9.3 23.5 12 14.7 14.7 12 23.5 9.3 14.7 0.5 12 9.3 9.3Z" />
  </svg>
);

export const Spot = memo(function Spot({ id, x, y, level, twinkle, dot, pop, onGo }: { id: string; x: number; y: number; level: Level; twinkle: boolean; dot: boolean; pop: boolean; onGo: ((id: string) => void) | null }) {
  const style = { left: x, top: y, "--d": `-${(hash(id) / 1000) * 2.4}s` } as React.CSSProperties;
  const cls = [css.spot, level === "near" ? css.near : "", twinkle && level !== "in" ? css.twinkle : "", pop ? css.popStar : ""].join(" ");
  return (
    <div className={cls} style={style} data-gt-spot={id} data-level={level}>
      <div className={css.spotBody}>
        {level === "in" ? (
          <i className={css.ring} />
        ) : dot ? (
          <i className={css.pulseDot} />
        ) : (
          <>
            <i className={css.halo} />
            <Star />
          </>
        )}
        {onGo && level !== "in" && (
          <button
            type="button"
            className={css.hit}
            aria-label={`Walk next to the ${id.replace(/[-_]+/g, " ")}`}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onGo(id);
            }}
          />
        )}
      </div>
    </div>
  );
});

/** The soft pulsing outline round a whole object (the full view has none). Lit and steady when SEARCH would pick it. */
export function Outline({ id, rect, tile, lit }: { id: string; rect: Rect; tile: number; lit: boolean }) {
  return (
    <i
      className={`${css.outline} ${lit ? css.outlineIn : ""}`}
      style={{ left: rect.x * tile, top: rect.y * tile, width: rect.w * tile, height: rect.h * tile, "--d": `-${(hash(id) / 1000) * 2.4}s` } as React.CSSProperties}
      data-gt-outline={id}
      aria-hidden
    />
  );
}

/** The search: a dashed frame that shakes 2 px and a gleam that sweeps the object, with dust lifting, for the 2 seconds. */
export function SearchFx({ rect, tile }: { rect: Rect; tile: number }) {
  return (
    <>
      <div className={css.rummage} style={{ left: rect.x * tile - 2, top: rect.y * tile - 2, width: rect.w * tile + 4, height: rect.h * tile + 4 }} aria-hidden />
      <div className={css.dustRow} style={{ left: (rect.x + rect.w / 2) * tile, top: (rect.y + rect.h) * tile - 4 }} aria-hidden>
        <div className={css.dustBody}>
          {[-10, 0, 10].map((x, i) => (
            <i key={x} className={css.dust} style={{ "--x": `${x}px`, "--d": `${i * 0.18}s` } as React.CSSProperties} />
          ))}
        </div>
      </div>
    </>
  );
}

/** Squares fly out of the object: my win. */
export function Burst({ k, rect, tile }: { k: number; rect: Rect; tile: number }) {
  const bits = useMemo(() => {
    const n = 14;
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + ((hash(`${k}-${i}`) % 40) / 100) * 0.6;
      const r = 38 + (hash(`${k}:${i}`) % 40);
      return { dx: Math.round(Math.cos(a) * r), dy: Math.round(Math.sin(a) * r), rot: (hash(`${i}r`) % 360) - 180, c: BURST_COLOURS[i % BURST_COLOURS.length] };
    });
  }, [k]);
  return (
    <div className={css.burst} style={{ left: (rect.x + rect.w / 2) * tile, top: (rect.y + rect.h / 2) * tile }} aria-hidden>
      <div className={css.burstBody}>
        {bits.map((b, i) => (
          <i key={i} className={css.bit} style={{ "--dx": `${b.dx}px`, "--dy": `${b.dy}px`, "--rot": `${b.rot}deg`, "--c": b.c } as React.CSSProperties} />
        ))}
      </div>
    </div>
  );
}

/** Someone else's find: a ring and a few specks on the object where it was. */
function Poof({ k, rect, tile }: { k: number; rect: Rect; tile: number }) {
  const specks = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2 + (hash(`${k}p${i}`) % 30) / 30;
        return { dx: Math.round(Math.cos(a) * 26), dy: Math.round(Math.sin(a) * 26), c: BURST_COLOURS[i % 3] };
      }),
    [k],
  );
  return (
    <div className={css.burst} style={{ left: (rect.x + rect.w / 2) * tile, top: (rect.y + rect.h / 2) * tile }} aria-hidden>
      <div className={css.burstBody}>
        <i className={css.poofRing} />
        {specks.map((s, i) => (
          <i key={i} className={css.speck} style={{ "--dx": `${s.dx}px`, "--dy": `${s.dy}px`, "--c": s.c } as React.CSSProperties} />
        ))}
      </div>
    </div>
  );
}

export default function GameTimeWorld({ layout, me, isWatcher, walkTo }: GameTimeWorldProps) {
  const game = useGameTime((s) => s.game);
  const mine = useGameTime((s) => s.me);
  const searching = useGameTime((s) => s.searching);
  const poofs = useGameTime((s) => s.poofs);
  const burst = useGameTime((s) => s.burst);
  const go = useGameTime((s) => s.go);
  const full = useRoomStore((s) => s.view) === "full";
  const tile = layout.grid.tile;
  const outlineCount = useMemo(() => (deviceTier() === "low" ? OUTLINE_LOW : ANIMATED), []);

  const shimmer = !!game && game.status === "live" && game.room_ok && !isWatcher && mine.member && mine.can_search && !mine.won;
  const objects = game?.objects;
  const spots = useMemo<SpotRect[]>(() => (shimmer && objects ? spotRects(layout, objects) : []), [shimmer, layout, objects]);
  const rectOf = (id: string) => layoutRect(layout, id)?.rect ?? null;

  // The ten nearest to me animate; the rest hold still.
  const mx = me?.x;
  const my = me?.y;
  const levels = useMemo(() => {
    const here = mx === undefined || my === undefined ? null : { x: mx, y: my };
    const target = nearestSpot(here, spots, 1)?.id ?? null;
    const rows = spots.map((s) => {
      const d = here ? tilesFrom(here, s.rect) : 99;
      const cx = s.rect.x + s.rect.w / 2;
      const cy = s.rect.y + s.rect.h / 2;
      const far = here ? Math.hypot(cx - here.x - 0.5, cy - here.y - 0.5) : 99;
      const level: Level = s.id === target ? "in" : d <= 3 ? "near" : "far";
      return { s, level, far };
    });
    const order = [...rows].sort((a, b) => a.far - b.far).slice(0, ANIMATED);
    const animated = new Set(order.map((r) => r.s.id));
    // The outlines are dearer to draw than the stars: a weak phone gets the four nearest.
    const outlined = new Set(order.slice(0, outlineCount).map((r) => r.s.id));
    return rows.map((r) => ({ ...r, twinkle: animated.has(r.s.id), outline: outlined.has(r.s.id) }));
  }, [spots, mx, my, outlineCount]);

  // The room draws the fountain's sticker over this layer; one step up keeps the stars (and their taps) above it.
  const marker = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const wrap = marker.current?.parentElement;
    if (wrap?.matches('[data-game-time-layer="world"]')) wrap.style.zIndex = "3";
  }, []);

  // A tap on a star: walk to the nearest tile beside that object.
  const here = mx === undefined || my === undefined ? null : { x: mx, y: my };
  const hereRef = useRef(here);
  hereRef.current = here;
  const spotsRef = useRef(spots);
  spotsRef.current = spots;
  const goNear = useCallback(
    (id: string) => {
      const from = hereRef.current;
      const rect = layoutRect(layout, id)?.rect;
      if (!from || !rect) return;
      const dest = approachTile(layout, from, id, rect, spotsRef.current);
      if (dest) walkTo(dest.x, dest.y);
    },
    [layout, walkTo],
  );

  // The GO of the opening: every star pops once.
  const [pop, setPop] = useState(false);
  const lastGo = useRef(go);
  useEffect(() => {
    if (go === lastGo.current) return;
    lastGo.current = go;
    setPop(true);
    const t = setTimeout(() => setPop(false), 1000);
    return () => clearTimeout(t);
  }, [go]);

  const searched = searching ? rectOf(searching.object) : null;
  const burstRect = burst ? rectOf(burst.object) : null;

  return (
    <>
      <i ref={marker} hidden />
      {!full &&
        levels.map(({ s, level, outline }) =>
          outline || level === "in" ? <Outline key={`o-${s.id}`} id={s.id} rect={s.rect} tile={tile} lit={level === "in"} /> : null,
        )}
      {levels.map(({ s, level, twinkle }) => (
        <Spot key={s.id} id={s.id} x={(s.rect.x + s.rect.w) * tile - 4} y={s.rect.y * tile + 4} level={level} twinkle={twinkle} dot={full} pop={pop} onGo={here ? goNear : null} />
      ))}
      {searching && searched && <SearchFx rect={searched} tile={tile} />}
      {burst && burstRect && <Burst key={burst.k} k={burst.k} rect={burstRect} tile={tile} />}
      {poofs.map((p) => {
        const r = rectOf(p.object);
        return r ? <Poof key={p.k} k={p.k} rect={r} tile={tile} /> : null;
      })}
    </>
  );
}

/**
 * The nearest walkable tile within one tile of an object (what the server accepts), by walking distance from `from`. A tile
 * where another object would be the one SEARCH picks does not count (two objects side by side), so the pill searches what I
 * tapped; if no tile is clean it takes the nearest one anyway.
 */
export function approachTile(layout: CampaignLayout, from: { x: number; y: number }, id: string, r: Rect, spots: readonly SpotRect[]): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestLen = Infinity;
  let loose: { x: number; y: number } | null = null;
  let looseLen = Infinity;
  for (let y = r.y - 1; y <= r.y + r.h; y++) {
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) continue;
      const tile = { x, y };
      if (!canWalkScene(layout, tile)) continue;
      if (x === from.x && y === from.y) {
        if (nearestSpot(tile, spots, 1)?.id === id) return null; // I am already where SEARCH would pick it
        continue;
      }
      const path = scenePath(layout, from, tile);
      if (!path) continue;
      if (path.length < looseLen) {
        loose = tile;
        looseLen = path.length;
      }
      if (path.length < bestLen && nearestSpot(tile, spots, 1)?.id === id) {
        best = tile;
        bestLen = path.length;
      }
    }
  }
  return best ?? loose;
}

/** An object's rectangle by id. A chip or a puff outlives the shimmer list (a game that just ended), so it asks the layout. */
export function layoutRect(layout: CampaignLayout, id: string): SpotRect | null {
  const p = layout.props.find((x) => x.id === id);
  return p ? { id, rect: { x: p.x, y: p.y, w: p.w, h: p.h } } : null;
}
