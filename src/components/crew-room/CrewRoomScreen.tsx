"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, X } from "lucide-react";
import RequireAccount from "@/components/app/RequireAccount";
import CampaignExperience from "@/components/campaign/CampaignExperience";
import { warmSprites } from "@/components/campaign/spriteCache";
import VerifiedBadge from "@/components/VerifiedBadge";
import { validCampaignUrl } from "@/lib/campaign/layout";
import type { CrewRoomConnection } from "@/lib/crew-room/types";
import { useCrewEvents } from "@/lib/crew-room/hub";
import { useCrewRoom } from "@/lib/crew-room/useCrewRoom";
import { useRoomStore } from "@/lib/crew-room/roomStore";
import { useRoomTrack } from "@/lib/sound/roomTrack";
import { getSupabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/useSession";
import campaign from "@/components/campaign/Campaign.module.css";
import css from "./CrewRoom.module.css";

/**
 * /crew/<id>/room. A guest gets the sign-up right here (Google first) and is back in this room the moment they are
 * in: the email form re-renders this page, and Google returns to this address. A signed-in Hopper who is not in the
 * crew gets one button to join and walk in.
 */
export default function CrewRoomScreen({ crewId }: { crewId: string }) {
  return (
    <RequireAccount
      title="Your crew has a place."
      caption="Make an account to walk into this room, meet your people and join the conversation. You come straight back here."
    >
      <ConnectedRoom crewId={crewId} />
    </RequireAccount>
  );
}

function ConnectedRoom({ crewId }: { crewId: string }) {
  const { userId } = useSession();
  const room = useCrewRoom(crewId, userId);
  // Pay the one-off start-up cost of drawing avatars while the "Walking in" screen is up and nothing moves.
  useEffect(() => {
    const t = setTimeout(warmSprites, 120);
    return () => clearTimeout(t);
  }, []);
  // The room music, once inside: the owner's own loop when they set one, otherwise the room theme (MusicHost).
  const inside = room.status === "ready";
  const own = room.snapshot ? validCampaignUrl(room.snapshot.room.content.audioUrl) : null;
  useEffect(() => {
    useRoomTrack.getState().set(inside, own);
  }, [inside, own]);
  useEffect(() => () => useRoomTrack.getState().set(false, null), []);
  if (room.status === "ready" && room.snapshot && room.world && userId) return <CrewRoomView crewId={crewId} userId={userId} room={room} />;
  return <RoomGate crewId={crewId} room={room} />;
}

type CrewCard = { name: string; visibility: "open" | "private"; verified?: boolean };

/** Everything before the room: opening, joining the crew, a room open somewhere else, and anything that went wrong. */
function RoomGate({ crewId, room }: { crewId: string; room: CrewRoomConnection }) {
  const [crew, setCrew] = useState<CrewCard | null | undefined>(undefined);
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [problem, setProblem] = useState("");
  const outside = room.status === "error" && room.reason === "not_in_crew";

  // Open crews can be read by anyone, so the gate can name the crew and offer the join; a private one cannot.
  useEffect(() => {
    if (!outside) return;
    const sb = getSupabase();
    if (!sb) return;
    let live = true;
    void sb
      .from("crews")
      .select("*")
      .eq("id", crewId)
      .maybeSingle()
      .then(({ data }) => {
        if (live) setCrew((data as CrewCard | null) ?? null);
      });
    return () => {
      live = false;
    };
  }, [outside, crewId]);

  const join = async (invite: string) => {
    const sb = getSupabase();
    if (!sb || joining) return;
    setJoining(true);
    setProblem("");
    const { data, error } = await sb.rpc("join_crew", { p_invite: invite });
    setJoining(false);
    if (data === crewId) room.retry();
    else if (data) setProblem("You joined, but that code is for a different crew.");
    else setProblem(error ? "Couldn't join. Try again." : "That code didn't work. Check it and try again.");
  };

  if (room.status === "loading") {
    // The room's own frame while it opens: the app's header, a dark lawn and two words, so nothing jumps when the world lands.
    return (
      <div className={campaign.experience}>
        <header className={campaign.header}>
          <Link href={`/crew/${crewId}`} className={campaign.back} aria-label="Back to the room">
            <ChevronLeft size={26} strokeWidth={2.2} aria-hidden />
          </Link>
        </header>
        <div className={campaign.stage}>
          <div className={campaign.viewport}>
            <p className={campaign.walkingIn} role="status">
              Walking in
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (room.status === "replaced") {
    return (
      <div className={css.gate}>
        <h1>This room is open somewhere else.</h1>
        <p role="alert">{room.error} Your unsent messages are kept.</p>
        <nav>
          <button type="button" className={css.primary} onClick={room.retry}>
            Use the room here
          </button>
          <Link href="/crew">Back to ROOMZ</Link>
        </nav>
      </div>
    );
  }

  if (outside) {
    const open = crew?.visibility === "open";
    return (
      <div className={css.gate}>
        <h1 className={css.gateTitle}>
          <span>{crew?.name ?? "A room"}</span>
          {crew?.verified && <VerifiedBadge size={22} />}
        </h1>
        <p>
          {crew === undefined
            ? "Checking the room…"
            : open
              ? "Join this crew to walk into its room, chat with everyone in it and be there when things happen."
              : "This crew is private. Ask someone in it for the invite code."}
        </p>
        {open ? (
          <nav>
            <button type="button" className={css.primary} disabled={joining} onClick={() => void join(crewId)}>
              {joining ? "Joining…" : "Join and walk in"}
            </button>
            <Link href="/crew">Back to ROOMZ</Link>
          </nav>
        ) : (
          crew !== undefined && (
            <form
              className={css.codeRow}
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim()) void join(code.trim());
              }}
            >
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Invite code" aria-label="Invite code" autoComplete="off" />
              <button type="submit" className={css.primary} disabled={joining || !code.trim()}>
                {joining ? "Joining…" : "Join"}
              </button>
            </form>
          )
        )}
        {problem && (
          <p role="alert" className={css.error}>
            {problem}
          </p>
        )}
        {!open && crew !== undefined && (
          <nav>
            <Link href="/crew">Back to ROOMZ</Link>
          </nav>
        )}
      </div>
    );
  }

  return (
    <div className={css.gate}>
      <h1>This room could not open.</h1>
      <p role="alert">{room.error}</p>
      <nav>
        <button type="button" onClick={room.retry}>
          Try again
        </button>
        <Link href={`/rooms/${crewId}/general`}>Open the chat</Link>
        <Link href="/crew">Back to ROOMZ</Link>
      </nav>
    </div>
  );
}

export function CrewRoomView({ crewId, userId, room }: { crewId: string; userId: string; room: CrewRoomConnection }) {
  const snapshot = room.snapshot!;
  const world = room.world!;
  // The Stage's next event: the crew's own (by its event words, or its name), not just any big night.
  const { events, matched } = useCrewEvents(snapshot.room.content.eventKeywords?.trim() || snapshot.crew.name, 1);
  // A line said once ("You had this room open somewhere else") goes by itself after a few seconds.
  const notice = room.notice;
  const dismissNotice = room.dismissNotice;
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(dismissNotice, 6000);
    return () => clearTimeout(t);
  }, [notice, dismissNotice]);
  // From the crew page's chat preview (?chat=1): open the chat sheet once the room is up.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("chat")) return;
    const t = setTimeout(() => useRoomStore.getState().setSheet("half"), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <CampaignExperience
      crew={{
        id: crewId,
        name: snapshot.crew.name,
        verified: snapshot.crew.verified,
        content: snapshot.room.content,
        template: snapshot.room.template,
        width: snapshot.room.width,
        editable: snapshot.crew.is_owner,
        connected: room.connected,
        nextEvent: matched ? (events[0] ?? null) : null,
        room,
        userId,
        world,
        here: snapshot.peers.length,
        notice: room.notice ? (
          <p className={css.notice} role="status">
            <span>{room.notice}</span>
            <button type="button" onClick={room.dismissNotice} aria-label="Dismiss">
              <X size={15} aria-hidden />
            </button>
          </p>
        ) : null,
        onSave: (content, width) => room.save(width, content),
      }}
    />
  );
}
