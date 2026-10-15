"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Footprints, Hand, User, UserPlus } from "lucide-react";
import { FaceDisc } from "@/components/Avatar";
import ChatFace from "@/components/chat/ChatFace";
import Sheet from "@/components/Sheet";
import { sentence } from "@/components/event/copy";
import { addToCrew, blockPerson, reportThing } from "@/lib/chat";
import { canWalkScene, type CampaignLayout } from "@/lib/campaign/layout";
import { useRoomStore, type RoomPeerPoint } from "@/lib/crew-room/roomStore";
import { COOLDOWN_MS, VIBES, sayHi, sayResult, sendVibe, useVibes, vibeBlocked, type VibeId } from "@/lib/crew-room/vibes";
import { getSupabase } from "@/lib/supabase/client";
import { useToast } from "@/lib/store";
import { useSessionStore } from "@/lib/useSession";
import { VibeArt } from "./VibeLayer";
import css from "./HopperMenu.module.css";

/**
 * The small menu that opens on a Hopper you tap: VIBE, SAY HI, WALK TO, PROFILE (design section 8).
 *
 * SCREEN CHROME, owned by SOCIAL. Mounted by CampaignExperience over the room, outside the scaled world, in screen px.
 * Reads useRoomStore tappedPeer, peers, me, walkTo, sheet; clears with setTappedPeer(null). It finds the tapped avatar on
 * screen through the world's `[data-room-peer="<user id>"]` element, tracks it every frame (the camera moves), sits
 * above their head and flips below when there is no room, and clamps inside the room with an 8 px margin.
 *
 *   VIBE     five drawn stickers. Press shows the name, release on it sends, sliding off cancels. Limits are the server's
 *            (1 per 3 s with a ring on the chips, 3 a minute to one person, 12 a minute); a refusal speaks on the label row.
 *   SAY HI   the existing wave: wave(key) when the peer has a room key, otherwise crew_room_wave (supabase/crew_rails.sql).
 *            Mutual: "YOU'RE CONNECTED" with OPEN DM in the hint chip. Never opens the DM by itself.
 *   WALK TO  walks to a free tile next to them (roomStore walkTo) and sends the camera to follow me.
 *   PROFILE  a sheet: SAY HI, ADD TO CREW, Block, Report, through the person's room key (crew_room_peer_key).
 * Closes on a choice, an outside tap, my own walking, the chat sheet changing, Escape, or 8 s of nothing.
 *
 * This file also draws the room's one HINT chip (useVibes hint): "WAVED AT ADA", "ADA WAVED AT YOU" + WAVE BACK,
 * "YOU'RE CONNECTED" + OPEN DM, "ADA VIBED YOU", and the refusals. It rides above the bottom row (--room-bottom).
 */
export type HopperMenuProps = { crewId: string; layout: CampaignLayout };

const IDLE_MS = 8000;
const MARGIN = 8;
const TAIL_GAP = 10;

const REASONS = ["Harassment or threats", "Sexual or unwanted advances", "Spam or selling", "Hate or abuse", "Something else"];

export default function HopperMenu({ crewId, layout }: HopperMenuProps) {
  const router = useRouter();
  const layer = useRef<HTMLDivElement>(null);
  const tapped = useRoomStore((s) => s.tappedPeer);
  const peers = useRoomStore((s) => s.peers);
  const watching = useRoomStore((s) => s.me === null);
  const sheet = useRoomStore((s) => s.sheet);
  const [profile, setProfile] = useState<RoomPeerPoint | null>(null);
  const peer = peers.find((p) => p.id === tapped) ?? null;

  const close = useCallback(() => useRoomStore.getState().setTappedPeer(null), []);
  const openDm = useCallback((dm: string) => router.push(`/chat/dm/${dm}`), [router]);

  // A person who walked out, or a chat sheet that opened, ends the menu.
  useEffect(() => {
    if (tapped && !peer) close();
  }, [tapped, peer, close]);
  // The chat sheet may already be up (peek or half) when I tap someone above it: the room is still alive over the sheet, so the
  // menu opens. It ends only when the sheet changes after that (opened, pulled up, closed).
  const sheetAtTap = useRef(sheet);
  useEffect(() => {
    if (tapped) sheetAtTap.current = useRoomStore.getState().sheet;
  }, [tapped]);
  useEffect(() => {
    if (tapped && sheet !== sheetAtTap.current) close();
  }, [tapped, sheet, close]);

  return (
    <div ref={layer} className={css.layer}>
      {peer && <Menu key={peer.id} crewId={crewId} layout={layout} peer={peer} layerRef={layer} watching={watching} onClose={close} onProfile={() => setProfile(peer)} openDm={openDm} />}
      <HintChip />
      {profile && <ProfileSheet crewId={crewId} peer={profile} onClose={() => setProfile(null)} openDm={openDm} />}
    </div>
  );
}

// ------------------------------------------------------------------ the menu --
function Menu({
  crewId,
  layout,
  peer,
  layerRef,
  watching,
  onClose,
  onProfile,
  openDm,
}: {
  crewId: string;
  layout: CampaignLayout;
  peer: RoomPeerPoint;
  layerRef: React.RefObject<HTMLDivElement | null>;
  watching: boolean;
  onClose: () => void;
  onProfile: () => void;
  openDm: (dm: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<VibeId | null>(null);
  const [note, setNote] = useState("");
  const cooldownUntil = useVibes((s) => s.cooldownUntil);
  const waved = useVibes((s) => !!s.waved[peer.id]);
  const [, tick] = useState(0);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef(useRoomStore.getState().me);
  const peerRef = useRef(peer);
  peerRef.current = peer;

  const wake = useCallback(() => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(onClose, IDLE_MS);
  }, [onClose]);
  useEffect(() => {
    wake();
    return () => {
      if (idle.current) clearTimeout(idle.current);
    };
  }, [wake]);

  // The ring on the chips runs for as long as the cooldown lasts, then the chips wake up.
  const cooling = cooldownUntil > Date.now();
  useEffect(() => {
    if (!cooling) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(50, cooldownUntil - Date.now()) + 30);
    return () => clearTimeout(t);
  }, [cooling, cooldownUntil]);

  // An outside tap, Escape, or my own walking closes it.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (box.current && e.target instanceof Node && !box.current.contains(e.target)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    const unsubscribe = useRoomStore.subscribe((s) => {
      const was = start.current;
      if (s.me && was && (s.me.x !== was.x || s.me.y !== was.y)) onClose();
    });
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
      unsubscribe();
    };
  }, [onClose]);

  // Follow their avatar on screen: above the head, flipped below when it does not fit, clamped inside the room.
  useEffect(() => {
    let raf = 0;
    const place = () => {
      const el = box.current;
      const host = layerRef.current;
      if (el && host) {
        const h = host.getBoundingClientRect();
        const target = document.querySelector<HTMLElement>(`[data-room-peer="${CSS.escape(peerRef.current.id)}"]`);
        const t = target?.getBoundingClientRect();
        const w = el.offsetWidth;
        const ht = el.offsetHeight;
        const cx = t ? t.left + t.width / 2 - h.left : h.width / 2;
        const headTop = t ? t.top - h.top : h.height * 0.45;
        const feet = t ? t.bottom - h.top : h.height * 0.45 + 40;
        let left = cx - w / 2;
        let top = headTop - ht - TAIL_GAP;
        const flip = top < MARGIN;
        if (flip) top = feet + TAIL_GAP;
        left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, h.width - MARGIN - w));
        top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, h.height - MARGIN - ht));
        el.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
        el.style.setProperty("--tx", `${Math.min(Math.max(cx - left, 22), w - 22).toFixed(1)}px`);
        el.dataset.flip = flip ? "1" : "";
        el.style.visibility = "visible";
      }
      raf = requestAnimationFrame(place);
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [layerRef]);

  const me = useSessionStore((s) => s.userId);
  const zoneName = (() => {
    const z = layout.zones.find((zone) => peer.x >= zone.x && peer.x < zone.x + zone.w && peer.y >= zone.y && peer.y < zone.y + zone.h);
    return z ? `AT ${z.name.replace(/^The /, "").toUpperCase()}` : "IN THE ROOM";
  })();

  const vibe = (id: VibeId) => {
    wake();
    const no = vibeBlocked(peer.id);
    if (no || !me) {
      setNote(no ?? "SIGN IN TO VIBE");
      return;
    }
    onClose();
    void sendVibe(crewId, me, peer.id, id).then((r) => {
      if (!r.ok) useVibes.getState().say(r.text, 3000);
    });
  };

  const hi = () => {
    onClose();
    void sayHi(crewId, peer).then((r) => sayResult(r, openDm));
  };

  const walk = () => {
    const { walkTo, me: mine, peers: others } = useRoomStore.getState();
    if (walkTo && mine) {
      const spots = [
        [0, 1], [1, 0], [-1, 0], [0, -1],
        [1, 1], [-1, 1], [1, -1], [-1, -1],
      ]
        .map(([dx, dy]) => ({ x: peer.x + dx, y: peer.y + dy }))
        .filter((t) => canWalkScene(layout, t) && !others.some((o) => o.x === t.x && o.y === t.y));
      const best = spots.sort((a, b) => Math.abs(a.x - mine.x) + Math.abs(a.y - mine.y) - (Math.abs(b.x - mine.x) + Math.abs(b.y - mine.y)))[0];
      if (best) {
        useRoomStore.getState().setView("me");
        walkTo(best.x, best.y);
      }
    }
    onClose();
  };

  const label = note || (preview ? VIBES.find((v) => v.id === preview)!.label : "VIBE");

  return (
    <div
      ref={box}
      className={css.menu}
      role="dialog"
      aria-label={`Actions for ${peer.name}`}
      onPointerDown={wake}
      data-hopper-menu={peer.id}
    >
      <div className={`${css.face} animate-stamp`}>
        <header className={css.head}>
          <FaceDisc look={peer.look} initial={peer.name} size={28} />
          <b className={css.name}>{peer.name}</b>
          <span className={css.where}>{zoneName}</span>
        </header>
        <p className={css.label} data-note={note ? "1" : undefined} aria-live="polite">
          {label}
        </p>
        <div className={css.stickers} role="group" aria-label="Send a vibe">
          {VIBES.map((v) => (
            <button
              key={v.id}
              type="button"
              className={css.chip}
              aria-label={`${v.label} vibe`}
              data-cool={cooling ? "1" : undefined}
              onPointerDown={() => {
                setNote("");
                setPreview(v.id);
              }}
              onPointerUp={() => setPreview(null)}
              onPointerLeave={() => setPreview(null)}
              onPointerCancel={() => setPreview(null)}
              onClick={() => vibe(v.id)}
            >
              <VibeArt id={v.id} size={36} />
              {cooling && (
                <svg className={css.ring} viewBox="0 0 44 44" aria-hidden key={cooldownUntil}>
                  <rect x="1.5" y="1.5" width="41" height="41" rx="10" pathLength={1} style={{ animationDuration: `${COOLDOWN_MS}ms` }} />
                </svg>
              )}
            </button>
          ))}
        </div>
        <div className={css.actions}>
          <button type="button" className={`btn ${css.act}`} onClick={hi} disabled={waved} aria-label={waved ? "Already waved" : `Say hi to ${peer.name}`}>
            <Hand size={15} aria-hidden />
            {waved ? "WAVED" : "SAY HI"}
          </button>
          {!watching && (
            <button type="button" className={`btn btn-ghost ${css.act}`} onClick={walk}>
              <Footprints size={15} aria-hidden />
              WALK TO
            </button>
          )}
          <button
            type="button"
            className={`btn btn-ghost ${css.act}`}
            onClick={() => {
              onProfile();
              onClose();
            }}
          >
            <User size={15} aria-hidden />
            PROFILE
          </button>
        </div>
        <i className={css.tail} aria-hidden />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the chip --
function HintChip() {
  const hint = useVibes((s) => s.hint);
  if (!hint) return null;
  return (
    <div className={css.hintRow} key={hint.id}>
      <div className={`${css.hint} animate-stamp`} role="status">
        <span className={css.hintText}>{hint.text}</span>
        {hint.action && (
          <button
            type="button"
            className={css.hintAction}
            onClick={() => {
              hint.action?.onPress();
            }}
          >
            {hint.action.label}
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ profile --
function ProfileSheet({ crewId, peer, onClose, openDm }: { crewId: string; peer: RoomPeerPoint; onClose: () => void; openDm: (dm: string) => void }) {
  const say = useToast((s) => s.say);
  const [key, setKey] = useState<string | null>(peer.key ?? null);
  const [step, setStep] = useState<"actions" | "block" | "report">("actions");
  const [busy, setBusy] = useState(false);
  const waved = useVibes((s) => !!s.waved[peer.id]);

  // Block, report and add work on an opaque room key; fetch the crew mate's once.
  useEffect(() => {
    if (key) return;
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    void sb.rpc("crew_room_peer_key", { p_crew: crewId, p_peer: peer.id }).then(({ data }) => {
      if (live && typeof data === "string") setKey(data);
    });
    return () => {
      live = false;
    };
  }, [key, crewId, peer.id]);

  const hi = async () => {
    setBusy(true);
    const r = await sayHi(crewId, peer);
    setBusy(false);
    onClose();
    sayResult(r, openDm);
  };
  const add = async () => {
    if (!key) return;
    setBusy(true);
    const r = await addToCrew(key);
    setBusy(false);
    say(sentence(r.text), r.ok ? "ok" : "error");
    onClose();
  };
  const block = async () => {
    if (!key) return;
    setBusy(true);
    const ok = await blockPerson({ key }, peer.name);
    setBusy(false);
    say(ok ? "Blocked." : "Couldn't block them. Try again.", ok ? "ok" : "error");
    onClose();
  };
  const report = async (reason: string) => {
    if (!key) return;
    setBusy(true);
    const ok = await reportThing("person", key, reason);
    setBusy(false);
    say(ok ? "Reported. The Hoppaz crew will look at it." : "Couldn't send the report. Try again.", ok ? "ok" : "error");
    onClose();
  };

  return (
    <div className={css.sheetHost}>
      <div className="absolute inset-0 z-[39] bg-ink/60" onClick={onClose} aria-hidden />
      <Sheet open onClose={onClose} label={peer.name}>
        <div className="flex items-center gap-3 pr-10">
          <ChatFace look={peer.look} size={48} />
          <div className="min-w-0 flex-1">
            <p className="font-display text-base font-black leading-tight">{peer.name}</p>
            <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-dim">IN THE ROOM NOW</p>
          </div>
        </div>
        {step === "actions" && (
          <div className="mt-4">
            <div className="flex flex-col gap-2">
              <button type="button" className="btn w-full" onClick={hi} disabled={busy || waved}>
                <Hand size={15} aria-hidden /> {waved ? "WAVED" : "SAY HI"}
              </button>
              <button type="button" className="btn btn-ghost w-full" onClick={add} disabled={busy || !key}>
                <UserPlus size={15} aria-hidden /> ADD TO CREW
              </button>
            </div>
            <div className="mt-1 flex items-center justify-center gap-2">
              <button type="button" className="min-h-[44px] px-4 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-fireant disabled:opacity-50" onClick={() => setStep("block")} disabled={busy || !key}>
                Block
              </button>
              <span aria-hidden className="h-4 w-px bg-line" />
              <button type="button" className="min-h-[44px] px-4 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-dim disabled:opacity-50" onClick={() => setStep("report")} disabled={busy || !key}>
                Report
              </button>
            </div>
          </div>
        )}
        {step === "block" && (
          <div className="mt-4 rounded-hz border border-line bg-ink-3 p-3">
            <p className="font-display text-sm font-black">Block {peer.name}?</p>
            <p className="hint mt-0.5">You won&apos;t see each other in rooms, waves or DMs.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-ghost border-fireant text-fireant" onClick={block} disabled={busy}>
                BLOCK
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setStep("actions")} disabled={busy}>
                CANCEL
              </button>
            </div>
          </div>
        )}
        {step === "report" && (
          <div className="mt-4">
            <p className="label">What happened</p>
            <div className="flex flex-col gap-1.5">
              {REASONS.map((r) => (
                <button key={r} type="button" className="btn btn-ghost justify-start" onClick={() => report(r)} disabled={busy}>
                  {r}
                </button>
              ))}
            </div>
            <button type="button" className="mt-1 min-h-[44px] font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-dim" onClick={() => setStep("actions")} disabled={busy}>
              Back
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
