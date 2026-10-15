import { Defs, Flyer, Floor, FONT, Frame, Lineup, P, Props, StringLights, Walls, type RoomArtProps } from "./kit";

/** Indoor party: a dark club with violet and orange light. The flyer and the line-up hang on the back wall. */
export default function IndoorArt({ layout, uid, brand, content }: RoomArtProps) {
  const tile = layout.grid.tile;
  const W = layout.grid.width * tile;
  const H = layout.grid.height * tile;
  const title = (content?.title || brand || "Indoor party").toUpperCase();
  const flyer = layout.props.find((p) => p.id === "event-flyer");
  const board = layout.props.find((p) => p.id === "event-lineup");
  const lineup = content?.lineup?.length ? content.lineup : [{ name: "Warm-up DJ", time: "9PM" }, { name: "Resident DJ", time: "11PM" }, { name: "Headliner", time: "1AM" }];
  const size = Math.max(10, Math.min(24, 300 / Math.max(6, title.length * 0.78)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" shapeRendering="crispEdges">
      <Defs uid={uid} names={["checker", "dance", "carpet", "stagewood", "redcarpet"]} />
      <Frame layout={layout} ground="#15121C" />
      <rect x={tile} y={tile} width={W - tile * 2} height={H - tile * 2} fill={`url(#${uid}-checker)`} stroke={P.ink} strokeWidth="4" />

      {/* Floors by zone, and a red carpet from the door to the dance floor. */}
      {layout.zones.map((z) => <Floor key={z.id} uid={uid} rect={z} material={z.material === "checker" ? "checker" : z.material} border={z.id === "booth" ? P.orange : undefined} tile={tile} />)}
      <Floor uid={uid} rect={{ x: 14, y: 14, w: 2, h: 5 }} material="redcarpet" tile={tile} />
      <path d={`M${14 * tile + 1} ${14 * tile}V${H - tile}M${16 * tile - 1} ${14 * tile}V${H - tile}`} stroke={P.gold} strokeWidth="2" />

      {/* Ceiling light beams over the dance floor. */}
      {[[11, P.orange], [15, P.violetLight], [19, P.orange]].map(([cx, c], i) => (
        <path key={i} d={`M${(cx as number) * tile} ${4 * tile}L${(cx as number) * tile - 70} ${13 * tile}H${(cx as number) * tile + 70}Z`} fill={c as string} opacity=".1" />
      ))}

      <Walls layout={layout} face="#2B2540" cap="#4A3F6B" />

      {/* Back wall: panelling, neon title, tube light, bottle shelf behind the bar. */}
      {Array.from({ length: 13 }, (_, i) => <rect key={i} x={tile + 8 + i * 64} y={tile * 2 + 14} width="52" height="24" fill="#352C52" stroke="#201A34" strokeWidth="2" />)}
      <rect x={tile + 3} y={tile * 3 - 6} width={W - tile * 2 - 6} height="4" fill="#1B1630" />
      <rect x={tile + 6} y={tile + 8} width={W - tile * 2 - 12} height="3" fill={P.violetLight} opacity=".9" />
      <rect x={tile + 6} y={tile + 8} width={W - tile * 2 - 12} height="9" fill={P.violetLight} opacity=".18" />
      <g>
        <rect x={W / 2 - 150} y={tile + 24} width="300" height="42" fill={P.night} stroke={P.ink} strokeWidth="3" />
        <text x={W / 2} y={tile + 54} textAnchor="middle" fill={P.orange} fontFamily={FONT.display} fontWeight={900} fontSize={size} letterSpacing="2">{title}</text>
        <text x={W / 2} y={tile + 54} textAnchor="middle" fill={P.paper} fontFamily={FONT.display} fontWeight={900} fontSize={size} letterSpacing="2" opacity=".35">{title}</text>
      </g>
      {board && <g />}
      <g transform={`translate(${21 * tile + 6},${tile * 2 + 10})`}>
        <rect width={6 * tile - 12} height="22" fill={P.night} stroke={P.ink} strokeWidth="2" />
        {Array.from({ length: 11 }, (_, i) => <rect key={i} x={5 + i * 14} y="4" width="6" height="14" fill={[P.mint, P.gold, P.orange, P.violetLight][i % 4]} stroke={P.shadow} strokeWidth="1" />)}
      </g>

      <StringLights x1={tile * 8} x2={tile * 21} y={tile * 4 + 4} sag={10} bulbs={12} colors={[P.orange, P.violetLight, P.paper]} />

      <Props
        layout={layout}
        uid={uid}
        custom={{
          "event-flyer": (p) => <Flyer uid={uid} x={0} y={4} w={p.w * tile} h={p.h * tile - 8} url={content?.flyerUrl} title={title} line={content?.line} />,
          "event-lineup": (p) => <Lineup x={0} y={4} w={p.w * tile} h={p.h * tile - 8} items={lineup} />,
          "bar-counter": (p) => (
            <g>
              <rect x="4" y="6" width={p.w * tile} height={p.h * tile} fill={P.shadow} opacity=".25" />
              <rect x="1" y="1" width={p.w * tile - 2} height={p.h * tile - 2} fill={P.night} stroke={P.ink} strokeWidth="2" />
              <rect x="2" y="2" width={p.w * tile - 4} height="12" fill="#3A3150" />
              <rect x="2" y="14" width={p.w * tile - 4} height="4" fill={P.violetLight} />
              <rect x="2" y={p.h * tile - 8} width={p.w * tile - 4} height="4" fill={P.orange} />
            </g>
          ),
        }}
      />

      {/* Disco ball hung over the floor. */}
      <g transform={`translate(${15 * tile},${8 * tile + 4})`}>
        <path d="M0-20V-6" stroke={P.ink} strokeWidth="2" />
        <circle r="13" fill={P.slateLight} stroke={P.ink} strokeWidth="2" />
        {[[-6, -5], [3, -7], [-1, 1], [7, 3], [-8, 6], [2, 8]].map(([x, y], i) => <rect key={i} x={x} y={y} width="4" height="3" fill={i % 2 ? P.paper : P.violetLight} />)}
      </g>

      {/* The front lip of the room and the doorway. */}
      <path d={`M${tile} ${H - 1}H${13 * tile}M${17 * tile} ${H - 1}H${W - tile}`} stroke={P.ink} strokeWidth="4" />
      <rect x={flyer ? flyer.x * tile : 0} y="0" width="0" height="0" />
    </svg>
  );
}
