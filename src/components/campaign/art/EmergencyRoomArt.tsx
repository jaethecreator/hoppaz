import type { CampaignProp } from "@/lib/campaign/layout";
import { Props, RouteLine, type RoomArtProps } from "./kit";
import { ER, ErShell, ErWalls, erProps, FitText, octagon, type Draw } from "./emergencyKit";
import { PlusBeat, raveProps } from "./emergencyRaveKit";

/**
 * Emergency Room by SOS: a hub and spokes in a light rave venue. The deck is the hub, a light corridor ring runs round it,
 * light-framed bays sit round the edge and floor guide lines lead to each. Their logo is a lit lightbox on the back wall. Light
 * grey floor, brick red, bone and charcoal; no crosses, no curtains, no medical props. Draws from
 * src/lib/campaign/rooms/emergencyRoom.ts at both widths (30 and 36): everything is placed from the layout's own props and zones.
 */
export default function EmergencyRoomArt({ layout, uid }: RoomArtProps) {
  const tile = layout.grid.tile;
  const W = layout.grid.width * tile;
  const H = layout.grid.height * tile;
  const t = (n: number) => n * tile;
  const prop = (id: string): CampaignProp => layout.props.find((p) => p.id === id) as CampaignProp;
  const stop = (id: string) => layout.zones.find((z) => z.id === id)!.stop;
  const ring = prop("corridor-ring");
  const hub = prop("main-stage");
  const gate = prop("entry-map-table");
  const cx = layout.spawn.x * tile + 16; // the middle of the way in, in px
  const guide = (d: string) => (
    <g>
      <path d={d} fill="none" stroke={ER.redPale} strokeWidth="8" />
      <path d={d} fill="none" stroke={ER.red} strokeWidth="2" strokeDasharray="10 8" />
    </g>
  );
  const exp = stop("experiences");
  const heal = stop("healing");
  const merch = stop("merch");
  const base = erProps();

  const custom: Record<string, Draw> = {
    erbooth: base.erbooth,
    erspeaker: base.erspeaker,
    erbench: base.erbench,
    ergate: base.ergate,
    ...raveProps(),
    // The corridor ring: a lighter band round the hub with a dashed brick red line down its middle.
    wardring: (p) => {
      const w = p.w * tile;
      const h = p.h * tile;
      return (
        <g>
          <path d={`${octagon(0, 0, w, h, 40)}${octagon(40, 40, w - 80, h - 80, 14)}`} fillRule="evenodd" fill="#EEF0F5" stroke="#B9C0CC" strokeWidth="2" />
          <path d={octagon(20, 20, w - 40, h - 40, 28)} fill="none" stroke={ER.redTint} strokeWidth="3" strokeDasharray="12 8" />
        </g>
      );
    },
    // The hub: an octagonal deck with a brick red band and a red LED edge. Their mark (the plus and the heartbeat) once, on its top.
    hub: (p) => {
      const w = p.w * tile;
      const h = p.h * tile;
      return (
        <g>
          <path d={octagon(7, 9, w, h, 26)} fill="#181B21" opacity=".25" />
          <path d={octagon(0, 0, w, h - 2, 26)} fill={ER.boneShade} stroke={ER.charcoal} strokeWidth="2" />
          <path d={octagon(7, 7, w - 14, h - 16, 20)} fill={ER.bone} stroke={ER.red} strokeWidth="3" />
          <path d={octagon(14, 14, w - 28, h - 30, 15)} fill="none" stroke={ER.redTint} strokeWidth="2" strokeDasharray="8 6" />
          <PlusBeat x={w / 2 - 30} y={h - 52} w={60} />
        </g>
      );
    },
    // The courtyard fountain of this room: a small lit plinth at the foot of the deck. The crew's featured event sticker sits on it.
    fountain: (p) => {
      const w = p.w * tile;
      return (
        <g>
          <ellipse cx={w / 2} cy="26" rx={w / 2 + 8} ry="9" fill={ER.lamp} opacity=".5" />
          <rect x="3" y="9" width={w - 4} height="20" fill="#181B21" opacity=".22" />
          <rect x="1" y="6" width={w - 4} height="21" fill={ER.bone} stroke={ER.charcoal} strokeWidth="2" />
          <rect x="3" y="8" width={w - 8} height="4" fill={ER.red} />
          <FitText x={w / 2 - 2} y={22} w={w - 14} text="NEXT UP" max={8} fill={ER.charcoal} mono spacing={1.2} />
        </g>
      );
    },
  };

  return (
    <ErShell uid={uid} W={W} H={H} tile={tile}>
      {/* The foyer in front of the gate. */}
      <rect x={t(gate.x - 3) + 2} y={t(16) + 2} width={t(10) - 4} height={t(3) - 4} fill="#E6EAF1" stroke="#9AA3B2" strokeWidth="2" />
      {/* Soft red pools of light under the hub and the side bays. */}
      <ellipse cx={t(hub.x + 2)} cy={t(10)} rx={t(7)} ry={t(3) + 8} fill={ER.red} opacity=".06" />
      <ellipse cx={t(exp.x) + 16} cy={t(11)} rx={t(3)} ry={t(3)} fill={ER.red} opacity=".05" />
      <ellipse cx={t(merch.x) + 16} cy={t(10)} rx={t(3)} ry={t(3)} fill={ER.red} opacity=".05" />
      {/* Floor guide lines from the ring to the stops in front of the bays. */}
      {guide(`M${t(ring.x)} ${t(exp.y) + 16}H${t(exp.x) + 16}`)}
      {guide(`M${t(ring.x) + 16} ${t(ring.y + ring.h)}V${t(heal.y) + 16}H${t(heal.x) + 16}`)}
      {guide(`M${t(ring.x + ring.w)} ${t(merch.y) + 16}H${t(merch.x) + 16}`)}
      <ErWalls layout={layout} uid={uid} tile={tile} />
      <Props layout={layout} uid={uid} custom={custom} order={(p) => (p.kind === "wardring" ? -100 : p.kind === "erbooth" ? t(8) + 1 : p.y * tile)} />
      <RouteLine points={[[cx, 592], [cx, 536], [cx, 484], [cx, 432]]} />
    </ErShell>
  );
}
