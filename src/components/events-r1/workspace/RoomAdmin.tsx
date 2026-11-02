"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Calendar, Eye, Grid3x3, Home, Megaphone, Pencil, Settings, Star, Users, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import SignInSheet from "@/components/events-r1/SignInSheet";
import { copyText, shareOrCopy } from "@/components/events-r1/page/share";
import { usePictureTint } from "@/components/host/TintShell";
import { QUESTS_ON } from "@/lib/events-r1/flags";
import PayoutsScreen from "@/components/events-r1/pay/PayoutsScreen";
import { useR1Api, useR1Query, useRoom, useRoomEvents } from "@/lib/events-r1/hooks";
import { DEFAULT_LOOK } from "@/lib/events-r1/looks";
import type { Look } from "@/lib/events-r1/looks";
import type { RoomSummary } from "@/lib/events-r1/types";
import Frame, { FOOT_LINK } from "./Frame";
import type { NavItem } from "./Frame";
import Switcher from "./Switcher";
import { useInviteLink } from "./admin/useInviteLink";
import AnnouncementsTab from "./admin/AnnouncementsTab";
import EventsTab from "./admin/EventsTab";
import MembersTab from "./admin/MembersTab";
import OverviewTab from "./admin/OverviewTab";
import ProfileTab from "./admin/ProfileTab";
import SettingsTab from "./admin/SettingsTab";
import TwoDTab from "./admin/TwoDTab";
import WelcomeBanner from "./admin/WelcomeBanner";
import { useFlashLine } from "./admin/ui";

const ALL: Array<NavItem & { sub?: string }> = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "profile", label: "Profile", icon: Pencil, sub: "How your room looks to everyone. Changes save as you type." },
  { id: "events", label: "Events", icon: Calendar },
  { id: "members", label: "Members", icon: Users },
  { id: "announcements", label: "Announcements", icon: Megaphone, sub: "Goes to every member and sits at the top of your room." },
  { id: "quests", label: "Quests", icon: Star },
  { id: "twod", label: "2D room", icon: Grid3x3, sub: "Your room's walkable space. Members can drop in, see who is around and chat with people near them." },
  { id: "payouts", label: "Payouts", icon: Wallet, tag: "Owner" },
  { id: "settings", label: "Settings", icon: Settings },
];
export type AdminTab = "overview" | "profile" | "events" | "members" | "announcements" | "quests" | "twod" | "payouts" | "settings";

/** Payouts for the room: the owner's balance and bank, and what the room's events earned. An admin who follows a link gets the lock. */
function RoomPayouts({ room }: { room: RoomSummary }) {
  const events = useRoomEvents(room.id);
  return <PayoutsScreen events={events.data ?? null} name={room.name} newEventHref={`/create?mode=event&room=${encodeURIComponent(room.id)}`} locked={room.my_role !== "owner"} />;
}

/**
 * /rooms/<slug>/admin (and /r/<slug>/admin): the room admin. Only the owner and admins get in; everyone else goes to the room page.
 * It wears the room's look (the logo's colour, the banner pack, Day or Night), in the same frame as the event dashboard.
 */
export default function RoomAdmin() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params.slug);
  const router = useRouter();
  const search = useSearchParams();
  const api = useR1Api();
  const room = useRoom(slug);
  // A new address (the Profile tab) makes the old one stop answering for a moment: the last room stays on screen meanwhile.
  const [kept, setKept] = useState<RoomSummary | null>(null);
  useEffect(() => {
    if (room.data) setKept(room.data);
  }, [room.data]);
  const r = room.data ?? (room.loading ? kept : null);
  const link = useInviteLink(r);
  const saved = useR1Query((a) => (r ? a.looks.get("room", r.id) : Promise.resolve(null)), [r?.id]);
  const [asked, setAsked] = useState(true);
  const [edited, setEdited] = useState<Look | null>(null);
  const [said, say] = useFlashLine();

  const tabs = ALL.filter((t) => t.id !== "quests" || QUESTS_ON);
  const want = search.get("tab");
  const [tab, setTabState] = useState<AdminTab>((tabs.find((t) => t.id === want)?.id ?? "overview") as AdminTab);
  const go = useCallback((t: string) => {
    setTabState(t as AdminTab);
    const sp = new URLSearchParams(window.location.search);
    sp.set("tab", t);
    window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}`);
    window.scrollTo?.({ top: 0 });
  }, []);

  const manager = !!r && (r.my_role === "owner" || r.my_role === "admin");
  const signedIn = api ? !!api.auth.current() : null;
  const sent = signedIn === true && !room.loading && !!r && !manager;
  useEffect(() => {
    if (sent && r) router.replace(`/rooms/${encodeURIComponent(r.slug)}`);
  }, [sent, r, router]);

  // The look: what was saved, or the logo's colour. Edits show at once; the Profile tab saves them.
  const look: Look = edited ?? saved.data ?? DEFAULT_LOOK;
  const tint = usePictureTint(r?.logo_url ?? null, look);
  const lookToUse: Look = { ...look, tint };

  const plain = (children: React.ReactNode) => (
    <div className="h-full overflow-y-auto px-4 pb-24">
      <div className="mx-auto w-full min-w-0 max-w-2xl">{children}</div>
    </div>
  );

  if (!api || signedIn === null) return plain(<p className="hint pad-top">Loading</p>);
  if (!signedIn) {
    return plain(
      <div className="pad-top">
        <h1 className="font-display text-[26px] font-black leading-tight">Manage your room</h1>
        <p className="hint mt-1">Sign in to open the room admin.</p>
        <button type="button" className="btn mt-4 px-5 normal-case" onClick={() => setAsked(true)}>
          Sign in
        </button>
        <SignInSheet open={asked} reason="Manage your room" onClose={() => setAsked(false)} onSignedIn={() => setAsked(false)} />
      </div>
    );
  }
  if (!r) {
    return plain(
      room.loading ? (
        <p className="hint pad-top">Loading</p>
      ) : (
        <div className="pad-top">
          <h1 className="font-display text-[26px] font-black leading-tight">We can&apos;t find this room</h1>
          <Link href="/host" className="btn mt-4 px-5 normal-case">
            Back to your events
          </Link>
        </div>
      )
    );
  }
  if (!manager) return plain(<p className="hint pad-top">Taking you to the room</p>);

  // Payouts is the owner's: admins don't see it in the nav (a link to it says only the owner can see it).
  const owner = r.my_role === "owner";
  const nav = tabs
    .filter((t) => t.id !== "payouts" || owner)
    .map((t) => ({ ...t, badge: t.id === "members" && r.pending_requests > 0 ? String(r.pending_requests) : undefined }));
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const sub = current.id === "payouts" ? (owner ? `Everything ${r.name}${/s$/i.test(r.name) ? "'" : "'s"} events have earned` : undefined) : current.sub;

  const roomPage = `/rooms/${encodeURIComponent(r.slug)}`;
  const invite = async () => {
    const url = link.url;
    const res = await shareOrCopy({ title: r.name, text: `Join ${r.name} on Hoppaz`, url });
    if (res === "copied") say("Invite link copied");
    else if (res === "failed") say((await copyText(url)) ? "Invite link copied" : "Could not copy");
  };

  return (
    <>
      <Frame
        look={lookToUse}
        tint={tint}
        switcher={<Switcher current={r.id} room={r} />}
        actions={
          <>
            <Link href={roomPage} className="lip-ghost hidden !min-h-[40px] flex-none !px-4 sm:inline-flex" data-view-room>
              <Eye size={16} aria-hidden /> View room
            </Link>
            <button type="button" className="lip !min-h-[40px] flex-none !px-4 !py-2" onClick={() => void invite()} data-invite>
              Invite
            </button>
          </>
        }
        nav={nav}
        tab={current.id}
        onTab={go}
        title={current.id === "payouts" && !owner ? "" : current.label}
        sub={sub}
        label="Room sections"
        footer={
          <Link href={roomPage} className={FOOT_LINK}>
            <Eye size={18} aria-hidden /> View room
          </Link>
        }
      >
        {current.id === "overview" && search.get("welcome") === "1" && (
          <WelcomeBanner room={r} moved={Number(search.get("moved")) || 0} also={search.get("also") === "1"} onTab={go} />
        )}
        {current.id === "overview" && <OverviewTab room={r} look={lookToUse} onTab={go} />}
        {current.id === "profile" && <ProfileTab key={r.id} room={r} look={lookToUse} onLook={setEdited} />}
        {current.id === "events" && <EventsTab room={r} />}
        {current.id === "members" && <MembersTab room={r} />}
        {current.id === "announcements" && <AnnouncementsTab room={r} />}
        {current.id === "twod" && <TwoDTab key={r.id} room={r} look={lookToUse} onLook={setEdited} />}
        {current.id === "payouts" && <RoomPayouts room={r} />}
        {current.id === "settings" && <SettingsTab room={r} />}
      </Frame>
      {said && (
        <div role="status" className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-hz bg-[#111] px-4 py-2.5 font-body text-[13.5px] font-bold text-white shadow-xl">
          {said}
        </div>
      )}
    </>
  );
}
