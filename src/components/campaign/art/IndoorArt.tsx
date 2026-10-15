import { BrandSign, Defs, Floor, FONT, Frame, HopFlyer, Lineup, P, Props, RouteLine, Shade, StringLights, Walls, type RoomArtProps } from "./kit";

/**
 * Indoor party: a night club on the warm night ramp, lit orange and cream. The one violet shape is the flyer's sun. The
 * flyer, the bounce wordmark, the title and the line-up hang on the back wall; the route runs from the door to the dance floor.
 */
export default function IndoorArt({ layout, uid, brand, content }: RoomArtProps) {
  const tile = layout.grid.tile;
  const W = layout.grid.width * tile;
  const H = layout.grid.height * tile;
  const title = (content?.title || brand || "Indoor party").toUpperCase();
  const lineup = content?.lineup?.length ? content.lineup : [{ name: "Warm-up DJ", time: "9PM" }, { name: "Resident DJ", time: "11PM" }, { name: "Headliner", time: "1AM" }];
  const size = Math.max(10, Math.min(24, 300 / Math.max(6, title.length * 0.78)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <Defs uid={uid} names={["stagewood"]} />
      {/* Room-local floors on the night ramp (the kit's own checker, carpet and dance run purple). */}
      <defs>
        <pattern id={`${uid}-checker`} width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill={P.nightRaised} /><rect width="16" height="16" fill={P.nightCard} /><rect x="16" y="16" width="16" height="16" fill={P.nightCard} /></pattern>
        <pattern id={`${uid}-carpet`} width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill={P.nightCard} /><path d="M0 0H32V32" fill="none" stroke={P.nightRaised} strokeWidth="1" /><path d="M4 4h2M20 12h2M10 24h2M26 28h2" stroke={P.nightLine} strokeWidth="1" /></pattern>
        <pattern id={`${uid}-dance`} width="64" height="64" patternUnits="userSpaceOnUse"><rect width="64" height="64" fill={P.night} />{[0, 1, 2, 3].flatMap((cy) => [0, 1, 2, 3].map((cx) => <rect key={`${cx}${cy}`} x={cx * 16 + 1} y={cy * 16 + 1} width="14" height="14" fill={(cx + cy) % 2 ? P.nightCard : P.nightLine} />))}<rect x="17" y="1" width="14" height="14" fill={P.orange} /><rect x="49" y="17" width="14" height="14" fill={P.orange} /><rect x="1" y="33" width="14" height="14" fill={P.paper} opacity=".85" /><rect x="33" y="49" width="14" height="14" fill={P.orange} /><rect x="19" y="3" width="6" height="2" fill={P.paper} opacity=".5" /><rect x="51" y="19" width="6" height="2" fill={P.paper} opacity=".5" /></pattern>
      </defs>
      <Frame layout={layout} ground={P.night} />
      <rect x={tile} y={tile} width={W - tile * 2} height={H - tile * 2} fill={`url(#${uid}-checker)`} stroke={P.ink} strokeWidth="4" />

      {/* Floors by zone, and a runner from the door to the dance floor. */}
      {layout.zones.map((z) => <Floor key={z.id} uid={uid} rect={z} material={z.material === "checker" ? "checker" : z.material} border={z.id === "booth" ? P.orange : undefined} tile={tile} />)}
      <rect x={14 * tile} y={14 * tile} width={2 * tile} height={5 * tile} fill={P.nightCard} />
      <path d={`M${14 * tile + 1} ${14 * tile}V${H - tile}M${16 * tile - 1} ${14 * tile}V${H - tile}`} stroke={P.nightLine} strokeWidth="2" />

      {/* Ceiling light beams over the dance floor. */}
      {[[11, P.orange], [15, P.paper], [19, P.orange]].map(([cx, c], i) => (
        <path key={i} d={`M${(cx as number) * tile} ${4 * tile}L${(cx as number) * tile - 70} ${13 * tile}H${(cx as number) * tile + 70}Z`} fill={c as string} opacity=".1" />
      ))}

      <Walls layout={layout} face={P.nightCard} cap={P.nightLine} />

      {/* Back wall: panelling, title, tube light, bottle shelf behind the bar. */}
      {Array.from({ length: 13 }, (_, i) => <rect key={i} x={tile + 8 + i * 64} y={tile * 2 + 14} width="52" height="24" fill={P.nightLine} stroke={P.nightRaised} strokeWidth="2" />)}
      <rect x={tile + 3} y={tile * 3 - 6} width={W - tile * 2 - 6} height="4" fill={P.nightRaised} />
      <rect x={tile + 6} y={tile + 8} width={W - tile * 2 - 12} height="3" fill={P.orange} opacity=".9" />
      <rect x={tile + 6} y={tile + 8} width={W - tile * 2 - 12} height="9" fill={P.orange} opacity=".18" />
      <g>
        <rect x={W / 2 - 150} y={tile + 24} width="300" height="42" fill={P.night} stroke={P.ink} strokeWidth="3" />
        <text x={W / 2} y={tile + 54} textAnchor="middle" fill={P.orange} fontFamily={FONT.display} fontWeight={900} fontSize={size} letterSpacing="2">{title}</text>
      </g>
      {/* The bounce wordmark, always showing, between the flyer and the title. */}
      <BrandSign x={208} y={52} w={104} h={52} wordmark tone="orange" />
      <g transform={`translate(${21 * tile + 6},${tile * 2 + 10})`}>
        <rect width={6 * tile - 12} height="22" fill={P.night} stroke={P.ink} strokeWidth="2" />
        {Array.from({ length: 11 }, (_, i) => <rect key={i} x={5 + i * 14} y="4" width="6" height="14" fill={[P.mint, P.gold, P.orange, P.paper][i % 4]} stroke={P.shadow} strokeWidth="1" />)}
      </g>

      <StringLights x1={tile * 8} x2={tile * 21} y={tile * 4 + 4} sag={10} bulbs={12} colors={[P.orange, P.gold, P.paper]} />

      <Props
        layout={layout}
        uid={uid}
        custom={{
          "event-flyer": (p) => <HopFlyer uid={uid} x={0} y={4} w={p.w * tile} h={p.h * tile - 8} url={content?.flyerUrl} title={title} line={content?.line} />,
          "event-lineup": (p) => <Lineup x={0} y={4} w={p.w * tile} h={p.h * tile - 8} items={lineup} />,
          "bar-counter": (p) => (
            <g>
              <rect x="4" y="6" width={p.w * tile} height={p.h * tile} fill={P.shadow} opacity=".25" />
              <rect x="1" y="1" width={p.w * tile - 2} height={p.h * tile - 2} fill={P.night} stroke={P.ink} strokeWidth="2" />
              <rect x="2" y="2" width={p.w * tile - 4} height="12" fill={P.nightLine} />
              <rect x="2" y="14" width={p.w * tile - 4} height="4" fill={P.paper} />
              <rect x="2" y={p.h * tile - 8} width={p.w * tile - 4} height="4" fill={P.orange} />
            </g>
          ),
          // The kit's booth and sofa carry violet: same shapes on the night ramp, VIP booths night with an orange back.
          booth: (p) => {
            const w = p.w * tile;
            const h = p.h * tile;
            const vip = (p.variant ?? 0) === 1;
            const back = Math.min(10, h / 3);
            const seat = Math.min(13, h / 3 + 4);
            return (
              <g>
                <Shade w={w} h={h} />
                <rect x="1" y="2" width={w - 4} height={h - 5} fill={vip ? P.nightCard : P.nightLine} stroke={P.nightDim} strokeWidth="2" />
                <rect x="3" y="3" width={w - 8} height={back} fill={vip ? P.orange : P.paper} />
                <rect x="3" y={seat} width={w - 8} height={h - seat - 6} fill={P.nightDim} opacity=".35" />
                <path d={`M${w / 2 - 1} ${seat}v${h / 3}`} stroke={P.ink} strokeWidth="2" />
              </g>
            );
          },
          // The kit's DJ booth has one violet platter: the right one goes cream.
          djbooth: (p) => {
            const w = p.w * tile;
            const h = p.h * tile;
            return (
              <g>
                <Shade w={w} h={h} />
                <rect x="1" y="1" width={w - 2} height={h - 2} fill={P.ink} stroke={P.shadow} strokeWidth="2" />
                <rect x="3" y="3" width={w - 6} height={h - 12} fill={P.wall} />
                <circle cx={w / 2 - 14} cy={h / 2 - 3} r="9" fill={P.ink} stroke={P.slateLight} strokeWidth="2" /><circle cx={w / 2 - 14} cy={h / 2 - 3} r="2" fill={P.orange} />
                <circle cx={w / 2 + 14} cy={h / 2 - 3} r="9" fill={P.ink} stroke={P.slateLight} strokeWidth="2" /><circle cx={w / 2 + 14} cy={h / 2 - 3} r="2" fill={P.paper} />
                <rect x={w / 2 - 5} y="6" width="10" height={h - 20} fill={P.slate} /><rect x={w / 2 - 3} y="9" width="2" height="5" fill={P.paper} /><rect x={w / 2 + 1} y="12" width="2" height="5" fill={P.paper} />
                <rect x="3" y={h - 8} width={w - 6} height="3" fill={P.orange} />
              </g>
            );
          },
          // The kit's dance floor has a violet border: orange here.
          dancefloor: (p) => (
            <g>
              <rect width={p.w * tile} height={p.h * tile} fill={`url(#${uid}-dance)`} stroke={P.ink} strokeWidth="2" />
              <rect x="3" y="3" width={p.w * tile - 6} height={p.h * tile - 6} fill="none" stroke={P.orange} strokeWidth="2" opacity=".7" />
            </g>
          ),
        }}
      />

      {/* The route, door to dance floor: after the props so it lies on the floor prop, before the ball hung over it. */}
      <RouteLine points={[[496, 604], [496, 540], [496, 476], [496, 368]]} />

      {/* Disco ball hung over the floor. */}
      <g transform={`translate(${15 * tile},${8 * tile + 4})`}>
        <path d="M0-20V-6" stroke={P.ink} strokeWidth="2" />
        <circle r="13" fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
        {[[-6, -5], [3, -7], [-1, 1], [7, 3], [-8, 6], [2, 8]].map(([x, y], i) => <rect key={i} x={x} y={y} width="4" height="3" fill={i % 2 ? P.paper : P.orange} />)}
      </g>

      {/* The front lip of the room and the doorway. */}
      <path d={`M${tile} ${H - 1}H${13 * tile}M${17 * tile} ${H - 1}H${W - tile}`} stroke={P.ink} strokeWidth="4" />
    </svg>
  );
}
