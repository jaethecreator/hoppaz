"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import { ChevronDown, ChevronLeft, Menu, Share2 } from "lucide-react";
import LoadingStub from "@/components/app/LoadingStub";
import { PackLayer, useLookStyle, usePictureTint } from "@/components/host/TintShell";
import { QUESTS_ON } from "@/lib/events-r1/flags";
import {
  useAnnouncements, useR1Api, useR1Auth, useR1Now, useR1Query, useRoomEvents, useRoomMessages,
} from "@/lib/events-r1/hooks";
import { DEFAULT_LOOK } from "@/lib/events-r1/looks";
import type { EventChat, R1Event, RoomMember, RoomPreview, RoomSummary } from "@/lib/events-r1/types";
import { siteOrigin } from "@/lib/events-r1/siteUrl";
import { copyText, shareOrCopy } from "../page/share";
import { useInviteLink } from "../workspace/admin/useInviteLink";
import SignInSheet from "../SignInSheet";
import { useDialogFocus } from "../signin/useDialogFocus";
import { enterPath, roomPath, walkable } from "../rooms/words";
import { AboutCard, EventsTab, LeaderboardCard, MembersCard, MembersTab, NextEvent, QuestCard, QuestsTab, hostNames } from "./Cards";
import Scene from "./Scene";
import {
  Composer, Line, Lock, Note, NoteText, PinnedPops, PlaceholderLines, PopList, ReadBar, TicketStrip, useStick, type Voice,
} from "./Thread";
import { GHOST, LIP, RoomLogo, SOFT, Toast, logoSrc, useDesktop, useFlash } from "./ui";
import { ANNOUNCEMENTS, GENERAL, chatSub, dayShort, dayTime, headSub, isNewRoom, lastLine, showCount, youAnd } from "./words";

type Tab = "chat" | "events" | "members" | "quests";
const TAB_LABEL: Record<Tab, string> = { chat: "Chat", events: "Events", members: "Members", quests: "Quests" };
const ID_ADDRESS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STARTERS = ["Hi everyone", "Who’s going?", "First time here"];

/**
 * The room page (CHANGE-001): the chat is the room. /rooms/<slug>, and /rooms/hq for Lagos HQ. General, Announcements and the chat of
 * every event of the room are channels of this one page (?ch=general | announcements | <event id>); Events, Members and Quests are its
 * other sections. A member lands on Chat; a visitor sees who the room is first and the chat under it (readable when the room is Open,
 * locked when it asks or is invite only). It wears the room's look: its logo's colour, Day or Night.
 */
export default function RoomPage({ slug }: { slug: string }) {
  const sp = useSearchParams();
  const invite = sp.get("invite") ?? undefined;
  const room = useR1Query((a) => a.rooms.get(slug, { invite }), [slug, invite]);
  const preview = useR1Query((a) => a.rooms.preview(slug), [slug]);

  if (room.loading && !room.data) {
    return (
      <div className="h-full px-4 pt-16">
        <LoadingStub label="Loading the room" lines={2} />
      </div>
    );
  }
  if (!room.data) {
    if (preview.loading) {
      return (
        <div className="h-full px-4 pt-16">
          <LoadingStub label="Loading the room" lines={2} />
        </div>
      );
    }
    if (preview.data && preview.data.join_mode === "invite") return <Frame logo={preview.data.logo_url} roomId={preview.data.id}><LockedPage room={preview.data} /></Frame>;
    // A room id can belong to a private room the database hides from us, so for an id we cannot tell private from missing.
    const hidden = ID_ADDRESS.test(slug);
    return (
      <div className="h-full overflow-y-auto px-4 pb-6">
        <div className="mx-auto w-full max-w-[560px] pad-top">
          <h1 className="font-display text-[26px] font-black leading-tight">{hidden ? "We can’t open this room" : "Room not found"}</h1>
          <p className="hint mt-1">{hidden ? "It may be private, or the address may be wrong. Ask the host for an invite." : "There is no room at this address."}</p>
          <Link href="/crew" className="btn btn-ghost mt-4 normal-case">Go to Roomz</Link>
        </div>
      </div>
    );
  }
  return <Page key={room.data.id} real={room.data} invite={invite} />;
}

/* --------------------------------------------------------------- the frame -- */

/** The tinted page: the room's look from its logo (or what the owner saved), the pack behind it, one scrolling column. */
function Frame({ logo, roomId, children, scroller, fill }: { logo: string | null; roomId?: string; children: ReactNode; scroller?: React.RefObject<HTMLDivElement | null>; fill?: boolean }) {
  const saved = useR1Query((a) => (roomId ? a.looks.get("room", roomId) : Promise.resolve(null)), [roomId]);
  const look = saved.data ?? DEFAULT_LOOK;
  const tint = usePictureTint(logoSrc(logo), look);
  const style: CSSProperties = useLookStyle(look, tint);
  return (
    <div ref={scroller} className="relative z-40 h-full overflow-y-auto" data-hub-scroll data-room-page data-mood={look.mood}>
      <div className={clsx("tint-ui relative isolate flex flex-col font-body", fill ? "h-full min-h-[680px]" : "min-h-full")} style={style} data-pack={look.pack} data-mood={look.mood}>
        <PackLayer pack={look.pack} mood={look.mood} tint={tint} />
        <div className={clsx("relative flex flex-1 flex-col", fill ? "min-h-0" : "min-h-full")}>{children}</div>
      </div>
    </div>
  );
}

/** An invite only room with no link: who the room is and how to get in. No chat, no member list. */
function LockedPage({ room }: { room: RoomPreview }) {
  return (
    <>
      <header className="sticky top-0 z-[8] flex items-center gap-2 border-b border-t-line bg-t-bar py-2.5 pl-1.5 pr-2.5 backdrop-blur-[14px] lg:hidden" style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top, 0px))" }}>
        <Link href="/crew" aria-label="Back to Roomz" className="grid h-11 w-10 flex-none place-items-center"><ChevronLeft size={24} aria-hidden /></Link>
      </header>
      <div className="relative h-[150px] overflow-hidden bg-t-soft lg:h-[160px]" style={{ background: "radial-gradient(45% 80% at 12% 25%, var(--t-glow), transparent 70%), radial-gradient(40% 75% at 88% 70%, var(--t-glow2), transparent 70%), var(--t-soft)" }} />
      <div className="relative z-[2] -mt-[52px] grid justify-items-center gap-2 px-[22px] text-center lg:-mt-[58px]">
        <RoomLogo url={room.logo_url} name={room.name} size={96} className="border-4 border-t-bg shadow-[0_18px_36px_-18px_rgba(0,0,0,.6)]" />
        <h1 className="t-title mt-1 text-balance font-display text-[28px] font-black leading-[1.08] tracking-[-0.02em] lg:text-[36px]">{room.name}</h1>
        <span className="inline-flex items-center rounded-hz bg-t-soft px-2 py-[3px] font-body text-[12px] font-bold">Invite only</span>
      </div>
      <div className="mx-[22px] mb-10 mt-[22px] grid justify-items-center gap-2.5 self-center rounded-hz border border-t-line bg-t-tile p-7 text-center lg:mx-8" data-locked-page>
        <span className="inline-flex items-center rounded-hz bg-t-soft px-2 py-[3px] font-body text-[12px] font-bold">Invite only</span>
        <b className="font-display text-[20px] font-extrabold">You need an invite to see this room</b>
        <p className="max-w-[44ch] font-body text-t-muted">Ask someone inside to send you their link.</p>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- the page -- */

function Page({ real, invite }: { real: RoomSummary; invite: string | undefined }) {
  const api = useR1Api();
  const sp = useSearchParams();
  const { user } = useR1Auth();
  const now = useR1Now();
  const desktop = useDesktop();
  const scroller = useRef<HTMLDivElement>(null);
  const [toast, flash] = useFlash();

  // "View as visitor": an owner or admin sees exactly what someone who has not joined sees, under a bar.
  const manager = real.my_role === "owner" || real.my_role === "admin";
  const asVisitor = manager && sp.get("as") === "visitor";
  const room: RoomSummary = asVisitor ? { ...real, joined: false, my_role: null, is_owner: false, can_post: false, unread: 0, request: "none", pending_requests: 0 } : real;
  const hq = room.kind === "hq";
  const base = roomPath(real);
  const insider = room.joined || hq;
  const owner = !asVisitor && real.is_owner;
  const requested = !insider && room.request === "pending";
  const open = room.join_mode === "open";
  const invited = !!invite && !insider && !requested;

  const events = useRoomEvents(real.id);
  const chans = useR1Query((a) => a.rooms.channels(real.id), [real.id, user?.id ?? "", insider]);
  const members = useR1Query((a) => a.rooms.members(real.id).catch(() => null as RoomMember[] | null), [real.id, insider, user?.id ?? ""]);
  const anns = useAnnouncements(open || insider ? real.id : null);
  const invitation = useInviteLink(real);

  const list: EventChat[] = useMemo(
    () => (chans.data ?? []).map((c) => (asVisitor ? { ...c, can_enter: false } : c)),
    [chans.data, asVisitor]
  );
  const liveEvents = (events.data ?? []).filter((e) => e.status === "live");
  const upcoming: R1Event[] = liveEvents.filter((e) => Date.parse(e.starts_at) > now - 3 * 36e5).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const past: R1Event[] = (events.data ?? []).filter((e) => e.status === "ended" || (e.status === "live" && !upcoming.includes(e)));
  const next = upcoming[0] ?? null;

  /* --- which channel and section --- */
  const [ch, setCh] = useState<string>(sp.get("ch") || GENERAL);
  useEffect(() => {
    const c = sp.get("ch");
    if (c) setCh(c);
  }, [sp]);
  const landedOnEvent = useRef(!!sp.get("ch") && sp.get("ch") !== GENERAL && sp.get("ch") !== ANNOUNCEMENTS);
  const wantTab = sp.get("tab");
  const [tab, setTab] = useState<Tab>((["chat", "events", "members", "quests"] as const).find((t) => t === wantTab && (t !== "quests" || QUESTS_ON)) ?? "chat");
  const pick = useCallback((c: string) => {
    setCh(c);
    setTab("chat");
    try {
      const q = new URLSearchParams(window.location.search);
      q.set("ch", c);
      window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
    } catch {
      /* the address stays as it was */
    }
  }, []);
  const chat = list.find((c) => c.event_id === ch) ?? null;
  const known = ch === GENERAL || ch === ANNOUNCEMENTS || !!chat || (chans.loading && !chans.data);
  const chan = known ? ch : GENERAL;
  const onEvent = chan !== GENERAL && chan !== ANNOUNCEMENTS;

  /* --- who is looking --- */
  const enterable = !!chat && chat.can_enter;
  const ticketChat = !insider && !!user && enterable ? chat : null;
  const ticketMode = !insider && !!user && (landedOnEvent.current || enterable) && list.some((c) => c.can_enter);
  const ticketEvent = ticketChat ?? list.find((c) => c.can_enter && (c.event_id === sp.get("ch"))) ?? list.find((c) => c.can_enter) ?? null;
  const readGeneral = insider || open;
  const canReadNow = chan === GENERAL || chan === ANNOUNCEMENTS ? readGeneral : enterable && chat?.state !== "upcoming";
  const canPost =
    chan === GENERAL ? insider
      : chan === ANNOUNCEMENTS ? room.can_post
        : enterable && chat?.state === "open";

  const lines = useRoomMessages(canReadNow && chan !== ANNOUNCEMENTS ? real.id : null, chan === GENERAL ? GENERAL : onEvent ? chan : GENERAL);
  const general = useRoomMessages(readGeneral ? real.id : null, GENERAL);
  const talk = (lines.data ?? []).filter((m) => !m.pinned_pop);
  const pinned = (lines.data ?? []).filter((m) => m.pinned_pop).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const hosts = useMemo(() => new Set(hostNames(members.data)), [members.data]);
  const voice: Voice = { roomName: real.name, logo: real.logo_url, hosts };

  /* --- joining, leaving --- */
  const [signin, setSignin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const join = useCallback(async () => {
    if (!api || busy) return;
    if (!api.auth.current()) return setSignin(true);
    setBusy(true);
    try {
      const out = await api.rooms.join(real.id, { invite });
      if (out === "requested") flash(`Request sent. You get a Pop when ${real.name} lets you in.`);
      else {
        flash("You’re in. Say hi in General.");
        if (!onEvent) pick(GENERAL);
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not join right now");
    } finally {
      setBusy(false);
    }
  }, [api, busy, real.id, real.name, invite, flash, onEvent, pick]);
  const leave = async () => {
    if (!api) return;
    try {
      await api.rooms.leave(real.id);
      setLeaving(false);
      flash(`You left ${real.name}. Your tickets still work.`);
      pick(GENERAL);
    } catch (e) {
      setLeaving(false);
      flash(e instanceof Error ? e.message : "Could not leave right now");
    }
  };

  // A request answered while this page was open, or a notice waiting for the viewer: the room let them in.
  const wasRequested = useRef(requested);
  useEffect(() => {
    if (wasRequested.current && insider) {
      flash(`${real.name} let you in. Say hi in General.`);
      pick(GENERAL);
    }
    wasRequested.current = requested;
  }, [requested, insider, real.name, flash, pick]);
  useEffect(() => {
    if (!api || !user) return;
    let live = true;
    void api.rooms.notices().then((ns) => {
      const mine = ns.filter((n) => n.room_id === real.id);
      if (!live || !mine.length) return;
      flash(`${real.name} let you in. Say hi in General.`);
      void api.rooms.markNoticesSeen(mine.map((n) => n.id));
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [api, user, real.id, real.name, flash]);

  // Opening Announcements is what clears the unread count.
  useEffect(() => {
    if (api && insider && chan === ANNOUNCEMENTS && !asVisitor) void api.rooms.markRead(real.id);
  }, [api, insider, chan, asVisitor, real.id]);

  const send = useCallback(
    async (body: string) => {
      if (!api) return;
      if (chan === ANNOUNCEMENTS) void (await api.rooms.postAnnouncement(real.id, body));
      else void (await api.rooms.send(real.id, chan, body));
    },
    [api, chan, real.id]
  );

  const share = async () => {
    const url = `${siteOrigin()}/r/${real.slug}`;
    const res = await shareOrCopy({ title: real.name, text: `Join ${real.name} on Hoppaz`, url });
    if (res === "copied") flash("Link copied");
    else if (res === "failed") flash((await copyText(url)) ? "Link copied" : "Could not copy");
  };
  const copyInvite = async () => flash((await copyText(invitation.url)) ? "Invite link copied" : "Could not copy");

  // On a phone the page itself scrolls: keep a chat at its newest line.
  const lastId = talk[talk.length - 1]?.id ?? "";
  const phoneChat = desktop === false && tab === "chat" && (insider || ticketMode);
  useEffect(() => {
    const el = scroller.current;
    if (phoneChat && el) el.scrollTop = el.scrollHeight;
  }, [phoneChat, chan, lastId, anns.data?.length, lines.loading]);

  const eventIds = (events.data ?? []).map((e) => e.id);
  const fresh = isNewRoom(real);
  const bundle: Ctx = {
    room, real, base, insider, owner, asVisitor, manager, requested, invited, open, hq, ticketMode, ticketEvent, user: !!user,
    list, chan, chat, onEvent, readGeneral, canReadNow, canPost, talk, pinned, anns: anns.data ?? [], general: general.data ?? [], voice,
    members: members.data, upcoming, past, next, eventIds, now, fresh, tab, setTab, pick, join, busy, send, share, copyInvite, flash,
    leaveAsk: () => setLeaving(true), invitation: invitation.url, linesLoading: lines.loading,
  };

  if (desktop === null) return <Frame logo={real.logo_url} roomId={real.id}><span /></Frame>;

  return (
    <Frame logo={real.logo_url} roomId={real.id} scroller={scroller} fill={desktop === true}>
      {desktop ? <Desktop c={bundle} /> : <Phone c={bundle} />}
      <Toast text={toast} />
      <LeaveDialog open={leaving} room={real.name} phone={!desktop} onStay={() => setLeaving(false)} onLeave={() => void leave()} />
      <SignInSheet
        open={signin}
        reason={`Join ${real.name}`}
        onClose={() => setSignin(false)}
        onSignedIn={() => {
          setSignin(false);
          void join();
        }}
      />
    </Frame>
  );
}

/* --------------------------------------------------------------- the context -- */

type Ctx = {
  room: RoomSummary;
  real: RoomSummary;
  base: string;
  insider: boolean;
  owner: boolean;
  asVisitor: boolean;
  manager: boolean;
  requested: boolean;
  invited: boolean;
  open: boolean;
  hq: boolean;
  ticketMode: boolean;
  ticketEvent: EventChat | null;
  user: boolean;
  list: EventChat[];
  chan: string;
  chat: EventChat | null;
  onEvent: boolean;
  readGeneral: boolean;
  canReadNow: boolean;
  canPost: boolean;
  talk: import("@/lib/events-r1/types").RoomMessage[];
  pinned: import("@/lib/events-r1/types").RoomMessage[];
  anns: import("@/lib/events-r1/types").RoomAnnouncement[];
  general: import("@/lib/events-r1/types").RoomMessage[];
  voice: Voice;
  members: RoomMember[] | null;
  upcoming: R1Event[];
  past: R1Event[];
  next: R1Event | null;
  eventIds: string[];
  now: number;
  fresh: boolean;
  tab: Tab;
  setTab: (t: Tab) => void;
  pick: (c: string) => void;
  join: () => Promise<void>;
  busy: boolean;
  send: (body: string) => Promise<void>;
  share: () => Promise<void>;
  copyInvite: () => Promise<void>;
  flash: (t: string) => void;
  leaveAsk: () => void;
  invitation: string;
  linesLoading: boolean;
};

const eventTitle = (c: Ctx, id: string | undefined) => c.list.find((x) => x.event_id === id)?.event_title ?? "this event";

/* --------------------------------------------------------- shared pieces -- */

function JoinButton({ c, className }: { c: Ctx; className?: string }) {
  return (
    <button type="button" className={clsx(LIP, className)} onClick={() => void c.join()} disabled={c.busy} data-join>
      {c.room.join_mode === "ask" && !c.invited ? "Ask to join" : "Join room"}
    </button>
  );
}

/** The line of numbers and tags under a room's name. */
function Meta({ c }: { c: Ctx }) {
  const { room } = c;
  if (c.fresh) return c.insider ? <span>{youAnd(room.members)}</span> : <span className="inline-flex items-center rounded-hz bg-t-soft px-2 py-[3px] text-[12px] font-bold text-t-text">New room</span>;
  return (
    <>
      <span>{room.members.toLocaleString("en-NG")} members</span>
      {showCount(room.online) && (
        <span className="inline-flex items-center gap-1.5"><i className="h-[7px] w-[7px] rounded-full bg-[#2FD35C]" />{room.online.toLocaleString("en-NG")} online</span>
      )}
      {room.join_mode !== "open" && <span className="inline-flex items-center rounded-hz bg-t-soft px-2 py-[3px] text-[12px] font-bold text-t-text">{room.join_mode === "ask" ? "Ask to join" : "Invite only"}</span>}
    </>
  );
}

function InviteBanner({ c }: { c: Ctx }) {
  return (
    <div className="mx-[22px] mt-4 flex items-center gap-3 rounded-hz border border-t-line bg-t-soft px-3.5 py-3 lg:mx-8" data-invite-banner>
      <RoomLogo url={c.real.logo_url} name={c.real.name} size={36} />
      <div className="min-w-0">
        <b className="block text-[14.5px]">You&apos;re invited to {c.room.name}</b>
        <span className="text-[13px] text-t-muted">Join to see the chat, events{QUESTS_ON ? " and quests" : ""}. The link works for 7 days.</span>
      </div>
    </div>
  );
}

/** The thread of the current channel: its lines, or the note or lock that stands in for them. */
function ThreadBody({ c, phone }: { c: Ctx; phone: boolean }) {
  const { chan, chat, room } = c;
  const title = chat?.event_title ?? "";
  const mine = c.insider || (!!chat && chat.can_enter);

  if (c.requested && !c.canReadNow) return <LockedThread c={c} kind="requested" />;
  if (!c.canReadNow) {
    if (chan === ANNOUNCEMENTS || chan === GENERAL) return <LockedThread c={c} kind="members" />;
    if (chat?.state === "upcoming" && !chat.can_enter) return <LockedThread c={c} kind="going" />;
    if (chat?.state !== "upcoming" || !chat) return <LockedThread c={c} kind="going" />;
  }

  if (chan === ANNOUNCEMENTS) {
    if (!c.anns.length) {
      return (
        <Note title="No announcements yet"><NoteText>{c.room.can_post ? "Post one and every member gets it as a Pop." : "When the host posts, you get it as a Pop."}</NoteText></Note>
      );
    }
    return <PopList list={c.anns} now={c.now} />;
  }

  if (chat && chat.state === "upcoming") {
    return (
      <Note title={`This chat opens ${dayTime(chat.opens_at, c.now)}`}>
        <NoteText>That&apos;s 1 hour before doors. It stays open for 3 days after, then it closes and lives here as history.</NoteText>
        {mine && (<><NoteText>Until then, General is open.</NoteText><button type="button" className={GHOST} onClick={() => c.pick(GENERAL)}>Go to General</button></>)}
      </Note>
    );
  }

  const first = chan === GENERAL && !c.talk.length && !c.linesLoading;
  if (first) {
    const guests = c.next?.going ?? 0;
    return (
      <>
        <div className="mx-auto max-w-[44ch] rounded-hz bg-t-soft px-3 py-1.5 text-center text-[13px] text-t-muted">
          {room.name} opened this room.{guests >= 5 && c.next ? ` ${guests} guests from ${c.next.title} got an invite.` : ""}
        </div>
        <Note title="Nobody's said anything yet">
          <NoteText>{c.insider ? "Say hi first. People who join next will see it." : "Join and be the first to say hi."}</NoteText>
          {c.insider && <Starters c={c} />}
        </Note>
      </>
    );
  }

  return (
    <>
      {chan === GENERAL && c.fresh && c.talk.length === 0 ? null : null}
      <PinnedPops lines={c.pinned} />
      {c.talk.map((m) => <Line key={m.id} m={m} voice={c.voice} />)}
      {chat?.state === "closed" && (
        <Note title="This chat has closed" className="!pb-2 !pt-4">
          <NoteText>Thanks for coming.{c.next ? ` The next one opens before ${c.next.title}.` : ""}</NoteText>
          <button type="button" className={GHOST} onClick={() => c.pick(GENERAL)}>Go to General</button>
        </Note>
      )}
      {phone && title === "" ? null : null}
    </>
  );
}

function Starters({ c }: { c: Ctx }) {
  const api = useR1Api();
  const when = c.next ? dayTime(c.next.starts_at, c.now) : "";
  const first = c.next ? `Who\u2019s going ${when.startsWith("today") ? "tonight" : when.startsWith("tomorrow") ? "tomorrow" : `on ${when.split(" ")[0]}`}?` : STARTERS[1];
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {[STARTERS[0], first, STARTERS[2]].map((s) => (
        <button
          key={s}
          type="button"
          className="inline-flex min-h-[44px] items-center rounded-full border border-t-line bg-t-solid px-3.5 font-body text-[13.5px] font-semibold"
          onClick={() => void api?.rooms.send(c.real.id, GENERAL, s).catch((e: unknown) => c.flash(e instanceof Error ? e.message : "Could not send"))}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function LockedThread({ c, kind }: { c: Ctx; kind: "members" | "requested" | "going" }) {
  const { room } = c;
  const hoppers = showCount(room.members) ? `${room.members.toLocaleString("en-NG")} Hoppers` : "the Hoppers inside";
  const ev = c.chat;
  let lock: ReactNode;
  if (kind === "requested") lock = <Lock title="Your request is in" text={`${room.name} approves each member. You get a Pop when you're in, and the chat opens for you.`} />;
  else if (kind === "going") {
    lock = (
      <Lock
        title="For people going"
        text={`Get a ticket to ${eventTitle(c, ev?.event_id)} and this chat opens for you.`}
        action={<Link href={ev ? `/event/${ev.event_id}` : "/"} className={GHOST}>See the event</Link>}
      />
    );
  } else {
    lock = <Lock title="Members only" text={`${room.join_mode === "ask" ? "Ask to join" : "Join"} to read the chat and talk to ${hoppers}.`} />;
  }
  return (
    <>
      <PlaceholderLines />
      {lock}
    </>
  );
}

/** The composer, a read-only bar, or nothing: whatever the viewer can do in this channel right now. */
function Footer({ c, phone }: { c: Ctx; phone: boolean }) {
  const { chan, chat, room } = c;
  if (!c.canReadNow) return null;
  if (c.canPost) {
    const name = chan === GENERAL ? "General" : chan === ANNOUNCEMENTS ? "" : chat?.event_title ?? "";
    const label = chan === ANNOUNCEMENTS ? "Write an announcement" : `Message ${name}`;
    return <Composer phone={phone} placeholder={label} label={label} main={!(c.ticketMode && !c.insider)} onSend={c.send} />;
  }
  if (!c.insider && !c.ticketMode && room.join_mode === "open" && chan !== ANNOUNCEMENTS && chan === GENERAL && !phone) return <ReadBar onJoin={() => void c.join()} />;
  return null;
}

/** The channels as chips (phone) or rows (desktop). */
function channelRows(c: Ctx) {
  const { room } = c;
  const gen = c.general.length ? lastLine(c.general) : null;
  const ann = room.latest_announcement ? `Pinned: ${room.latest_announcement.body}` : "Nothing yet";
  const rows: Array<{ id: string; ic: string; b: string; sm: string; un?: number; dot?: boolean; dim?: boolean; group?: string }> = [
    { id: GENERAL, ic: "#", b: "General", sm: c.fresh && !gen ? "Say hi first" : gen ?? "Everyone in the room" },
    { id: ANNOUNCEMENTS, ic: "◆", b: "Announcements", sm: c.fresh && !room.latest_announcement ? "Nothing yet" : ann, un: c.insider ? room.unread : 0 },
  ];
  let shown = 0;
  for (const e of c.list) {
    if (e.state === "closed" && shown >= 4) continue;
    rows.push({ id: e.event_id, ic: "✦", b: e.event_title, sm: chatSub(e, c.now), dot: e.state === "open", dim: e.state !== "open", group: "Event chats" });
    shown++;
  }
  return rows;
}

/* --------------------------------------------------------------- desktop -- */

function Desktop({ c }: { c: Ctx }) {
  const { room, real } = c;
  const walk = walkable(room);
  const locked = false;
  const [jmenu, setJmenu] = useState(false);
  const jref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!jmenu) return;
    const off = (e: PointerEvent) => {
      if (!jref.current?.contains(e.target as Node)) setJmenu(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setJmenu(false);
    document.addEventListener("pointerdown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [jmenu]);

  const tabs: Tab[] = QUESTS_ON ? ["chat", "events", "members", "quests"] : ["chat", "events", "members"];
  const canLeave = c.insider && !c.owner && !c.hq && !c.asVisitor;

  const bar = c.asVisitor ? (
    <div className="flex flex-wrap items-center justify-between gap-2.5 bg-t-accent px-6 py-1.5 text-[13.5px] font-bold text-t-on" data-visitor-bar>
      <span>Viewing as a visitor. This is what people see before they join.</span>
      <Link href={c.base} className={clsx(GHOST, "!text-t-text")}>Back to my view</Link>
    </div>
  ) : c.manager ? (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-t-line bg-t-tile px-6 py-1.5 text-[13.5px]" data-owner-bar>
      <b className="mr-auto flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-t-accent" />You run this room</b>
      {!walkable(c.real) && <Link href={`${c.base}/admin?tab=twod`} className={GHOST}>Add a walkable room</Link>}
      <Link href={`${c.base}?as=visitor`} className={GHOST} data-view-visitor>View as visitor</Link>
      <Link href={`${c.base}/admin`} className={GHOST} data-manage-room>Manage room</Link>
    </div>
  ) : null;

  const hero = walk ? (
    <Link href={enterPath(room)} aria-label="Walk into the room" className="relative block h-[130px] flex-none overflow-hidden bg-black" data-walk-hero>
      <Scene night={nightOf()} people={Math.max(4, Math.min(14, room.online))} />
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent from-35% to-t-bg to-[98%]" />
      <span className="absolute right-6 top-[18px] flex items-center gap-2.5 rounded-hz bg-t-solid py-1.5 pl-3 pr-1.5 text-t-text shadow-[0_8px_24px_rgba(0,0,0,.35)]">
        <span>
          <b className="flex items-center gap-1.5 text-[13.5px] leading-tight">
            <i className="h-2 w-2 rounded-full bg-[#2FD35C] shadow-[0_0_0_3px_rgba(47,211,92,.25)]" />
            {showCount(room.online) ? `${room.online.toLocaleString("en-NG")} here now` : "Walkable room"}
          </b>
          {showCount(room.online) && <small className="block text-[12px] leading-tight text-t-muted">Walkable room</small>}
        </span>
        <span className={clsx(GHOST, "!mb-0 !min-h-[44px]")}>Walk in</span>
      </span>
    </Link>
  ) : (
    <div className="relative h-[110px] flex-none overflow-hidden bg-t-soft" style={{ background: "radial-gradient(45% 80% at 12% 25%, var(--t-glow), transparent 70%), radial-gradient(40% 75% at 88% 70%, var(--t-glow2), transparent 70%), var(--t-soft)" }} />
  );

  const act = (
    <div className="flex flex-wrap items-end justify-end gap-2.5 pb-2">
      {c.owner ? (
        <button type="button" className={GHOST} onClick={() => void c.copyInvite()}>Copy invite link</button>
      ) : c.insider ? (
        <>
          {!c.hq && (
            <span ref={jref} className="relative inline-flex">
              <button type="button" className={GHOST} aria-expanded={jmenu} aria-haspopup="menu" onClick={() => setJmenu((v) => !v)} data-joined>
                <span aria-hidden>{"✓"}</span> Joined <ChevronDown size={14} aria-hidden />
              </button>
              {jmenu && canLeave && (
                <div role="menu" className="absolute right-0 top-[calc(100%+4px)] z-10 grid w-[220px] rounded-hz border border-t-line bg-t-solid p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,.5)]">
                  <button type="button" role="menuitem" className="flex min-h-[44px] items-center rounded-hz px-3 text-left text-[14px] font-semibold text-t-muted hover:bg-t-soft" onClick={() => { setJmenu(false); c.leaveAsk(); }} data-leave>
                    Leave room
                  </button>
                </div>
              )}
            </span>
          )}
          <button type="button" className={GHOST} onClick={() => void c.share()}>Share</button>
        </>
      ) : c.requested ? (
        <>
          <span className={SOFT}>Request sent</span>
          <span className="basis-full text-right text-[12.5px] text-t-muted">{room.name} approves members. You get a Pop when you&apos;re in.</span>
        </>
      ) : (
        <JoinButton c={c} />
      )}
    </div>
  );

  const idrow = (
    <div className="relative z-[2] flex-none -mt-[58px] grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-[22px] px-8">
      <RoomLogo url={real.logo_url} name={real.name} size={116} className="border-4 border-t-bg shadow-[0_18px_36px_-18px_rgba(0,0,0,.6)]" />
      <div className="grid min-w-0 gap-1 pb-1.5">
        <h1 className="t-title text-balance font-display text-[36px] font-black leading-[1.05] tracking-[-0.02em]" data-hub-title>{room.name}</h1>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13.5px] text-t-muted"><Meta c={c} /></div>
      </div>
      {act}
    </div>
  );

  const tabsRow = (
    <div role="tablist" aria-label="Sections" className="flex gap-0.5 overflow-x-auto border-b border-t-line [scrollbar-width:none]">
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={c.tab === t}
          onClick={() => c.setTab(t)}
          className={clsx("-mb-px inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 text-[14.5px] font-bold", c.tab === t ? "border-t-accent text-t-text" : "border-transparent text-t-muted")}
        >
          {TAB_LABEL[t]}
        </button>
      ))}
    </div>
  );

  const rows = channelRows(c);
  let group = "";
  const [title, sub] = threadHead(c);
  const stick = useStick([c.chan, c.talk[c.talk.length - 1]?.id, c.anns.length]);
  const readable = c.canReadNow;
  const mainChat = (
    <div className="grid min-h-[360px] flex-1 grid-cols-[200px_minmax(0,1fr)] overflow-hidden rounded-hz border border-t-line bg-t-tile">
      <nav aria-label="Channels" className="grid min-h-0 content-start gap-0.5 overflow-y-auto border-r border-t-line bg-t-bg px-2 py-3">
        <span className="px-2 pb-1 pt-2 text-[12.5px] font-semibold text-t-muted">Channels</span>
        {rows.map((r) => {
          const head = r.group && group !== r.group ? ((group = r.group), <span key={`h-${r.group}`} className="px-2 pb-1 pt-3 text-[12.5px] font-semibold text-t-muted">{r.group}</span>) : null;
          return (
            <FragmentKey key={r.id}>
              {head}
              <button
                type="button"
                aria-current={c.chan === r.id}
                onClick={() => c.pick(r.id)}
                className={clsx("grid min-h-[44px] grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded-hz p-2 text-left text-[14px] font-semibold hover:bg-t-soft", c.chan === r.id ? "bg-t-soft text-t-text" : "text-t-muted", r.dim && c.chan !== r.id && "opacity-80")}
                data-channel={r.id}
              >
                <span className="text-center font-mono text-[14px] text-t-muted" aria-hidden>{r.ic}</span>
                <span className="grid min-w-0 leading-tight">
                  <b className="truncate font-bold">{r.b}</b>
                  <small className="truncate text-[12px] font-medium text-t-muted">{r.sm}</small>
                </span>
                {r.un ? <span className="rounded-full bg-t-accent px-[7px] py-px text-[11.5px] font-extrabold text-t-on">{r.un}</span> : r.dot ? <span className="h-2 w-2 rounded-full bg-[#2FD35C]" role="img" aria-label="Open now" /> : null}
              </button>
            </FragmentKey>
          );
        })}
      </nav>
      <section aria-label={title} className="relative flex min-h-0 min-w-0 flex-col">
        {c.ticketMode && c.ticketEvent && c.chat?.event_id === c.ticketEvent.event_id && <TicketStrip event={c.ticketEvent.event_title} room={room.name} phone={false} join={() => void c.join()} />}
        <div className="flex items-center gap-2.5 border-b border-t-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[15.5px] font-bold leading-tight">{title}</h2>
            <small className="block text-[12.5px] text-t-muted">{sub}</small>
          </div>
        </div>
        <div ref={stick.ref} onScroll={stick.onScroll} role="log" aria-live="polite" aria-label={title} className={clsx("relative flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4", !readable && "overflow-hidden")}>
          <ThreadBody c={c} phone={false} />
        </div>
        <Footer c={c} phone={false} />
      </section>
    </div>
  );

  const aside = (
    <div className="grid min-w-0 content-start gap-[18px]">
      <NextEvent event={c.next} room={room} now={c.now} />
      {!c.insider && <AboutCard room={room} />}
      <MembersCard room={room} members={c.members} insider={c.insider} onSeeAll={() => c.setTab("members")} />
      {QUESTS_ON && <QuestCard eventIds={c.eventIds} insider={c.insider} onAll={() => c.setTab("quests")} />}
      {QUESTS_ON && <LeaderboardCard next={c.next} onAll={() => c.setTab("quests")} />}
    </div>
  );

  void locked;
  return (
    <>
      {bar}
      {hero}
      {idrow}
      {c.invited && <InviteBanner c={c} />}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] gap-7 px-8 pb-6 pt-4">
        <div className="flex min-h-0 min-w-0 flex-col gap-3.5">
          {tabsRow}
          {c.tab === "chat" ? mainChat : <div className="min-h-0 flex-1 overflow-y-auto">{c.tab === "events" ? <EventsTab upcoming={c.upcoming} past={c.past} fresh={c.fresh} /> : c.tab === "members" ? <MembersTab room={room} members={c.members} insider={c.insider} /> : <QuestsTab eventIds={c.eventIds} next={c.next} insider={c.insider} />}</div>}
        </div>
        <div className="min-h-0 overflow-y-auto">{aside}</div>
      </div>
    </>
  );
}

const FragmentKey = ({ children }: { children: ReactNode }) => <>{children}</>;

/** Day or Night of the page now, read from the page's own data attribute (the scene is drawn in the same mood). */
function nightOf(): boolean {
  if (typeof document === "undefined") return true;
  return document.querySelector("[data-room-page]")?.getAttribute("data-mood") !== "day";
}

function threadHead(c: Ctx): [string, string] {
  const { chan, chat, room } = c;
  if (chan === GENERAL) return ["General", c.fresh ? "Everyone in the room" : `Everyone in the room · ${room.members.toLocaleString("en-NG")} members`];
  if (chan === ANNOUNCEMENTS) return ["Announcements", "Only hosts post here. Every post goes out as a Pop"];
  if (!chat) return ["Event chat", ""];
  if (chat.state === "open") return [chat.event_title, "Event chat · opened 1 hour before doors · closes 3 days after"];
  if (chat.state === "upcoming") return [chat.event_title, `Event chat · Opens ${dayTime(chat.opens_at, c.now)}`];
  return [chat.event_title, `Event chat · Closed ${dayShort(chat.closes_at)}`];
}

/* ----------------------------------------------------------------- phone -- */

function Phone({ c }: { c: Ctx }) {
  const { room, real } = c;
  const compact = c.insider || c.ticketMode;
  const walk = walkable(room);
  const [menu, setMenu] = useState(false);
  const mref = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);
  const tabs: Tab[] = QUESTS_ON ? ["chat", "events", "members", "quests"] : ["chat", "events", "members"];
  const canLeave = c.insider && !c.owner && !c.hq && !c.asVisitor;

  // The menu closes on a pick, on a tap outside, and when nobody touches it for 4 seconds.
  const rearm = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMenu(false), 4000);
  }, []);
  useEffect(() => {
    if (!menu) return;
    rearm();
    const off = (e: PointerEvent) => {
      if (!mref.current?.contains(e.target as Node)) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("pointerdown", off);
    document.addEventListener("keydown", esc);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener("pointerdown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [menu, rearm]);

  const pbar = c.asVisitor ? (
    <div className="flex items-center justify-between gap-2 bg-t-accent px-3.5 py-1.5 text-[13px] font-bold text-t-on" data-visitor-bar>
      <span>Viewing as a visitor</span>
      <Link href={c.base} className={clsx(GHOST, "!mb-0 !text-t-text")}>Back to my view</Link>
    </div>
  ) : c.manager ? (
    <div className="border-b border-t-line bg-t-tile px-3.5 py-1.5 text-[13px]" data-owner-bar>
      <div className="flex items-center gap-2">
        <b className="mr-auto whitespace-nowrap">You run this room</b>
        <Link href={`${c.base}?as=visitor`} className={clsx(GHOST, "!mb-0 !px-2.5 !text-[12.5px]")} data-view-visitor>View as visitor</Link>
        <Link href={`${c.base}/admin`} className={clsx(GHOST, "!mb-0 !px-2.5 !text-[12.5px]")} data-manage-room>Manage</Link>
      </div>
      {/* On a phone the third button does not fit beside the other two, so it sits under them as a plain link. */}
      {!walkable(c.real) && (
        <Link href={`${c.base}/admin?tab=twod`} className="flex min-h-[44px] items-center font-body text-[13px] font-bold text-t-accent underline underline-offset-2">
          Add a walkable room
        </Link>
      )}
    </div>
  ) : null;

  const back = (
    <Link href="/crew" aria-label="Back to Roomz" className="grid h-11 w-10 flex-none place-items-center text-[20px]"><ChevronLeft size={24} aria-hidden /></Link>
  );
  const pad = { paddingTop: "calc(0.625rem + env(safe-area-inset-top, 0px))" };

  if (compact) {
    const section = TAB_LABEL[c.tab];
    const sub = headSub(section, room, c.insider);
    const menuEl = menu && (
      <div ref={mref} role="menu" aria-label="Sections" className="absolute right-2.5 top-[calc(100%+6px)] z-[9] grid w-[230px] gap-0.5 rounded-hz border border-t-line bg-t-solid p-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,.5)]" onPointerMove={rearm} onFocus={rearm} data-phone-menu>
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="menuitem"
            aria-current={c.tab === t}
            className={clsx("flex min-h-[44px] items-center gap-2 rounded-hz px-3 text-left text-[15px] font-bold hover:bg-t-soft", c.tab === t && "bg-t-soft")}
            onClick={() => { c.setTab(t); setMenu(false); }}
          >
            {TAB_LABEL[t]}
            {c.tab === t && <i className="ml-auto not-italic text-t-accent" aria-hidden>{"✓"}</i>}
          </button>
        ))}
        {canLeave && (
          <>
            <hr className="my-1 border-0 border-t border-t-line" />
            <button type="button" role="menuitem" className="flex min-h-[44px] items-center rounded-hz px-3 text-left text-[15px] font-semibold text-t-muted hover:bg-t-soft" onClick={() => { setMenu(false); c.leaveAsk(); }} data-leave>
              Leave room
            </button>
          </>
        )}
      </div>
    );
    const top = (
      <header className={clsx("sticky top-0 z-[8] isolate flex items-center gap-2 border-b border-t-line bg-t-bar py-2.5 pl-1.5 pr-2.5 backdrop-blur-[14px]", walk && "min-h-[104px] items-end !border-b-transparent !bg-transparent pb-3")} style={pad}>
        {walk && (
          <span aria-hidden className="absolute inset-0 -z-[2] overflow-hidden bg-black"><Scene night={nightOf()} people={Math.max(4, Math.min(14, room.online))} /></span>
        )}
        {walk && <span aria-hidden className="absolute inset-0 -z-[1] bg-gradient-to-b from-black/5 to-t-bar to-[78%]" />}
        {back}
        <RoomLogo url={real.logo_url} name={real.name} size={40} />
        <span className="min-w-0 flex-1 leading-tight">
          <b className="block truncate font-display text-[16px] font-extrabold">{room.name}</b>
          <small className="flex items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-t-muted">
            {showCount(room.online) && !c.fresh && <i className="h-[7px] w-[7px] flex-none rounded-full bg-[#2FD35C]" />}
            {sub}
          </small>
        </span>
        {walk && (
          <Link href={enterPath(room)} className="flex min-h-[44px] flex-none items-center gap-1.5 rounded-hz border border-t-line bg-t-solid px-2.5 text-[13px] font-bold">
            <i className="h-[7px] w-[7px] rounded-full bg-[#2FD35C]" />Walk in
          </Link>
        )}
        <button
          type="button"
          className={clsx("grid h-11 w-11 flex-none place-items-center rounded-hz border border-t-line", menu ? "border-transparent bg-t-text text-t-bg" : "bg-t-solid")}
          aria-expanded={menu}
          aria-haspopup="menu"
          aria-label={`Sections: ${tabs.map((t) => TAB_LABEL[t]).join(", ")}`}
          onClick={() => setMenu((v) => !v)}
          data-phone-menu-button
        >
          <Menu size={20} strokeWidth={2} aria-hidden />
        </button>
        {menuEl}
      </header>
    );

    let body: ReactNode;
    if (c.tab === "chat") {
      const rows = channelRows(c);
      const chips = (
        <div role="group" aria-label="Channels" className="flex gap-2 overflow-x-auto border-b border-t-line px-3.5 py-2.5 [scrollbar-width:none]">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-current={c.chan === r.id}
              onClick={() => c.pick(r.id)}
              className={clsx("flex min-h-[44px] flex-none items-center gap-1.5 rounded-full border px-3 text-[13.5px] font-bold", c.chan === r.id ? "border-transparent bg-t-text text-t-bg" : "border-t-line bg-t-tile text-t-muted", r.dim && c.chan !== r.id && "opacity-80")}
              data-channel={r.id}
            >
              {r.ic === "#" ? "#" : r.ic} {r.b}
              {r.un ? <span className="rounded-full bg-t-accent px-1.5 text-[11px] font-extrabold text-t-on">{r.un}</span> : r.dot ? <span className="h-[7px] w-[7px] rounded-full bg-[#2FD35C]" role="img" aria-label="Open now" /> : null}
            </button>
          ))}
        </div>
      );
      const [, ts] = threadHead(c);
      body = (
        <>
          {chips}
          {c.ticketMode && c.ticketEvent && c.chat?.event_id === c.ticketEvent.event_id && <TicketStrip event={c.ticketEvent.event_title} room={room.name} phone join={() => void c.join()} />}
          <section aria-label={threadHead(c)[0]} className="relative flex min-h-[260px] flex-1 flex-col">
            <p className="px-4 pt-2.5 text-[12.5px] text-t-muted">{ts}</p>
            <div role="log" aria-live="polite" className={clsx("relative flex flex-1 flex-col gap-3.5 px-4 pb-5 pt-4", !c.canReadNow && "overflow-hidden")}>
              <ThreadBody c={c} phone />
            </div>
          </section>
          <Footer c={c} phone />
        </>
      );
    } else {
      body = (
        <div className="grid content-start gap-3.5 px-4 pb-7 pt-4">
          {c.tab === "events" ? <EventsTab upcoming={c.upcoming} past={c.past} fresh={c.fresh} /> : c.tab === "members" ? <MembersTab room={room} members={c.members} insider={c.insider} /> : <QuestsTab eventIds={c.eventIds} next={c.next} insider={c.insider} />}
        </div>
      );
    }
    return (
      <>
        {top}
        {pbar}
        {body}
      </>
    );
  }

  /* Visitor or requested: who the room is first, the chat right under it. */
  const hero = walk ? (
    <Link href={enterPath(room)} aria-label="Walk into the room" className="relative block h-[190px] overflow-hidden bg-black" data-walk-hero>
      <Scene night={nightOf()} people={Math.max(4, Math.min(14, room.online))} />
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent from-35% to-t-bg to-[98%]" />
      <span className="absolute inset-x-3 top-3 flex items-center justify-between gap-2 rounded-hz bg-t-solid py-1.5 pl-3 pr-1.5 text-[13px]">
        <b className="flex items-center gap-1.5"><i className="h-[7px] w-[7px] rounded-full bg-[#2FD35C]" />{showCount(room.online) ? `${room.online.toLocaleString("en-NG")} here now` : "Walkable room"}</b>
        <span className={clsx(GHOST, "!mb-0 !px-2.5 !text-[12.5px]")}>Walk in</span>
      </span>
    </Link>
  ) : (
    <div className="relative h-[150px] overflow-hidden bg-t-soft" style={{ background: "radial-gradient(50% 80% at 15% 30%, var(--t-glow), transparent 70%), radial-gradient(45% 80% at 85% 70%, var(--t-glow2), transparent 70%), var(--t-soft)" }} />
  );
  const top = (
    <header className="sticky top-0 z-[8] isolate flex items-center gap-2 border-b border-t-line bg-t-bar py-2.5 pl-1.5 pr-2.5 backdrop-blur-[14px]" style={pad}>
      {back}
      <span className="flex-1" />
      <button type="button" aria-label="Share" className="grid h-11 w-10 flex-none place-items-center" onClick={() => void c.share()}><Share2 size={19} aria-hidden /></button>
    </header>
  );
  const bar = c.requested ? (
    <div className="sticky bottom-0 z-[7] mt-auto grid gap-1.5 border-t border-t-line bg-t-bar px-4 pb-[18px] pt-3 backdrop-blur-[14px]">
      <span className={clsx(SOFT, "w-full")}>Request sent</span>
      <small className="text-center text-[12.5px] text-t-muted">You get a Pop when {room.name} lets you in.</small>
    </div>
  ) : (
    <div className="sticky bottom-0 z-[7] mt-auto grid gap-1.5 border-t border-t-line bg-t-bar px-4 pb-[18px] pt-3 backdrop-blur-[14px]">
      <JoinButton c={c} className="w-full" />
      <small className="text-center text-[12.5px] text-t-muted">{room.join_mode === "open" || c.invited ? "Free. Leave any time." : "The host approves each member"}</small>
    </div>
  );
  return (
    <>
      {top}
      {pbar}
      {hero}
      <div className="relative z-[2] -mt-[52px] grid justify-items-center gap-2 px-[22px] text-center">
        <RoomLogo url={real.logo_url} name={real.name} size={96} className="border-4 border-t-bg shadow-[0_18px_36px_-18px_rgba(0,0,0,.6)]" />
        <h1 className="t-title mt-1 text-balance font-display text-[28px] font-black leading-[1.08] tracking-[-0.02em]" data-hub-title>{room.name}</h1>
        <div className="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1 text-[13.5px] text-t-muted"><Meta c={c} /></div>
        {room.about && <p className="max-w-[34ch] text-[15px]">{room.about}</p>}
      </div>
      {c.invited && <InviteBanner c={c} />}
      <div className="grid gap-3 px-[22px] pt-[22px]"><NextEvent event={c.next} room={room} now={c.now} /></div>
      <div className="grid gap-3 px-[22px] pt-[22px]">
        <p className="flex justify-between gap-2 text-[12.5px] font-semibold text-t-muted"><span>Chat</span></p>
        <section aria-label="General" className="relative overflow-hidden rounded-hz border border-t-line bg-t-tile">
          <div role="log" aria-live="polite" className={clsx("relative flex max-h-[420px] flex-col gap-3.5 overflow-y-auto p-3.5", c.canReadNow ? "min-h-[220px]" : "min-h-[340px] overflow-hidden")}>
            <ThreadBody c={{ ...c, chan: GENERAL, chat: null, onEvent: false }} phone />
          </div>
        </section>
      </div>
      {QUESTS_ON && <div className="grid gap-3 px-[22px] pb-6 pt-[22px]"><QuestCard eventIds={c.eventIds} insider={false} onAll={() => c.setTab("quests")} /></div>}
      <span className="pb-6" />
      {bar}
    </>
  );
}

/* ---------------------------------------------------------- leave dialog -- */

function LeaveDialog({ open, room, phone, onStay, onLeave }: { open: boolean; room: string; phone: boolean; onStay: () => void; onLeave: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(open, box, onStay);
  if (!open) return null;
  return (
    <div className={clsx("fixed inset-0 z-50 flex bg-black/55", phone ? "items-end" : "items-center justify-center")} onPointerDown={(e) => e.target === e.currentTarget && onStay()}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={`Leave ${room}`} className={clsx("grid gap-2.5 border border-t-line bg-t-solid text-t-text shadow-[0_30px_70px_rgba(0,0,0,.55)]", phone ? "w-full rounded-t-hz px-[18px] pb-[22px] pt-5" : "w-[min(400px,calc(100%-32px))] rounded-hz p-5")} data-leave-dialog>
        <b className="font-display text-[19px] font-extrabold">Leave {room}?</b>
        <p className="font-body text-[14px] text-t-muted">You stop getting its Pops and leave its chats. Your tickets still work, and you can join again any time.</p>
        <div className={clsx("mt-1.5 gap-2.5", phone ? "grid grid-cols-2" : "flex flex-wrap justify-end")}>
          <button type="button" className={GHOST} onClick={onStay}>Stay</button>
          <button type="button" className={LIP} onClick={onLeave} data-leave-confirm>Leave room</button>
        </div>
      </div>
    </div>
  );
}
