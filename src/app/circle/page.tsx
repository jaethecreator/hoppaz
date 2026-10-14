"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/app/PageHeader";
import CommunityMap, { type QueerEvent } from "@/components/queer/CommunityMap";
import AudioRoom from "@/components/queer/AudioRoom";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";
import { useSession } from "@/lib/useSession";

type Quest = { id: string; title: string; description: string; xp_reward: number; event_id: string | null; starts_at: string; ends_at: string | null };
type VoiceRoom = { id: string; title: string; topic: string; host_id: string; started_at: string };
type Tab = "map" | "quests" | "rooms";

export default function CirclePage() {
  const { userId, hasAccount, state, profile } = useSession();
  const [member, setMember] = useState<"loading" | "no" | "yes" | "setup">("loading");
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [events, setEvents] = useState<QueerEvent[]>([]);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [rooms, setRooms] = useState<VoiceRoom[]>([]);
  const [tab, setTab] = useState<Tab>("map");
  const [selected, setSelected] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState("");
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [roomTitle, setRoomTitle] = useState("");
  const [roomTopic, setRoomTopic] = useState("");
  const [creatingRoom, setCreatingRoom] = useState(false);

  useEffect(() => {
    const codeFromLink = new URLSearchParams(window.location.search).get("invite");
    if (codeFromLink) setCode(codeFromLink.toUpperCase());
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (state === "loading") return;
    if (!userId || !hasAccount) {
      setMember("no");
      return;
    }
    const sb = getSupabase();
    if (!sb) {
      setMember("setup");
      return;
    }
    void sb.from("queer_memberships").select("user_id,status").eq("user_id", userId).maybeSingle()
      .then(({ data, error: readError }) => {
        if (cancelled) return;
        if (readError) setMember("setup");
        else setMember(data?.status === "active" ? "yes" : "no");
      });
    return () => { cancelled = true; };
  }, [userId, hasAccount, state]);

  const loadPrivateContent = useCallback(async () => {
    if (member !== "yes") return;
    const sb = getSupabase();
    if (!sb) return;
    const now = new Date().toISOString();
    const [eventResult, questResult, roomResult] = await Promise.all([
      sb.from("queer_events").select("id,title,venue_name,area,description,lat,lng,starts_at,ends_at")
        .gte("starts_at", now).or(`ends_at.is.null,ends_at.gte.${now}`).order("starts_at", { ascending: true }).limit(100),
      sb.from("queer_quests").select("id,title,description,xp_reward,event_id,starts_at,ends_at")
        .eq("active", true).gte("starts_at", now).or(`ends_at.is.null,ends_at.gte.${now}`).order("starts_at", { ascending: true }).limit(100),
      sb.from("queer_rooms").select("id,title,topic,host_id,started_at")
        .eq("status", "live").order("started_at", { ascending: false }).limit(40),
    ]);
    if (eventResult.error || questResult.error || roomResult.error) {
      setError("Could not load this private space. Refresh and try again.");
      return;
    }
    setEvents((eventResult.data ?? []) as QueerEvent[]);
    setQuests((questResult.data ?? []) as Quest[]);
    setRooms((roomResult.data ?? []) as VoiceRoom[]);
  }, [member]);

  useEffect(() => { void loadPrivateContent(); }, [loadPrivateContent]);

  const redeem = async () => {
    setJoining(true);
    setError("");
    try {
      const sb = getSupabase();
      const { data } = await sb?.auth.getSession() ?? { data: { session: null } };
      if (!data.session?.access_token) throw new Error("Sign in to use an invite.");
      const res = await fetch("/api/queer/join", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ code }),
      });
      const result = await res.json() as { error?: string };
      if (!res.ok) throw new Error(result.error ?? "That invite could not be used.");
      setMember("yes");
      const clean = new URL(window.location.href);
      clean.searchParams.delete("invite");
      window.history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not use that invite.");
    } finally {
      setJoining(false);
    }
  };

  const createInvite = async () => {
    setCreatingInvite(true);
    setError("");
    try {
      const sb = getSupabase();
      const { data } = await sb?.auth.getSession() ?? { data: { session: null } };
      if (!data.session?.access_token) throw new Error("Sign in again to create an invite.");
      const res = await fetch("/api/queer/invites", { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` } });
      const result = await res.json() as { code?: string; error?: string };
      if (!res.ok || !result.code) throw new Error(result.error ?? "Could not create an invite.");
      setInviteLink(`${window.location.origin}/circle?invite=${result.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create an invite.");
    } finally {
      setCreatingInvite(false);
    }
  };

  const startRoom = async () => {
    if (!userId || !roomTitle.trim()) return;
    setCreatingRoom(true);
    setError("");
    const sb = getSupabase();
    try {
      const { data: session } = await sb?.auth.getSession() ?? { data: { session: null } };
      if (!session.session?.access_token) throw new Error("Sign in again to start a room.");
      const response = await fetch("/api/queer/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session.access_token}` },
        body: JSON.stringify({ title: roomTitle, topic: roomTopic }),
      });
      const result = await response.json() as { room?: VoiceRoom; error?: string };
      if (!response.ok || !result.room) throw new Error(result.error ?? "Could not start an audio room.");
      setRooms((current) => [result.room!, ...current]);
      setRoomTitle("");
      setRoomTopic("");
      setTab("rooms");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start an audio room.");
    } finally {
      setCreatingRoom(false);
    }
  };

  const endRoom = async (roomId: string) => {
    setError("");
    const sb = getSupabase();
    const { data } = await sb?.auth.getSession() ?? { data: { session: null } };
    if (!data.session?.access_token) { setError("Sign in again to end the room."); return; }
    const res = await fetch("/api/queer/rooms/end", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ roomId }),
    });
    const result = await res.json() as { error?: string };
    if (!res.ok) { setError(result.error ?? "Could not end the room."); return; }
    setRooms((current) => current.filter((room) => room.id !== roomId));
  };

  const activeEvent = events.find((event) => event.id === selected) ?? null;
  const returnTo = code ? `/circle?invite=${encodeURIComponent(code)}` : "/circle";

  return <div className="h-full overflow-y-auto px-4 pb-8">
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader back="/" title={member === "yes" ? "The circle" : "Private space"} caption={member === "yes" ? "A queer space for Lagos nights" : "Invite only"} />

      {member === "loading" && <p className="hint py-8">Checking your invitation…</p>}
      {member === "setup" && <section className="card p-4"><p className="font-display text-lg font-black">This space is being set up.</p><p className="hint mt-2">Try again a little later.</p></section>}
      {member === "no" && <section className="card p-4">
        <p className="font-display text-lg font-black">You need an invite to enter.</p>
        <p className="hint mt-1">Invite codes are private and can only be used by the person they were shared with.</p>
        {!hasAccount ? <div className="mt-4 rounded-hz border border-line bg-ink-3 p-3">
          <p className="text-sm font-semibold">Save your invite to an account first.</p>
          <p className="hint mt-1">Create an account or sign in, then return here with your invite code.</p>
          <Link href={`/account?next=${encodeURIComponent(returnTo)}`} className="btn mt-3 w-full">SIGN IN OR CREATE ACCOUNT</Link>
        </div> : <div className="mt-4">
          <label htmlFor="circle-invite" className="seclabel">INVITE CODE</label>
          <input id="circle-invite" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="one-time-code" className="mt-2 min-h-11 w-full rounded-hz border border-line bg-ink-3 px-3 text-sm text-cream placeholder:text-dim focus:border-orange focus:outline-none" placeholder="Paste your invite code" />
          <button className="btn mt-3 w-full" disabled={joining || !code.trim()} onClick={() => void redeem()}>{joining ? "CHECKING…" : "ENTER PRIVATE SPACE"}</button>
        </div>}
      </section>}

      {member === "no" && profile?.is_admin && <section className="card mt-3 p-4">
        <p className="seclabel">ADMIN · INVITES</p>
        <button className="btn btn-ghost mt-3 w-full" disabled={creatingInvite} onClick={() => void createInvite()}>{creatingInvite ? "CREATING…" : "CREATE A SINGLE USE INVITE"}</button>
        {inviteLink && <div className="mt-3">
          <p className="hint break-all">{inviteLink}</p>
          <button className="btn mt-2 w-full" onClick={() => void navigator.clipboard?.writeText(inviteLink)}>COPY INVITE LINK</button>
        </div>}
      </section>}

      {member === "yes" && <>
        {profile?.is_admin && <section className="card mb-3 p-3">
          <p className="seclabel">ADMIN · INVITES</p>
          <div className="mt-2 flex gap-2">
            <button className="btn btn-ghost min-h-11 flex-1" disabled={creatingInvite} onClick={() => void createInvite()}>{creatingInvite ? "CREATING…" : "MAKE AN INVITE"}</button>
            {inviteLink && <button className="btn min-h-11" onClick={() => void navigator.clipboard?.writeText(inviteLink)}>COPY LINK</button>}
          </div>
          {inviteLink && <p className="hint mt-2 break-all">{inviteLink}</p>}
        </section>}

        <div role="tablist" aria-label="Private community" className="mb-3 flex border-b border-line">
          {([['map', 'MAP'], ['quests', 'QUESTS'], ['rooms', 'LIVE ROOMS']] as const).map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`min-h-11 flex-1 border-b-2 font-mono text-[10px] font-medium tracking-[0.08em] ${tab === key ? "border-orange text-cream" : "border-transparent text-dim"}`}>{label}</button>)}
        </div>

        {tab === "map" && <>
          <section className="card overflow-hidden p-2">
            {events.length ? <CommunityMap events={events} selected={selected} onSelect={setSelected} /> : <div className="grid min-h-[220px] place-items-center p-5 text-center"><p className="hint">No community events on the map yet.</p></div>}
            {activeEvent && <div className="p-3">
              <div className="flex items-start justify-between gap-3"><div><p className="font-display text-lg font-black">{activeEvent.title}</p><p className="hint">{activeEvent.venue_name}{activeEvent.area ? ` · ${activeEvent.area}` : ""}</p></div><button className="btn btn-ghost min-h-11 px-3" onClick={() => setSelected(null)}>CLOSE</button></div>
              {activeEvent.description && <p className="mt-2 text-sm">{activeEvent.description}</p>}
              <p className="hint mt-2">{new Date(activeEvent.starts_at).toLocaleString("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" })}</p>
            </div>}
          </section>
          <p className="hint mt-2">Private event details are visible only to active members.</p>
        </>}

        {tab === "quests" && <section className="card divide-y divide-line px-3">
          {!quests.length && <p className="hint py-5">No quests are live right now.</p>}
          {quests.map((quest) => <article key={quest.id} className="py-4">
            <div className="flex items-start justify-between gap-3"><h2 className="font-display text-base font-black">{quest.title}</h2><span className="pill pill-lagoon shrink-0">+{quest.xp_reward} XP</span></div>
            {quest.description && <p className="hint mt-1">{quest.description}</p>}
            {quest.ends_at && <p className="mt-2 font-mono text-[10px] text-dim">UNTIL {new Date(quest.ends_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", timeZone: "Africa/Lagos" }).toUpperCase()}</p>}
          </article>)}
        </section>}

        {tab === "rooms" && <>
          <section className="card mb-3 p-3">
            <p className="font-display text-base font-black">Start a conversation</p>
            <input aria-label="Room title" value={roomTitle} onChange={(e) => setRoomTitle(e.target.value)} maxLength={100} className="mt-3 min-h-11 w-full rounded-hz border border-line bg-ink-3 px-3 text-sm text-cream placeholder:text-dim focus:border-orange focus:outline-none" placeholder="What are we talking about?" />
            <input aria-label="Room topic" value={roomTopic} onChange={(e) => setRoomTopic(e.target.value)} maxLength={240} className="mt-2 min-h-11 w-full rounded-hz border border-line bg-ink-3 px-3 text-sm text-cream placeholder:text-dim focus:border-orange focus:outline-none" placeholder="Add a topic (optional)" />
            <button className="btn mt-2 w-full" disabled={creatingRoom || !roomTitle.trim()} onClick={() => void startRoom()}>{creatingRoom ? "STARTING…" : "START LIVE AUDIO ROOM"}</button>
            <p className="hint mt-2">You join muted. Unmute when you&apos;re ready to speak; leave any time.</p>
          </section>
          <section className="space-y-3">
            {!rooms.length && <div className="card p-4"><p className="hint">No live rooms yet. Start one when you&apos;re ready to talk.</p></div>}
            {rooms.map((room) => <article key={room.id} className="card p-3">
              <p className="seclabel text-orange">LIVE · DROP IN</p>
              <h2 className="mt-1 font-display text-lg font-black">{room.title}</h2>
              {room.topic && <p className="hint mt-1">{room.topic}</p>}
              <AudioRoom roomId={room.id} />
              {room.host_id === userId && <button className="btn btn-ghost mt-2 min-h-11 w-full" onClick={() => void endRoom(room.id)}>END ROOM FOR EVERYONE</button>}
            </article>)}
          </section>
        </>}
      </>}

      {error && <p role="alert" className="hint mt-3 text-keke">{error}</p>}
    </div>
  </div>;
}
