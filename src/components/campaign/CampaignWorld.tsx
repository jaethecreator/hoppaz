"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LocateFixed, Map, Move, MessageCircle, Volume2 } from "lucide-react";
import Avatar from "@/components/Avatar";
import type { Tile } from "@/lib/campaign/geometry";
import { areaArrival, privateAreaAt, canWalkScene, scenePath, sceneSize, type CampaignLayout, type CampaignZone, type ZoneId } from "@/lib/campaign/layout";
import ClubhouseArt from "./ClubhouseArt";
import css from "./Campaign.module.css";
import type { SocialWorld } from "@/lib/crew-room/types";

export default function CampaignWorld({ layout, look, brand, selected, onZone, touring, onTourHandled, social }: { layout: CampaignLayout; look: unknown; brand: string; selected: ZoneId | null; onZone: (zone: CampaignZone) => void; touring: ZoneId | null; onTourHandled: () => void; social?: SocialWorld }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 960, height: 640 });
  const [player, setPlayer] = useState(layout.spawn);
  const current = useRef(layout.spawn);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstMeasurement = useRef(true);
  const [walking, setWalking] = useState(false);
  const [overview, setOverview] = useState(true);
  const [notice, setNotice] = useState("Choose a room, or tap the floor to walk.");
  const [destination, setDestination] = useState<Tile | null>(null);
  const uid = useId().replace(/:/g, "");
  const scene = sceneSize(layout);

  useEffect(() => {
    if (!social?.reset) return;
    if (timer.current) clearTimeout(timer.current);
    const tile = { x: social.reset.x, y: social.reset.y };
    current.current = tile; setPlayer(tile); setWalking(false); setDestination(null);
  }, [social?.reset]);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      if (firstMeasurement.current) { firstMeasurement.current = false; setOverview(entry.contentRect.width >= 700); }
    });
    observer.observe(el);
    return () => { observer.disconnect(); if (timer.current) clearTimeout(timer.current); };
  }, []);

  const move = useCallback((to: Tile, after?: () => void, follow = true) => {
    if (timer.current) clearTimeout(timer.current);
    setWalking(false); setDestination(null);
    const path = scenePath(layout, current.current, to);
    if (!path) { setNotice("That spot is furniture or a wall. Try an open path."); return; }
    if (follow) setOverview(false);
    setDestination(to);
    if ((!social && window.matchMedia("(prefers-reduced-motion: reduce)").matches) || !path.length) {
      current.current = to; setPlayer(to); setWalking(false); setDestination(null); after?.(); return;
    }
    setWalking(true);
    const step = () => {
      const next = path[0];
      if (!next) { setWalking(false); setDestination(null); setNotice("You're here. Choose a room to explore."); after?.(); return; }
      if (social && !social.onStep(next)) { setWalking(false); setNotice("Waiting for the connection. Your walk will continue."); timer.current=setTimeout(step,200); return; }
      path.shift(); setWalking(true);
      current.current = next; setPlayer(next);
      timer.current = setTimeout(step, 85);
    };
    step();
  }, [layout, social]);

  const socialDestination = social?.destination;
  const socialDestinationHandled = social?.onDestinationHandled;
  const socialPeers = social?.peers;
  const socialSelf = social?.selfId;
  useEffect(() => {
    if (!socialDestination) return;
    const area=privateAreaAt(layout,socialDestination);
    move(area ? areaArrival(layout,area,socialPeers?.filter(p=>p.id!==socialSelf) ?? [],current.current) : socialDestination);
    socialDestinationHandled?.();
  }, [socialDestination, socialDestinationHandled, socialPeers, socialSelf, layout, move]);

  const choose = useCallback((zone: CampaignZone) => move(zone.stop, () => { setNotice(`You're in ${zone.name}.`); onZone(zone); }), [move, onZone]);
  useEffect(() => {
    if (!touring) return;
    const zone = layout.zones.find((item) => item.id === touring);
    if (zone) choose(zone);
    onTourHandled();
  }, [touring, layout, choose, onTourHandled]);

  const fit = Math.min(size.width / scene.width, size.height / scene.height);
  const scale = overview ? fit * .94 : size.width >= 900 ? Math.min(1.2, fit) : Math.min(1.05, Math.max(.85, size.width / 470));
  const visibleWidth = size.width / scale, visibleHeight = size.height / scale;
  const cameraX = overview ? 0 : Math.max(0, Math.min(scene.width - visibleWidth, (player.x + .5) * layout.grid.tile - visibleWidth / 2));
  const cameraY = overview ? 0 : Math.max(0, Math.min(scene.height - visibleHeight, (player.y + .5) * layout.grid.tile - visibleHeight / 2));
  const left = Math.max(0, (size.width - scene.width * scale) / 2) - cameraX * scale;
  const top = Math.max(0, (size.height - scene.height * scale) / 2) - cameraY * scale;
  const project = (tile: Tile) => ({ x: left + (tile.x + .5) * layout.grid.tile * scale, y: top + (tile.y + .5) * layout.grid.tile * scale });
  const steps = [{ name: "up", Icon: ArrowUp, x: 0, y: -1 }, { name: "left", Icon: ArrowLeft, x: -1, y: 0 }, { name: "down", Icon: ArrowDown, x: 0, y: 1 }, { name: "right", Icon: ArrowRight, x: 1, y: 0 }];
  const peers = social?.peers.filter((peer) => peer.id !== social.selfId) ?? [];
  const areaMembers = social?.circleId ? social.peers.filter((peer) => peer.circle_id === social.circleId) : [];
  const currentArea = layout.privateAreas.find((area) => area.id===social?.areaId);

  return <div className={css.worldShell}>
    <div className={css.viewport} ref={viewport} role="group" aria-label={`${brand} walkable clubhouse`} onKeyDown={(event) => {
      if (event.target instanceof HTMLElement && (event.target.matches("input, textarea, select") || event.target.isContentEditable)) return;
      const direction = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event.key];
      if (!direction) return;
      event.preventDefault(); move({ x: current.current.x + direction[0], y: current.current.y + direction[1] });
    }}>
      <div className={css.world} style={{ width: scene.width, height: scene.height, left, top, transform: `scale(${scale})` }}>
        <button type="button" className={css.floor} aria-label="Walk on the floor. Use the arrow keys to move." onClick={(event) => {
          if (!event.detail) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          move({ x: Math.floor((event.clientX - bounds.left) / scale / layout.grid.tile), y: Math.floor((event.clientY - bounds.top) / scale / layout.grid.tile) }, undefined, !overview);
        }}><ClubhouseArt layout={layout} uid={uid} brand={brand} /></button>
        {social && layout.privateAreas.map((area) => <div key={area.id} data-conversation-area={area.id} aria-hidden className={`${css.privateArea} ${currentArea?.id===area.id ? css.privateAreaActive : ''}`} style={{left:area.x*layout.grid.tile,top:area.y*layout.grid.tile,width:area.w*layout.grid.tile,height:area.h*layout.grid.tile}}><span>{area.name.replace('Listening ','')}</span></div>)}
        {destination && <div className={css.destination} style={{ left: (destination.x + .5) * layout.grid.tile, top: (destination.y + .5) * layout.grid.tile }} />}
        {peers.map((peer) => <div key={peer.id} data-room-peer={peer.id} data-peer-tile={`${peer.x},${peer.y}`} className={`${css.player} ${css.peer} ${peer.circle_id && peer.circle_id === social?.circleId ? css.nearPeer : ""}`} style={{ left: (peer.x + .5) * layout.grid.tile - 7, top: (peer.y + .5) * layout.grid.tile }}><span><Avatar look={peer.look} label={`${peer.name}'s character`} /></span><b>{peer.name}</b></div>)}
        <div className={css.player} data-player-tile={`${player.x},${player.y}`} style={{ left: (player.x + .5) * layout.grid.tile, top: (player.y + .5) * layout.grid.tile }}><span className={walking ? css.walking : undefined}><Avatar look={look} label="Your character" /></span><b>You</b></div>
      </div>
      {layout.zones.map((zone) => {
        const at = project(zone.plaque);
        return <button key={zone.id} type="button" className={`${css.marker} ${selected === zone.id ? css.markerSelected : ""}`} aria-label={`Explore ${zone.name}`} title={zone.name} onClick={() => choose(zone)} style={{ left: at.x, top: at.y }}><span>{zone.number}</span></button>;
      })}
      {peers.map((peer) => { const at = project(peer); return <button key={peer.id} type="button" className={css.peerTarget} aria-label={`Walk to ${peer.name}`} title={`Walk to ${peer.name}`} style={{ left:at.x,top:at.y }} onClick={() => move({ x:peer.x,y:peer.y })} />; })}
      {social && layout.privateAreas.map((area) => { const at=project({x:area.x+area.w-1,y:area.y+area.h-1});return <button key={area.id} type="button" className={css.areaTarget} aria-label={`Join ${area.name}`} title={`Join ${area.name}`} style={{left:at.x,top:at.y}} onClick={() => move(areaArrival(layout,area,peers,current.current))}><MessageCircle size={13} aria-hidden /></button>; })}
      <div className={css.camera}><button type="button" onClick={() => setOverview((value) => !value)} aria-label={overview ? "Follow my character" : "See the whole clubhouse"}>{overview ? <LocateFixed size={17} aria-hidden /> : <Map size={17} aria-hidden />}<span>{overview ? "Follow me" : "Overview"}</span></button></div>
      {social && <button type="button" className={css.nearbyStatus} onClick={social.onConversation} aria-label={currentArea ? `Open ${currentArea.name} chat` : 'Find conversation areas'}><MessageCircle size={14} aria-hidden /><span>{currentArea ? `${currentArea.name} · ${areaMembers.length}` : 'Conversation areas'}</span></button>}
      {overview && <div className={css.overviewHint}><Move size={14} aria-hidden />Six rooms. One music home.</div>}
      {!overview && <div className={css.controls} aria-label="Walk controls">{steps.map(({ name, Icon, x, y }) => <button type="button" key={name} aria-label={`Walk ${name}`} disabled={!canWalkScene(layout, { x: player.x + x, y: player.y + y })} onClick={() => move({ x: current.current.x + x, y: current.current.y + y })}><Icon size={18} aria-hidden /></button>)}</div>}
    </div>
    <div className={css.worldStatus}><p role="status" aria-live="polite">{walking ? "Walking to your next stop…" : notice}</p><span><Volume2 size={13} aria-hidden />Sound starts when you choose it</span></div>
  </div>;
}
