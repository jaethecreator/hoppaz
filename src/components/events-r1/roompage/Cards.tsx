"use client";

import Link from "next/link";
import clsx from "clsx";
import { useQuests } from "@/lib/game";
import { useR1Auth, useViewerState } from "@/lib/events-r1/hooks";
import { isListing, listedByLine, priceLine, ticketHref } from "@/lib/events-r1/listing";
import type { R1Event, RoomMember, RoomSummary } from "@/lib/events-r1/types";
import { TicketLink } from "../page/ListingParts";
import { Avatar, CARD, GHOST, LINK } from "./ui";
import { chip, dayShort, isNewRoom, showCount, whenCard, youAnd } from "./words";

const evHref = (e: R1Event) => `/event/${encodeURIComponent(e.slug || e.id)}`;

/** A small square picture for an event: its flyer, or a block in the tint with the date. */
function Cover({ e, size }: { e: R1Event; size: number }) {
  const url = e.flyer_url;
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- an event flyer from our own storage
    return <img src={url} alt="" width={size} height={size} className="flex-none rounded-hz object-cover" style={{ width: size, height: size }} />;
  }
  const c = chip(e.starts_at);
  return (
    <span className="grid flex-none place-items-center rounded-hz bg-t-soft text-center font-display font-extrabold leading-tight" style={{ width: size, height: size }} aria-hidden>
      <span className="text-[10px] text-t-muted">{c.mon}</span>
      <span className="-mt-1 text-[20px]">{c.day}</span>
    </span>
  );
}

/** The room's next event: when, where, how many are going, and the way to a ticket. */
export function NextEvent({ event, room, now }: { event: R1Event | null; room: RoomSummary; now: number }) {
  const { data: viewer } = useViewerState(event?.id);
  if (!event) {
    return (
      <div className={CARD}>
        <span className="font-body text-[13px] font-bold">Next event</span>
        <p className="font-body text-[14px] text-t-muted">Nothing is planned yet. When {room.name} posts an event, it shows here first.</p>
      </div>
    );
  }
  const status = viewer?.registration?.status;
  const going = status === "going" || status === "checked_in";
  const place = event.kind === "online" ? "Online" : event.venue_name || event.area || "";
  // A listing is ticketed on the organiser's page: its price and where it is listed from, never a going count.
  const listing = isListing(event);
  const crowd = listing ? ` · ${priceLine(event)}` : !isNewRoom(room) && showCount(event.going) ? ` · ${event.going.toLocaleString("en-NG")} going` : "";
  return (
    <div className={CARD} data-next-event>
      <span className="font-body text-[13px] font-bold">Next event</span>
      <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3">
        <Cover e={event} size={64} />
        <div className="min-w-0">
          <span className="font-mono text-[11.5px] tracking-[0.04em] text-t-accent">{whenCard(event.starts_at, now)}</span>
          <b className="block font-body text-[15px] leading-snug">{event.title}</b>
          <small className="block font-body text-[13px] text-t-muted">{place}{crowd}</small>
          {listing && <small className="block font-body text-[12px] text-t-muted">{listedByLine(event)}</small>}
        </div>
      </div>
      {listing ? (
        ticketHref(event) ? <TicketLink event={event} className={clsx(GHOST, "w-full")} /> : <Link href={evHref(event)} className={clsx(GHOST, "w-full")}>See the event</Link>
      ) : (
        <Link href={evHref(event)} className={clsx(GHOST, "w-full")}>{going ? "You’re going · See ticket" : "Get a ticket"}</Link>
      )}
    </div>
  );
}

export function AboutCard({ room }: { room: RoomSummary }) {
  return (
    <div className={CARD}>
      <span className="font-body text-[13px] font-bold">About</span>
      <p className="font-body text-[14px]">{room.about || `${room.name} is a room on Hoppaz.`}</p>
      <span className="font-mono text-[12.5px] text-t-muted">hoppaz.fun/r/{room.slug}</span>
    </div>
  );
}

/** Names of the owner and admins, in the order the data gives them. */
export const hostNames = (members: RoomMember[] | null): string[] => (members ?? []).filter((m) => m.role === "owner" || m.role === "admin").map((m) => m.name);

export function MembersCard({ room, members, insider, onSeeAll }: { room: RoomSummary; members: RoomMember[] | null; insider: boolean; onSeeAll: () => void }) {
  const fresh = isNewRoom(room);
  const names = (members ?? []).map((m) => m.name);
  const rest = Math.max(0, room.members - 2);
  const line = fresh
    ? insider ? `${youAnd(room.members)} so far` : "A new room. Be one of the first in."
    : names.length >= 2 ? `${names[0]}, ${names[1]} and ${rest.toLocaleString("en-NG")} others` : `${room.members.toLocaleString("en-NG")} members`;
  const hosts = hostNames(members);
  return (
    <div className={CARD} data-members-card>
      <span className="flex items-center justify-between gap-2 font-body text-[13px] font-bold">
        Members
        {members && members.length > 0 && <button type="button" onClick={onSeeAll} className={clsx(LINK, "!min-h-[44px] text-[13px]")}>See all</button>}
      </span>
      {names.length > 0 && (
        <div className="flex">
          {names.slice(0, 6).map((n, i) => (
            <span key={n + i} className={clsx("rounded-full border-2 border-t-tile", i > 0 && "-ml-2")}><Avatar name={n} size={32} /></span>
          ))}
        </div>
      )}
      <p className="font-body text-[13.5px] text-t-muted">{line}</p>
      {hosts.length > 0 && <p className="font-body text-[13px]">Hosts: {hosts.join(", ")}</p>}
    </div>
  );
}

/** The first quest of the room's events, with the viewer's progress. Only drawn when quests are on. */
export function QuestCard({ eventIds, insider, onAll }: { eventIds: string[]; insider: boolean; onAll: () => void }) {
  const { user } = useR1Auth();
  const { quests, claims } = useQuests(user?.id ?? null);
  const mine = quests.filter((q) => q.event_id && eventIds.includes(q.event_id));
  const q = mine[0];
  const done = mine.filter((x) => claims[x.id]).length;
  return (
    <div className={CARD} data-quest-card>
      <span className="flex items-center justify-between gap-2 font-body text-[13px] font-bold">
        Room quest
        <button type="button" onClick={onAll} className={clsx(LINK, "text-[13px]")}>All quests</button>
      </span>
      {q ? (
        <div className="grid gap-1.5">
          <div className="flex justify-between gap-2 font-body text-[14px]">
            <b>{q.title}</b>
            <em className="font-mono text-[13px] not-italic text-t-accent">+{q.xp_reward} XP</em>
          </div>
          <span className="font-body text-[13px] text-t-muted">{q.description}</span>
          {insider ? (
            <>
              <div className="h-2 overflow-hidden rounded bg-t-soft"><i className="block h-full rounded bg-t-accent" style={{ width: `${(done / mine.length) * 100}%` }} /></div>
              <span className="font-body text-[12.5px] text-t-muted">{done} of {mine.length}</span>
            </>
          ) : (
            <span className="font-body text-[12.5px] text-t-muted">Join to start counting</span>
          )}
        </div>
      ) : (
        <p className="font-body text-[14px] text-t-muted">No quests yet. They show here when the room adds one.</p>
      )}
    </div>
  );
}

/** Empty board: nobody has checked in, and who can be first. */
export function Leaderboard({ next }: { next: R1Event | null }) {
  return (
    <p className="font-body text-[14px] text-t-muted" data-leaderboard>
      Nobody&apos;s on the board yet.{next ? ` Check in at ${next.title} to be first.` : ""}
    </p>
  );
}

export function LeaderboardCard({ next, onAll }: { next: R1Event | null; onAll: () => void }) {
  return (
    <div className={CARD}>
      <span className="flex items-center justify-between gap-2 font-body text-[13px] font-bold">
        Leaderboard
        <button type="button" onClick={onAll} className={clsx(LINK, "text-[13px]")}>See all</button>
      </span>
      <Leaderboard next={next} />
    </div>
  );
}

/* ------------------------------------------------------------- the tabs -- */

function Row({ e, past, fresh }: { e: R1Event; past?: boolean; fresh: boolean }) {
  const c = chip(e.starts_at);
  const place = e.kind === "online" ? "Online" : e.venue_name || e.area || "";
  const crowd = isListing(e) ? (past ? "" : ` · ${priceLine(e)}`) : !fresh && !past && showCount(e.going) ? ` · ${e.going.toLocaleString("en-NG")} going` : "";
  return (
    <Link href={evHref(e)} className={clsx("grid min-h-[64px] grid-cols-[52px_minmax(0,1fr)_56px] items-center gap-3.5 border-b border-t-line py-3 lg:grid-cols-[52px_minmax(0,1fr)_64px]", past && "opacity-75")} data-event-row={e.id}>
      <span className="overflow-hidden rounded-hz border border-t-line bg-t-tile text-center">
        <i className="block bg-t-soft py-0.5 text-[10px] font-extrabold not-italic text-t-muted">{c.mon}</i>
        <b className="block font-display text-[18px] font-extrabold leading-normal">{c.day}</b>
      </span>
      <span className="min-w-0">
        <b className="block font-body text-[15px] leading-snug">{e.title}</b>
        <span className="font-body text-[13px] text-t-muted">{past ? `Past · ${dayShort(e.starts_at)}` : `${dayShort(e.starts_at)} · ${place}${crowd}`}</span>
      </span>
      {e.flyer_url ? <Cover e={e} size={56} /> : <span />}
    </Link>
  );
}

export function EventsTab({ upcoming, past, fresh, emptyUpcoming }: { upcoming: R1Event[]; past: R1Event[]; fresh: boolean; emptyUpcoming?: string }) {
  return (
    <div className="grid content-start gap-5">
      <div>
        <p className="flex justify-between gap-2 font-body text-[12.5px] font-semibold text-t-muted">Upcoming</p>
        {upcoming.length ? upcoming.map((e) => <Row key={e.id} e={e} fresh={fresh} />) : <p className="mt-2 font-body text-[14px] text-t-muted" data-events-empty>{emptyUpcoming ?? "Nothing coming up yet."}</p>}
      </div>
      <div>
        <p className="font-body text-[12.5px] font-semibold text-t-muted">Past</p>
        {past.length ? past.map((e) => <Row key={e.id} e={e} past fresh={fresh} />) : <p className="mt-2 font-body text-[14px] text-t-muted">Past events and their chats collect here after the night.</p>}
      </div>
    </div>
  );
}

export function MembersTab({ room, members, insider }: { room: RoomSummary; members: RoomMember[] | null; insider: boolean }) {
  const fresh = isNewRoom(room);
  const hosts = hostNames(members);
  if (!members || !members.length) {
    return (
      <p className="font-body text-[14px] text-t-muted">
        {fresh ? "A new room." : `${room.members.toLocaleString("en-NG")} members.`}{hosts.length ? ` Hosts: ${hosts.join(", ")}.` : ""} {insider ? "" : "Join to see everyone."}
      </p>
    );
  }
  return (
    <div className="grid content-start gap-2">
      <p className="font-body text-[12.5px] font-semibold text-t-muted">{fresh ? (insider ? youAnd(room.members) : "A new room") : `${room.members.toLocaleString("en-NG")} members`}</p>
      <div className="grid gap-2 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
        {members.slice(0, 60).map((m) => (
          <div key={m.user_id} className="flex min-w-0 items-center gap-2.5 rounded-hz border border-t-line bg-t-tile p-2.5">
            <Avatar name={m.name} />
            <div className="min-w-0">
              <b className="block truncate font-body text-[14px]">{m.name}</b>
              <small className="font-body text-[12px] text-t-muted">{m.role === "owner" ? "Owner" : m.role === "admin" ? "Admin" : "Member"}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function QuestsTab({ eventIds, next, insider }: { eventIds: string[]; next: R1Event | null; insider: boolean }) {
  const { user } = useR1Auth();
  const { quests, claims } = useQuests(user?.id ?? null);
  const mine = quests.filter((q) => q.event_id && eventIds.includes(q.event_id));
  return (
    <div className="grid content-start gap-3">
      <p className="flex justify-between gap-2 font-body text-[12.5px] font-semibold text-t-muted"><span>Quests in this room</span><span>Count across every event</span></p>
      {mine.length === 0 && <p className="font-body text-[14px] text-t-muted">No quests yet. They show here when the room adds one.</p>}
      {mine.map((q, i) => (
        <div key={q.id} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-hz border border-t-line bg-t-tile p-3">
          <span className="grid h-10 w-10 place-items-center rounded-hz bg-t-soft font-display text-[15px] font-extrabold">{i + 1}</span>
          <div className="min-w-0">
            <b className="block font-body text-[14.5px]">{q.title}</b>
            <small className="block font-body text-[12.5px] text-t-muted">{q.description}{insider && claims[q.id] ? " · Done" : ""}</small>
          </div>
          <em className="whitespace-nowrap font-mono text-[13px] not-italic text-t-accent">+{q.xp_reward} XP</em>
        </div>
      ))}
      <p className="mt-1.5 flex justify-between gap-2 font-body text-[12.5px] font-semibold text-t-muted"><span>Leaderboard</span><span>This month</span></p>
      <Leaderboard next={next} />
    </div>
  );
}
