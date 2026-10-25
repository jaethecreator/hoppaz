"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/app/PageHeader";
import RequireAccount from "@/components/app/RequireAccount";
import Call from "@/components/meet/Call";
import { useSession } from "@/lib/useSession";
import {
  INTERESTS, MAX_INTERESTS, blockPeer, choose, getInterests, getSession, getTonight, joinQueue, leaveQueue, pollQueue,
  reportPeer, saveInterests, suggestEvents, type MeetEvent, type MeetSession, type Tonight,
} from "@/lib/meet";

export default function MeetPage() {
  return (
    <RequireAccount title="Speed Meet" caption="Make an account to meet people for 4 minutes.">
      <Meet />
    </RequireAccount>
  );
}

type Phase = "home" | "waiting" | "call" | "decide" | "done";

/**
 * Speed Meet: pick interests, get matched with someone who shares them, talk for 4 minutes, then both choose whether to
 * keep in touch. Also the Tonight screen: why to open Hoppaz when no event is on. Backend: supabase/speed_meet.sql.
 */
function Meet() {
  const router = useRouter();
  const { userId } = useSession();
  const [phase, setPhase] = useState<Phase>("home");
  const [tags, setTags] = useState<string[]>([]);
  const [saved, setSaved] = useState(true);
  const [tonight, setTonight] = useState<Tonight | null>(null);
  const [session, setSession] = useState<MeetSession | null>(null);
  const [events, setEvents] = useState<MeetEvent[]>([]);
  const [result, setResult] = useState<string>("");
  const [dm, setDm] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [ready, setReady] = useState(false);
  const reporting = useRef(false);

  const loadHome = useCallback(async () => {
    const [mine, t] = await Promise.all([getInterests(), getTonight()]);
    if (mine) setTags(mine);
    setTonight(t);
    setReady(true);
  }, []);
  useEffect(() => {
    if (userId) void loadHome();
  }, [userId, loadHome]);

  // While waiting: a heartbeat that also picks up a match someone else made.
  useEffect(() => {
    if (phase !== "waiting") return;
    let stop = false;
    const tick = async () => {
      const s = await pollQueue();
      if (stop) return;
      if (s.status === "matched") {
        setSession(s.session);
        setPhase("call");
      } else if (s.status === "unavailable") {
        setNote("Speed Meet is not switched on yet.");
        setPhase("home");
      } else if (s.status === "idle") {
        setPhase("home");
      }
    };
    const id = window.setInterval(() => void tick(), 4000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [phase]);

  // Leaving the page while waiting takes you out of the queue.
  useEffect(() => () => void leaveQueue(), []);

  const toggle = (t: string) => {
    setSaved(false);
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length >= MAX_INTERESTS ? cur : [...cur, t]));
  };

  const start = async () => {
    setNote("");
    if (!saved) setSaved(await saveInterests(tags));
    const s = await joinQueue();
    if (s.status === "matched") {
      setSession(s.session);
      setPhase("call");
    } else if (s.status === "waiting") setPhase("waiting");
    else setNote(s.status === "unavailable" ? "Speed Meet is not switched on yet." : "Sign in to use Speed Meet.");
  };

  const cancel = async () => {
    await leaveQueue();
    setPhase("home");
    void loadHome();
  };

  const callEnded = async (why: "time" | "hangup" | "error") => {
    if (why === "error") {
      setPhase("home");
      return;
    }
    if (session) setEvents(await suggestEvents(session.id));
    setPhase("decide");
  };

  const decide = async (connect: boolean) => {
    if (!session) return;
    const r = await choose(session.id, connect);
    if (r.startsWith("connected:")) {
      setDm(r.slice(10));
      setResult("connected");
    } else if (r === "waiting") {
      setResult("waiting");
      // The other person may still be deciding: look again for a minute.
      for (let i = 0; i < 12; i++) {
        await new Promise((res) => setTimeout(res, 5000));
        const s = await getSession(session.id);
        if (s === "unavailable" || !s) break;
        if (s.dm_id) {
          setDm(s.dm_id);
          setResult("connected");
          break;
        }
        if (s.peer_choice === false) {
          setResult("passed");
          break;
        }
      }
    } else setResult("passed");
    setPhase("done");
  };

  const block = async () => {
    if (!session) return;
    await blockPeer(session.id);
    setSession(null);
    setPhase("home");
    void loadHome();
  };

  const report = async () => {
    if (!session || reporting.current) return;
    const reason = window.prompt("What happened?");
    if (!reason?.trim()) return;
    reporting.current = true;
    const ok = await reportPeer(session.id, reason);
    reporting.current = false;
    setNote(ok ? "Thanks. We will look at it." : "Could not send the report.");
    if (ok) {
      setSession(null);
      setPhase("home");
    }
  };

  return (
    <div className="h-full overflow-y-auto px-4 pb-24">
      <PageHeader back="/" title="Speed Meet" caption="4 minutes. One voice. Maybe a new friend." />

      {phase === "home" && (
        <>
          <section className="card mb-4" aria-label="Tonight">
            <p className="seclabel mb-2">TONIGHT</p>
            {!ready ? (
              <p className="hint">Looking around.</p>
            ) : tonight ? (
              <>
                <p className="font-body text-[15px]">
                  {tonight.waiting > 0 ? `${tonight.waiting} ${tonight.waiting === 1 ? "person is" : "people are"} waiting to meet someone.` : "Nobody is waiting right now. Be the first."}
                </p>
                {tonight.like_you > 0 && <p className="hint mt-1">{tonight.like_you} Hoppers like what you like.</p>}
                {tonight.live_meets > 0 && <p className="hint mt-1">{tonight.live_meets} {tonight.live_meets === 1 ? "chat is" : "chats are"} happening now.</p>}
                <EventList events={tonight.events} empty="Nothing listed in the next day. Check Events." onOpen={(id) => router.push(`/event/${id}`)} />
              </>
            ) : (
              <p className="hint">Tonight is not available yet.</p>
            )}
          </section>

          <section className="card" aria-label="Your interests">
            <p className="seclabel mb-1">WHAT ARE YOU INTO?</p>
            <p className="hint mb-3">Pick up to {MAX_INTERESTS}. We match you with people who share them.</p>
            <div className="flex flex-wrap gap-2">
              {INTERESTS.map((t) => {
                const on = tags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(t)}
                    className={`min-h-[40px] rounded-full border px-3.5 font-body text-[14px] ${on ? "border-transparent bg-cream text-ink" : "border-line text-cream"}`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
            {note && <p role="alert" className="hint mt-3 text-keke">{note}</p>}
            <button className="btn mt-4 w-full" onClick={() => void start()}>MEET SOMEONE</button>
            <p className="hint mt-2 text-center">Voice only. You can block or report anyone, any time.</p>
          </section>
        </>
      )}

      {phase === "waiting" && (
        <div className="card text-center">
          <p className="font-display text-[22px] font-black">Finding your person</p>
          <p className="hint my-3">Matching on {tags.length ? tags.join(", ") : "anything"}. Stay on this screen.</p>
          <button className="btn btn-ghost w-full" onClick={() => void cancel()}>CANCEL</button>
        </div>
      )}

      {phase === "call" && session && (
        <>
          <p className="hint mb-3 text-center">
            {session.shared.length ? `You both like ${session.shared.join(", ")}.` : "No shared interests yet. Find one."}
          </p>
          <Call sessionId={session.id} peerName={session.peer_name} secondsLeft={session.seconds_left} onEnd={(why) => void callEnded(why)} />
          <div className="mt-3 flex justify-center gap-4">
            <button className="min-h-[44px] font-body text-[14px] text-dim underline underline-offset-4" onClick={() => void block()}>Block</button>
            <button className="min-h-[44px] font-body text-[14px] text-dim underline underline-offset-4" onClick={() => void report()}>Report</button>
          </div>
        </>
      )}

      {phase === "decide" && session && (
        <div className="card">
          <p className="font-display text-[22px] font-black leading-tight">Keep in touch with {session.peer_name}?</p>
          <p className="hint my-2">You only connect if you both say yes. They will not see your answer if you pass.</p>
          <EventList events={events} empty="" title="You could go together" onOpen={(id) => router.push(`/event/${id}`)} />
          <div className="mt-4 flex gap-2">
            <button className="btn btn-ghost min-h-11 flex-1" onClick={() => void decide(false)}>NOT THIS TIME</button>
            <button className="btn min-h-11 flex-1" onClick={() => void decide(true)}>YES</button>
          </div>
          <div className="mt-2 flex justify-center gap-4">
            <button className="min-h-[44px] font-body text-[14px] text-dim underline underline-offset-4" onClick={() => void block()}>Block</button>
            <button className="min-h-[44px] font-body text-[14px] text-dim underline underline-offset-4" onClick={() => void report()}>Report</button>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="card text-center">
          <p className="font-display text-[22px] font-black">
            {result === "connected" ? "You are connected" : result === "waiting" ? "Waiting for them" : "Maybe next time"}
          </p>
          <p className="hint my-3">
            {result === "connected"
              ? `${session?.peer_name ?? "They"} is in your crew now. Say hi.`
              : result === "waiting"
                ? "If they say yes too, you will be crew and the chat opens."
                : "No hard feelings. Plenty more people to meet."}
          </p>
          {dm && <button className="btn mb-2 w-full" onClick={() => router.push(`/chat/dm/${dm}`)}>OPEN CHAT</button>}
          <button className="btn btn-ghost w-full" onClick={() => { setPhase("home"); setSession(null); setResult(""); setDm(null); void loadHome(); }}>
            MEET SOMEONE ELSE
          </button>
        </div>
      )}
    </div>
  );
}

function EventList({ events, empty, title, onOpen }: { events: MeetEvent[]; empty: string; title?: string; onOpen: (id: string) => void }) {
  if (!events.length) return empty ? <p className="hint mt-3">{empty}</p> : null;
  return (
    <div className="mt-3">
      {title && <p className="label mb-1">{title}</p>}
      <ul className="flex flex-col gap-2">
        {events.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onOpen(e.id)} className="w-full rounded-hz border border-line px-3 py-2 text-left">
              <span className="block font-display text-[15px] font-black leading-tight">{e.title}</span>
              <span className="hint">
                {e.venue} · {new Date(e.starts_at).toLocaleString("en-NG", { weekday: "short", hour: "numeric", minute: "2-digit" })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
