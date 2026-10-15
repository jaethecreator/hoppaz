"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DoorOpen, Users } from "lucide-react";
import LoadingStub from "@/components/app/LoadingStub";
import Mascot from "@/components/Mascot";
import HubHeader from "@/components/crew-room/HubHeader";
import Featured from "@/components/crew-room/CrewHubFeatured";
import RoomNow from "@/components/crew-room/CrewHubNow";
import { requireAccount } from "@/lib/accountGate";
import { useCrewCard } from "@/lib/crew-room/hub";
import { getSupabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/useSession";

/**
 * /crew/join/<code>: a crew's invite link, inside the app with its bottom nav. Shows the crew the way its hub does (its
 * pictures, name, verified tick, round logo, members, who is in its room now) and one JOIN button. Signed in, that tap joins and walks into the room. A guest gets the usual sign-up sheet: the email
 * form finishes the join straight after, and Google comes back to this page marked ?go=1, which finishes it here.
 */
export default function JoinCrew({ code }: { code: string }) {
  const router = useRouter();
  const { card, state } = useCrewCard({ code });
  const { hasAccount, state: session } = useSession();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const finishing = useRef(false);

  const join = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || finishing.current) return;
    finishing.current = true;
    setBusy(true);
    setProblem("");
    const { data, error } = await sb.rpc("crew_join_code", { p_code: code });
    const out = data as { ok: boolean; crew_id?: string; reason?: string } | null;
    if (error || !out?.ok || !out.crew_id) {
      finishing.current = false;
      setBusy(false);
      setProblem(
        error?.message.includes("slow_down")
          ? "Too many tries. Wait a few minutes, then tap JOIN again."
          : error?.message.includes("need_account")
            ? "Make an account first, then tap JOIN."
            : out?.reason === "invalid_code"
              ? "This invite link no longer works. Ask the crew for a new one."
              : "Couldn't join. Try again."
      );
      return;
    }
    router.replace(`/crew/${out.crew_id}/room`);
  }, [code, router]);

  // Back from Google sign-in with the join still to do.
  useEffect(() => {
    if (!hasAccount || !card || card.is_member) return;
    if (new URLSearchParams(window.location.search).get("go") !== "1") return;
    void join();
  }, [hasAccount, card, join]);

  const onJoin = () => {
    // Marked first, so a sign-in that leaves the page (Google) comes back knowing what was asked.
    if (!hasAccount) window.history.replaceState(window.history.state, "", `${window.location.pathname}?go=1`);
    if (requireAccount("join this crew", () => void join())) void join();
  };

  if (state === "loading" && !card) {
    return (
      <div className="h-full px-4 pt-16">
        <LoadingStub label="Loading the invite" lines={2} />
      </div>
    );
  }

  if (!card) {
    return (
      <div className="h-full overflow-y-auto px-4 pb-8">
        <header className="pad-top flex items-center gap-3 pb-4">
          <Mascot state="oya" size={84} className="flex-none" />
          <div className="min-w-0">
            <h1 className="font-display text-[28px] font-black leading-[1.05]">This invite has expired.</h1>
            <p className="hint mt-1.5">The crew made a new link. Ask them to send it again.</p>
          </div>
        </header>
        <Link href="/crew" className="btn btn-ghost w-full">
          SEE CREWS
        </Link>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pb-8" data-hub-scroll>
      <div className="mx-auto w-full max-w-[760px]">
        <HubHeader
          images={card.header_images}
          title={card.brand}
          verified={card.verified}
          logoUrl={card.logo_url}
          kicker="YOU'RE INVITED"
          back="/crew"
          meta={
            <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-dim" data-members={card.members}>
              <Users size={12} aria-hidden /> {card.members} {card.members === 1 ? "member" : "members"}
            </p>
          }
        />

        <div className="px-4">
          <div className="mt-4">
            <RoomNow card={card} none="The room is quiet right now" quiet="A walk-in room with music, General chat and corners to talk in." />
          </div>

          {card.is_member ? (
            <Link href={`/crew/${card.id}/room`} className="btn mt-3 w-full text-[15px]" data-enter-room>
              <DoorOpen size={18} aria-hidden /> YOU&apos;RE IN. ENTER THE ROOM
            </Link>
          ) : (
            <button type="button" className="btn mt-3 w-full text-[15px]" disabled={busy || session === "loading"} onClick={onJoin} data-join>
              <DoorOpen size={18} aria-hidden /> {busy ? "JOINING…" : "JOIN THE CREW"}
            </button>
          )}
          {problem && (
            <p role="alert" className="mt-3 font-body text-[14px] font-medium text-fireant">
              {problem}
            </p>
          )}
          {!hasAccount && !card.is_member && (
            <p className="hint mt-3 text-center">Free. Make an account in 20 seconds and you land straight in the room.</p>
          )}
          <Featured card={card} />
        </div>
      </div>
    </div>
  );
}
