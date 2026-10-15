"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import clsx from "clsx";
import { ChevronDown, ChevronLeft, MessageCircle } from "lucide-react";
import CampaignWorld from "@/components/campaign/CampaignWorld";
import AdultSheet from "@/components/hotspots/room/AdultSheet";
import ChatPanel from "@/components/hotspots/room/ChatPanel";
import { closedCopy, hereText } from "@/components/hotspots/room/copy";
import HeadCard, { type HeadPerson } from "@/components/hotspots/room/HeadCard";
import RewardMoment from "@/components/hotspots/room/RewardMoment";
import type { Head } from "@/components/hotspots/room/api";
import { useHotspotChat } from "@/components/hotspots/room/useHotspotChat";
import { useHotspotRoom } from "@/components/hotspots/room/useHotspotRoom";
import { useKeyboardUp } from "@/components/hotspots/room/useKeyboardUp";
import { anonLook, normalizeLook } from "@/lib/avatar";
import { hotspotRoom } from "@/lib/campaign/templates";
import { canWalkScene, type CampaignLayout } from "@/lib/campaign/layout";
import type { RoomPeer, SocialWorld } from "@/lib/crew-room/types";
import { hotspotRoomData } from "@/lib/rooms/hotspotRooms";
import { useHoppaz } from "@/lib/store";
import { useSession } from "@/lib/useSession";

// A hotspot with no room drawn yet keeps the crossroads chat screen: no dead ends.
const Crossroads = dynamic(() => import("@/components/hotspots/HotspotRoom"), { ssr: false });

/**
 * What your own avatar looks like in a hotspot room. true: your own Hopper (the body is yours, the name is the alias).
 * false: an alias look like everyone else's. Jae has not ruled yet (15 Oct); this one flag switches it. Other people's
 * bodies are always aliases, and nothing here sends a look anywhere.
 */
const OWN_HOPPER_IN_ROOM = true;

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** The people in the room as idle figures at the landmark stops, a stop each by their key, on a free walkable tile near it. */
function placeHeads(layout: CampaignLayout, heads: Head[], at: string): RoomPeer[] {
  const stops = layout.zones.map((z) => z.stop);
  if (!stops.length) return [];
  const taken = new Set<string>([`${layout.spawn.x},${layout.spawn.y}`]);
  const free = (x: number, y: number) => canWalkScene(layout, { x, y }) && !taken.has(`${x},${y}`);
  return [...heads]
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((h) => {
      const stop = stops[hash(h.key) % stops.length];
      let tile = stop;
      search: for (let r = 0; r <= 4; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (free(stop.x + dx, stop.y + dy)) {
              tile = { x: stop.x + dx, y: stop.y + dy };
              break search;
            }
          }
        }
      }
      taken.add(`${tile.x},${tile.y}`);
      return { id: h.key, name: h.alias, look: normalizeLook(h.look ?? anonLook(h.alias)), x: tile.x, y: tile.y, circle_id: null, last_seen: at };
    });
}

/**
 * /room/<hotspot slug>: the hotspot's own room, where a pin, the home base chip, a list row and a link lead. The room is
 * the place drawn for its real landmarks (room-templates); the live layer is the hotspot server's, on the same calls the
 * crossroads screen used: enter and leave, the 18+ question, the heads of the people there (aliases, idle at the
 * landmarks), the chat (a drawer on a phone, a column on a wide screen) and the daily reward.
 *
 * Anyone can look in. Being in it for real needs an account (and the 18+ yes): a guest sees the room and a line that
 * asks them to make one, nothing sends their position, and the server never learns it.
 */
export default function HotspotRoomPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const room = hotspotRoom(slug);
  const data = hotspotRoomData(slug);
  if (!room || !data) return <Crossroads slug={slug} onLeave={() => router.push("/")} />;
  return <LiveRoom slug={slug} room={room} data={data} />;
}

function LiveRoom({ slug, room, data }: { slug: string; room: NonNullable<ReturnType<typeof hotspotRoom>>; data: NonNullable<ReturnType<typeof hotspotRoomData>> }) {
  const router = useRouter();
  const { profile } = useSession();
  const stored = useHoppaz((s) => s.look);
  const { phase, entered, room: rs, reward, retry, recover, askAccount, readAgain } = useHotspotRoom(slug);
  const chat = useHotspotChat(phase.t === "in" ? entered?.channel ?? null : null, entered?.key ?? null);
  const typing = useKeyboardUp();
  const [person, setPerson] = useState<HeadPerson | null>(null);
  const [drawer, setDrawer] = useState(false);
  // The world reads the window (device tier, camera): draw it on the client only.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const alias = entered?.alias ?? rs?.you.alias ?? null;
  const look = useMemo(
    () => (OWN_HOPPER_IN_ROOM ? normalizeLook(profile?.avatar ?? stored ?? anonLook(alias ?? "Hopper")) : anonLook(alias ?? "Hopper")),
    [profile?.avatar, stored, alias]
  );

  const heads = rs?.heads;
  // The people you can @tag: the others in the room (the heads never include you).
  const mentionables = useMemo(() => (heads ?? []).map((h) => ({ key: h.key, alias: h.alias })), [heads]);
  const at = useMemo(() => new Date().toISOString(), []);
  const peers = useMemo(() => (phase.t === "in" && heads ? placeHeads(room.layout, heads, at) : []), [phase.t, heads, room.layout, at]);
  const social: SocialWorld = useMemo(
    () => ({ peers, circles: [], selfId: "me", circleId: null, areaId: null, watching: false, observedAt: at, reset: { x: room.layout.spawn.x, y: room.layout.spawn.y, revision: 0 }, onStep: () => true }),
    [peers, room.layout, at]
  );

  const band = rs?.here_band ?? entered?.here_band ?? "quiet";
  const others = rs ? rs.heads.length : null;
  const pill = phase.t === "in" ? hereText(band, rs?.here_n ?? null, others) : null;
  const slow = rs?.slow ?? entered?.slow;
  const place = data.junction;

  const chatPanel =
    phase.t === "in" && entered && slow ? (
      <ChatPanel msgs={chat.msgs} live={chat.live} send={chat.send} youKey={entered.key} slow={slow} rules={entered.rules} onPick={setPerson} onRejoin={() => void recover()} typing={typing} mentionables={mentionables} myAlias={alias} />
    ) : (
      <div className="px-4 pt-3">
        {phase.t === "account" ? (
          <>
            <p className="font-body text-[15px] leading-snug">Make an account to chat in {place}. It takes 20 seconds.</p>
            <button type="button" className="btn mt-3 w-full" onClick={askAccount}>
              Make an account
            </button>
          </>
        ) : phase.t === "loading" ? (
          <p className="hint">Joining the room…</p>
        ) : phase.t === "adult" ? (
          <p className="hint">One quick question before you come in.</p>
        ) : null}
      </div>
    );

  return (
    <div className="absolute inset-0 flex flex-col bg-ink text-cream">
      <header className="flex flex-none items-center gap-1 border-b border-line bg-ink-2 pr-4 pt-[env(safe-area-inset-top)]" style={{ minHeight: "calc(56px + env(safe-area-inset-top))" }}>
        <Link href="/" aria-label="Back to the map" className="grid h-11 w-11 flex-none place-items-center">
          <ChevronLeft size={26} strokeWidth={2.2} aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[22px] font-black leading-6">{place}</h1>
          <p className="truncate font-mono text-[10.5px] uppercase tracking-[0.08em] text-dim">
            {data.place} hotspot{alias && phase.t === "in" ? ` · you are ${alias}` : ""}
          </p>
        </div>
        {pill && <span className={clsx("pill flex-none", band !== "quiet" && others !== 0 && "pill-keke")}>{pill}</span>}
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden" style={{ isolation: "isolate" }}>
          {mounted && <CampaignWorld key={room.key} layout={room.layout} look={look} brand={place} social={social} placeId={room.key} />}

          {/* A phone: the chat is a drawer that pulls up from the bottom. */}
          <div className="lg:hidden">
            {!drawer && (
              <button
                type="button"
                onClick={() => setDrawer(true)}
                className="absolute inset-x-3 bottom-3 z-20 flex min-h-[48px] items-center justify-between gap-2 rounded-[12px] border border-line bg-ink-2/95 px-3.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] shadow-sheet backdrop-blur"
              >
                <span className="flex items-center gap-2">
                  <MessageCircle size={16} aria-hidden /> Chat{pill ? ` · ${pill}` : ""}
                </span>
                <ChevronDown size={16} className="rotate-180" aria-hidden />
              </button>
            )}
            {drawer && (
              <div role="dialog" aria-label="Chat" className="absolute inset-x-0 bottom-0 z-30 flex h-[68%] flex-col rounded-t-[14px] border-t border-line bg-ink-2 shadow-sheet">
                <button type="button" onClick={() => setDrawer(false)} aria-label="Put the chat away" className="grid h-9 flex-none place-items-center">
                  <span aria-hidden className="h-1 w-10 rounded-full bg-line" />
                </button>
                <div className="flex min-h-0 flex-1 flex-col pb-2">{chatPanel}</div>
              </div>
            )}
          </div>

          {/* A room that is shut: why, over the room. */}
          {phase.t === "closed" && <ClosedCard reason={phase.reason} place={place} onRetry={retry} onBack={() => router.push("/")} />}
        </div>

        {/* A wide screen: the chat is a column beside the room. */}
        <aside className="hidden w-[360px] flex-none flex-col border-l border-line bg-ink-2 lg:flex">
          <div className="flex min-h-0 flex-1 flex-col pb-3">{chatPanel}</div>
        </aside>
      </div>

      <RewardMoment reward={reward} />
      {phase.t === "adult" && <AdultSheet place={place} onYes={retry} onNo={() => router.push("/")} />}
      {person && phase.t === "in" && (
        <HeadCard
          person={person}
          onClose={() => setPerson(null)}
          onBlocked={(key) => {
            chat.hide(key);
            void readAgain();
          }}
        />
      )}
    </div>
  );
}

function ClosedCard({ reason, place, onRetry, onBack }: { reason: string; place: string; onRetry: () => void; onBack: () => void }) {
  const c = closedCopy(reason, place);
  return (
    <div role="status" className="absolute inset-x-3 top-3 z-20 mx-auto max-w-[420px] rounded-[12px] border border-line bg-ink-2 px-4 py-3 shadow-sheet">
      <h2 className="font-display text-[18px] font-black leading-tight">{c.title}</h2>
      <p className="hint mt-1">{c.body}</p>
      <div className="mt-3 flex gap-2">
        {c.retry && (
          <button type="button" className="btn flex-1" onClick={onRetry}>
            Try again
          </button>
        )}
        <button type="button" className={clsx("btn flex-1", c.retry && "btn-ghost")} onClick={onBack}>
          Back to the map
        </button>
      </div>
    </div>
  );
}
