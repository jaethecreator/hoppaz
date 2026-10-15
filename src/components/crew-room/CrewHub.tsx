"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, DoorOpen, Flame, MapPin, MessageCircle, Settings2, Share2, TrendingUp, Users, type LucideIcon } from "lucide-react";
import ChatFace from "@/components/chat/ChatFace";
import LoadingStub from "@/components/app/LoadingStub";
import PageHeader from "@/components/app/PageHeader";
import HubHeader, { CrewLogo } from "@/components/crew-room/HubHeader";
import ManageCrew from "@/components/crew-room/ManageCrew";
import HubGameTime from "@/components/game-time/HubGameTime";
import Featured from "@/components/crew-room/CrewHubFeatured";
import RoomNow from "@/components/crew-room/CrewHubNow";
import { requireAccount } from "@/lib/accountGate";
import { shareInvite, useCrewCard, useCrewEvents, useRails, type CrewCard } from "@/lib/crew-room/hub";
import { dayLabel } from "@/lib/filters";
import { useHotspots } from "@/lib/hotspots/useHotspots";
import { useHoppaz, useToast } from "@/lib/store";
import { getSupabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/useSession";

/**
 * One crew as a place to start from (/crew/<id>), inside the app with its bottom nav. A header that swipes through the
 * crew's pictures, the name with its tick and the round logo, who is in the room right now, the way in, the owner's
 * MANAGE CREW, the last few General messages, and tiles out into the rest of Hoppaz. Open crews can be looked at by
 * anyone; joining needs an account.
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
  const [managing, setManaging] = useState(false);
  // Starts the session store: JOIN asks it whether this Hopper has an account, so it must be up before the tap.
  const { state: session } = useSession();
  const room = `/crew/${card.id}/room`;

  // /crew/<id>?manage=1 opens the dashboard straight away (the owner's own bookmark).
  useEffect(() => {
    if (card.is_owner && new URLSearchParams(window.location.search).get("manage") === "1") setManaging(true);
  }, [card.is_owner]);

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
    else if (how === "failed") say("Couldn't share. Open MANAGE CREW to copy the link.", "error");
  };

  return (
    <div className="relative h-full">
      <div className="h-full overflow-y-auto pb-6" data-hub-scroll>
        <div className="mx-auto w-full max-w-[760px]">
          <HubHeader
            images={card.header_images}
            title={card.brand}
            verified={card.verified}
            logoUrl={card.logo_url}
            kicker={card.verified ? "BRAND CREW" : card.visibility === "open" ? "OPEN CREW" : "PRIVATE CREW"}
            back="/crew"
            meta={
              <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-dim" data-members={card.members}>
                <Users size={12} aria-hidden /> {card.members} {card.members === 1 ? "member" : "members"}
              </p>
            }
          />

          <div className="px-4">
            <div className="mt-4"><RoomNow card={card} /></div>
            <HubGameTime crewId={card.id} isMember={card.is_member} />

            <div className="mt-3 flex gap-2">
              {card.is_member ? (
                <>
                  <Link href={room} className="btn min-w-0 flex-1 text-[15px]" data-enter-room>
                    <DoorOpen size={18} aria-hidden /> ENTER ROOM
                  </Link>
                  {card.invite_code && (
                    <button type="button" className="btn btn-ghost flex-none px-4 text-[13px]" onClick={invite} data-invite>
                      <Share2 size={16} aria-hidden /> INVITE
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="btn w-full text-[15px]"
                  disabled={busy || session === "loading" || card.visibility !== "open"}
                  data-join
                  onClick={() => {
                    if (requireAccount("join this crew")) void join();
                  }}
                >
                  <DoorOpen size={18} aria-hidden /> {busy ? "JOINING…" : card.visibility === "open" ? "JOIN AND WALK IN" : "INVITE ONLY"}
                </button>
              )}
            </div>

            {card.is_owner && (
              <button type="button" className="btn btn-ghost mt-2 w-full" onClick={() => setManaging(true)} data-manage-open>
                <Settings2 size={16} aria-hidden /> MANAGE CREW
              </button>
            )}

            <Featured card={card} />
            {card.is_member && <RecentChat card={card} />}
            <Explore card={card} />
          </div>
        </div>
      </div>
      {managing && card.is_owner && <ManageCrew card={card} onClose={() => setManaging(false)} onChange={onChange} />}
    </div>
  );
}

/** The last few General messages. A tap opens the room with the chat open. */
function RecentChat({ card }: { card: CrewCard }) {
  return (
    <Link href={`/crew/${card.id}/room?chat=1`} className="card mt-4 block" aria-label="Open the crew chat in the room">
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

type Tile = { href: string; key: string; Icon?: LucideIcon; logo?: { url: string | null; name: string }; kicker: string; title: string; line?: string };

/**
 * Out into the app: the crew's events, what is trending this week, the nearest hotspots, tonight's deck, other crews.
 * An event opens the map on it (/?e=<id>); a crew opens its own hub.
 */
function Explore({ card }: { card: CrewCard }) {
  const fix = useHoppaz((s) => s.fix);
  const { events, matched } = useCrewEvents(card.keywords, 3);
  const rails = useRails(card.id);
  const hotspots = useHotspots({ active: true, at: fix });

  const seen = new Set<string>(card.featured_event ? [card.featured_event.id] : []);
  const crewEvents = events.filter((e) => !seen.has(e.id));
  crewEvents.forEach((e) => seen.add(e.id));
  const trending = rails.trending.filter((e) => !seen.has(e.id)).slice(0, 2);

  const tiles: Tile[] = [
    ...crewEvents.map((e) => ({
      href: `/?e=${e.id}`,
      key: `e-${e.id}`,
      Icon: CalendarDays,
      kicker: `${matched ? "CREW EVENT" : "BIG THIS WEEK"} · ${dayLabel(e.starts_at)}`,
      title: e.title,
      line: e.venue_name,
    })),
    ...trending.map((e) => ({
      href: `/?e=${e.id}`,
      key: `t-${e.id}`,
      Icon: TrendingUp,
      kicker: e.going > 0 ? `TRENDING · ${e.going} GOING` : `THIS WEEK · ${dayLabel(e.starts_at)}`,
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
    ...rails.crews.slice(0, 4).map((c) => ({
      href: `/crew/${c.id}`,
      key: `c-${c.id}`,
      logo: { url: c.logo_url, name: c.name },
      kicker: `${c.verified ? "BRAND CREW" : "OPEN CREW"} · ${c.members} ${c.members === 1 ? "MEMBER" : "MEMBERS"}`,
      title: c.name,
    })),
  ];

  return (
    <section aria-label="Explore from here" className="mt-5">
      <p className="seclabel mb-2">Explore from here</p>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map(({ href, key, Icon, logo, kicker, title, line }) => (
          <Link
            key={key}
            href={href}
            data-explore={key}
            className="card flex min-h-[112px] flex-col gap-1 p-3 transition-colors active:bg-ink-3 [&:nth-child(odd):last-child]:col-span-2"
          >
            {logo ? <CrewLogo url={logo.url} name={logo.name} size={28} className="!border-[2px]" /> : Icon && <Icon size={16} className="text-orange" aria-hidden />}
            <span className="mt-1 font-mono text-[10px] uppercase leading-tight tracking-[0.08em] text-dim">{kicker}</span>
            <b className="line-clamp-2 font-display text-[15px] font-semibold leading-tight">{title}</b>
            {line && <span className="hint line-clamp-1">{line}</span>}
          </Link>
        ))}
      </div>
    </section>
  );
}
