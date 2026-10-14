"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Copy, DoorOpen, Flame, MapPin, MessageCircle, RefreshCw, Share2, Users } from "lucide-react";
import { FaceDisc } from "@/components/Avatar";
import ChatFace from "@/components/chat/ChatFace";
import LoadingStub from "@/components/app/LoadingStub";
import PageHeader from "@/components/app/PageHeader";
import VerifiedBadge from "@/components/VerifiedBadge";
import { requireAccount } from "@/lib/accountGate";
import { inviteLink, shareInvite, useCrewCard, useCrewEvents, type CrewCard } from "@/lib/crew-room/hub";
import { dayLabel } from "@/lib/filters";
import { useHotspots } from "@/lib/hotspots/useHotspots";
import { useHoppaz, useToast } from "@/lib/store";
import { getSupabase } from "@/lib/supabase/client";

/**
 * One crew as a place to start from (/crew/<id>): who is in its room right now, the way in, the last few General
 * messages, and tiles out into the rest of Hoppaz (the crew's next events on the map, the nearest hotspots, tonight's
 * deck, other crews). Open crews can be looked at by anyone; joining needs an account.
 */
export default function CrewHub({ crewId }: { crewId: string }) {
  const { card, state, reload } = useCrewCard({ crewId });

  if (state === "loading" && !card) {
    return (
      <div className="h-full px-4 pt-16">
        <LoadingStub label="Loading the crew" lines={2} />
      </div>
    );
  }
  if (!card) {
    return (
      <div className="h-full overflow-y-auto px-4 pb-6">
        <PageHeader title="Crew" back="/crew" />
        <p className="font-display text-[19px] font-black leading-tight">
          {state === "offline" ? "This crew could not load." : "This crew is private."}
        </p>
        <p className="hint mt-1.5">
          {state === "offline" ? "Check your connection and try again." : "Ask someone in it for their invite link."}
        </p>
        <Link href="/crew" className="btn btn-ghost mt-4">
          YOUR CREWS
        </Link>
      </div>
    );
  }
  return <Hub card={card} onChange={reload} />;
}

function Hub({ card, onChange }: { card: CrewCard; onChange: () => void }) {
  const router = useRouter();
  const say = useToast((s) => s.say);
  const [busy, setBusy] = useState(false);
  const room = `/crew/${card.id}/room`;

  const join = async () => {
    const sb = getSupabase();
    if (!sb || busy) return;
    setBusy(true);
    // Ola's join: an open crew joins by its id.
    const { data } = await sb.rpc("join_crew", { p_invite: card.id });
    setBusy(false);
    if (!data) return say("Couldn't join. Try again.", "error");
    say("You're in the crew.", "ok");
    router.push(room);
  };

  const invite = async () => {
    if (!card.invite_code) return;
    const how = await shareInvite(card.brand, card.invite_code);
    if (how === "copied") say("Invite link copied.", "ok");
    else if (how === "failed") say("Couldn't share. Copy the link below.", "error");
  };

  return (
    <div className="h-full overflow-y-auto px-4 pb-6">
      <PageHeader title="Crew" back="/crew" />

      <section className="card mb-4" aria-label={`${card.brand}, now`}>
        <p className="seclabel">{card.verified ? "BRAND CREW" : card.visibility === "open" ? "OPEN CREW" : "PRIVATE CREW"}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 truncate font-display text-[28px] font-black leading-tight">{card.brand}</h1>
          {card.verified && <VerifiedBadge size={22} />}
        </div>
        <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-dim">
          <Users size={12} aria-hidden /> {card.members} {card.members === 1 ? "member" : "members"}
        </p>

        <RoomNow card={card} />

        {card.is_member ? (
          <Link href={room} className="btn mt-4 w-full text-[15px]">
            <DoorOpen size={18} aria-hidden /> ENTER ROOM
          </Link>
        ) : (
          <button
            type="button"
            className="btn mt-4 w-full text-[15px]"
            disabled={busy || card.visibility !== "open"}
            onClick={() => {
              if (requireAccount("join this crew", () => void join())) void join();
            }}
          >
            <DoorOpen size={18} aria-hidden /> {busy ? "JOINING…" : card.visibility === "open" ? "JOIN AND WALK IN" : "INVITE ONLY"}
          </button>
        )}
        {card.is_owner && card.invite_code && <InviteTools card={card} onShare={invite} onReset={onChange} />}
      </section>

      {card.is_member && <RecentChat card={card} />}
      <Explore card={card} />
    </div>
  );
}

/** "N in the room now", with their faces. Refreshed with the card, every 15 s. */
function RoomNow({ card }: { card: CrewCard }) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-hz border border-line px-3 py-2.5" data-room-now={card.in_room}>
      {card.heads.length > 0 && (
        <span className="flex flex-none">
          {card.heads.slice(0, 5).map((h, i) => (
            <FaceDisc key={h.id} look={h.look} initial={h.name} size={30} className={i ? "-ml-2.5 ring-2 ring-ink-2" : "ring-2 ring-ink-2"} />
          ))}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <b className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
          {card.in_room > 0 && <span aria-hidden className="h-2 w-2 flex-none animate-pulse2 rounded-full bg-keke" />}
          {card.in_room > 0 ? `${card.in_room} in the room now` : "Nobody in the room yet"}
        </b>
        <span className="hint block truncate">
          {card.in_room > 0 ? card.heads.slice(0, 3).map((h) => h.name).join(", ") : "Walk in first and the music starts with you."}
        </span>
      </span>
    </div>
  );
}

/** The owner's invite: share the link, copy it, or make a new one (the old link stops working). */
function InviteTools({ card, onShare, onReset }: { card: CrewCard; onShare: () => void; onReset: () => void }) {
  const say = useToast((s) => s.say);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const link = inviteLink(card.invite_code ?? "");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      say("Invite link copied.", "ok");
    } catch {
      say("Couldn't copy. Hold the link to copy it.", "error");
    }
  };

  const reset = async () => {
    const sb = getSupabase();
    if (!sb || busy) return;
    setBusy(true);
    const { error } = await sb.rpc("crew_invite_reset", { p_crew: card.id });
    setBusy(false);
    setConfirming(false);
    if (error) return say("Couldn't make a new link. Try again.", "error");
    say("New invite link made. The old one no longer works.", "ok");
    onReset();
  };

  return (
    <div className="mt-3 rounded-hz border border-dashed border-line px-3 py-2.5">
      <p className="seclabel">Invite link</p>
      <p className="mt-0.5 select-all break-all font-mono text-[12px] text-cream" data-invite-link={link}>
        {link}
      </p>
      <div className="mt-2.5 flex gap-2">
        <button type="button" className="btn flex-1 px-3" onClick={onShare}>
          <Share2 size={15} aria-hidden /> INVITE
        </button>
        <button type="button" className="btn btn-ghost flex-none px-3 text-[12px]" onClick={copy} aria-label="Copy the invite link">
          <Copy size={14} aria-hidden /> COPY
        </button>
        <button
          type="button"
          className="btn btn-ghost flex-none px-3 text-[12px]"
          onClick={() => setConfirming((v) => !v)}
          aria-expanded={confirming}
          aria-label="Make a new invite link"
        >
          <RefreshCw size={14} aria-hidden />
        </button>
      </div>
      {confirming && (
        <div className="mt-2.5">
          <p className="hint">A new link stops the old one working. Anyone already in the crew stays in.</p>
          <button type="button" className="btn btn-ghost mt-2 w-full" disabled={busy} onClick={reset}>
            {busy ? "ONE SEC…" : "MAKE A NEW LINK"}
          </button>
        </div>
      )}
    </div>
  );
}

/** The last few General messages. A tap opens the room with the chat open. */
function RecentChat({ card }: { card: CrewCard }) {
  return (
    <Link href={`/crew/${card.id}/room?chat=1`} className="card mb-4 block" aria-label="Open the crew chat in the room">
      <div className="flex items-center justify-between gap-2">
        <p className="seclabel">General chat</p>
        <span className="flex items-center gap-1 font-mono text-[10px] font-medium tracking-[0.12em] text-orange">
          <MessageCircle size={12} aria-hidden /> OPEN →
        </span>
      </div>
      {card.recent.length === 0 ? (
        <p className="hint mt-2">No messages yet. Walk in and say hi.</p>
      ) : (
        card.recent.map((m) => (
          <div key={m.id} className="mt-2.5 flex items-start gap-2.5">
            <ChatFace look={m.author_look} size={26} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[10px] uppercase tracking-[0.1em] text-dim">{m.author_name}</span>
              <span className="line-clamp-2 block font-body text-[14px] leading-snug">{m.body}</span>
            </span>
          </div>
        ))
      )}
    </Link>
  );
}

type Tile = { href: string; key: string; Icon: typeof MapPin; kicker: string; title: string; line?: string };

/** Out into the app: the crew's events on the map, the nearest hotspots, tonight's deck, other crews. */
function Explore({ card }: { card: CrewCard }) {
  const fix = useHoppaz((s) => s.fix);
  const { events, matched } = useCrewEvents(card.keywords, 3);
  const hotspots = useHotspots({ active: true, at: fix });
  const [crews, setCrews] = useState<{ id: string; name: string; verified?: boolean }[]>([]);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    void sb
      .from("crews")
      .select("*")
      .eq("visibility", "open")
      .neq("id", card.id)
      .limit(24)
      .then(({ data }) => {
        if (!live) return;
        const rows = (data ?? []) as { id: string; name: string; verified?: boolean }[];
        setCrews(rows.sort((a, b) => Number(!!b.verified) - Number(!!a.verified)).slice(0, 4));
      });
    return () => {
      live = false;
    };
  }, [card.id]);

  const tiles: Tile[] = [
    ...events.map((e) => ({
      href: `/?e=${e.id}`,
      key: `e-${e.id}`,
      Icon: CalendarDays,
      kicker: `${matched ? "CREW EVENT" : "BIG THIS WEEK"} · ${dayLabel(e.starts_at)}`,
      title: e.title,
      line: e.venue_name,
    })),
    ...hotspots.row.slice(0, 2).map((h) => {
      const m = hotspots.metres(h);
      return {
        href: `/?hotspot=${h.slug}`,
        key: `h-${h.slug}`,
        Icon: MapPin,
        kicker: `HOTSPOT${m != null ? ` · ${m < 1000 ? `${Math.round(m / 50) * 50} M` : `${(m / 1000).toFixed(1)} KM`}` : ""}`,
        title: h.name,
        line: h.zoneLabel,
      };
    }),
    { href: "/discover", key: "tonight", Icon: Flame, kicker: "TONIGHT IN LAGOS", title: "Swipe through tonight", line: "Every event on, one card at a time" },
    ...crews.map((c) => ({ href: `/crew/${c.id}`, key: `c-${c.id}`, Icon: Users, kicker: c.verified ? "BRAND CREW" : "OPEN CREW", title: c.name })),
  ];

  return (
    <section aria-label="Explore from here">
      <p className="seclabel mb-2">Explore from here</p>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map(({ href, key, Icon, kicker, title, line }) => (
          <Link
            key={key}
            href={href}
            data-explore={key}
            className="card flex min-h-[112px] flex-col gap-1 p-3 transition-colors active:bg-ink-3"
          >
            <Icon size={16} className="text-orange" aria-hidden />
            <span className="mt-1 font-mono text-[10px] uppercase leading-tight tracking-[0.08em] text-dim">{kicker}</span>
            <b className="line-clamp-2 font-display text-[15px] font-semibold leading-tight">{title}</b>
            {line && <span className="hint line-clamp-1">{line}</span>}
          </Link>
        ))}
      </div>
    </section>
  );
}
