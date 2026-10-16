"use client";

/* eslint-disable @next/next/no-img-element -- crew logos are brand supplied, sizes unknown */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, Download, ExternalLink, Megaphone, Plus } from "lucide-react";
import VerifiedBadge from "@/components/VerifiedBadge";
import { templateFor } from "@/lib/campaign/templates";
import { useToast } from "@/lib/store";
import { Block, EmptyCard, LiveDropCard, PastDropCard, UpcomingDrops } from "./DropCards";
import { dayWord, hhmm, isOver, plural, seriesName, winsOnKey } from "./format";
import type { Crew, CrewInfo, GameTimeDeskApi } from "./types";
import { fetchCrewInfo } from "./useDesk";

/** A round picture for a room: its logo, or its first letter on a card-coloured disc (also when the logo does not load). */
export function RoomAvatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const [bad, setBad] = useState<string | null>(null);
  const shown = src && bad !== src ? src : null;
  return (
    <span
      className="inline-flex flex-none items-center justify-center overflow-hidden rounded-full bg-ink-3 font-display font-black text-dim"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden
    >
      {shown ? <img src={shown} alt="" className="h-full w-full object-cover" onError={() => setBad(shown)} /> : name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="seclabel mb-3 text-cream">{title}</h3>
      <div className="card p-4">{children}</div>
    </section>
  );
}

const byOpens = (a: { opens_at: string }, b: { opens_at: string }) => Date.parse(a.opens_at) - Date.parse(b.opens_at);

/**
 * A crew room on the staff desk: who it is, the drop that is live, the drops coming up, every past drop on its own card,
 * and on the side the members, who can win and the announcements. The room's facts (members, who is in it, announcements)
 * are read again every 30 s while it is open; until they arrive the desk shows what the drops already know.
 */
export default function RoomOverview({ crew, gt, onAdd }: { crew: Crew; gt: GameTimeDeskApi; onAdd: () => void }) {
  const say = useToast((s) => s.say);
  const { headers } = gt;
  const [got, setGot] = useState<CrewInfo | null>(null);
  const [pastShown, setPastShown] = useState(6);

  useEffect(() => {
    let alive = true;
    const read = async () => {
      const i = await fetchCrewInfo(headers, crew.id);
      if (alive && i) setGot(i);
    };
    void read();
    const t = setInterval(() => void read(), 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [headers, crew.id]);
  // A crew that was just switched to must not show the last one's numbers.
  const info = got?.id === crew.id ? got : null;

  const games = useMemo(() => (gt.desk?.games ?? []).filter((g) => g.crew_id === crew.id), [gt.desk, crew.id]);
  const live = games.filter((g) => g.phase === "live");
  const upcoming = games.filter((g) => g.phase === "upcoming").sort(byOpens);
  const past = games.filter((g) => isOver(g.phase)).sort((a, b) => byOpens(b, a));

  const lead = live[0] ?? upcoming[0] ?? past[0];
  const members = info?.members ?? lead?.members ?? null;
  const inRoom = info?.in_room ?? live[0]?.in_room ?? null;
  const capacity = info?.capacity ?? lead?.room_capacity ?? null;
  const code = info?.invite_code ?? crew.invite_code ?? null;
  const logo = info?.logo_url ?? crew.logo_url ?? null;
  const announcements = info?.announcements ?? [];
  const tooSmall = capacity !== null && members !== null && members > capacity && (live.length > 0 || upcoming.length > 0);

  // The win rule that matters next: the next drop's, else the latest one's.
  const ruleGame = upcoming[0] ?? [...games].sort((a, b) => byOpens(b, a))[0];
  const won = ruleGame ? winsOnKey(gt.desk?.games ?? [], ruleGame.campaign_key) : 0;

  const sub = [
    crew.verified ? "Brand crew" : "Crew",
    `${templateFor(crew.template).name.replace(/^The /, "")} room`,
    members !== null ? plural(members, "member") : "",
    inRoom !== null ? `${inRoom} in the room` : "",
  ].filter(Boolean);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/crew/join/${code}`);
      say("INVITE LINK COPIED", "violet");
    } catch {
      say("COULD NOT COPY THE LINK");
    }
  };

  return (
    <div className="px-4 py-5 lg:px-7 lg:py-7" data-desk-room={crew.id}>
      <header className="flex flex-wrap items-start gap-x-5 gap-y-4">
        <div className="flex min-w-0 flex-1 basis-[18rem] items-start gap-4">
          <RoomAvatar name={crew.name} src={logo} size={56} />
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-x-2 font-display text-2xl font-black leading-tight [overflow-wrap:anywhere]">
              {crew.name}
              {crew.verified && <VerifiedBadge size={20} />}
            </h2>
            <p className="mt-1 text-[15px] leading-snug text-dim">{sub.join(" · ")}</p>
          </div>
        </div>
        <div className="flex w-full gap-2 lg:w-auto">
          <button type="button" className="btn flex-1 lg:flex-none" onClick={onAdd}>
            <Plus size={16} aria-hidden /> ADD A DROP
          </button>
          <a href={`/crew/${crew.id}/room`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost flex-none px-3 sm:px-4" aria-label="Open the room in a new tab">
            <ExternalLink size={16} aria-hidden />
            <span className="hidden sm:inline">OPEN ROOM</span>
          </a>
          {code && (
            <button type="button" className="btn btn-ghost flex-none px-3 sm:px-4" onClick={() => void copyInvite()} aria-label="Copy the invite link">
              <Copy size={16} aria-hidden />
              <span className="hidden sm:inline">INVITE LINK</span>
            </button>
          )}
        </div>
      </header>

      <div className="mt-7 grid gap-7 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-6">
        <div className="min-w-0 space-y-7">
          <Block title="Live now">
            {live.length ? (
              <div className="grid gap-3">
                {live.map((g) => (
                  <LiveDropCard key={g.id} game={g} gt={gt} />
                ))}
              </div>
            ) : (
              <EmptyCard>
                Nothing live.{" "}
                <button type="button" className="font-mono text-[12px] font-bold tracking-[0.04em] text-orange underline-offset-2 hover:underline" onClick={onAdd}>
                  ADD A DROP
                </button>{" "}
                to plan one.
              </EmptyCard>
            )}
          </Block>

          <Block title="Coming up" note={upcoming.length ? plural(upcoming.length, "drop") : undefined}>
            {upcoming.length ? <UpcomingDrops games={upcoming} gt={gt} /> : <EmptyCard>Nothing planned.</EmptyCard>}
          </Block>

          <Block title="Past drops" note="Each drop on its own card">
            {past.length ? (
              <div className="grid gap-3">
                {past.slice(0, pastShown).map((g) => (
                  <PastDropCard key={g.id} game={g} gt={gt} />
                ))}
                {past.length > pastShown && (
                  <button type="button" className="btn btn-ghost" onClick={() => setPastShown((n) => n + 10)}>
                    SHOW MORE ({past.length - pastShown})
                  </button>
                )}
              </div>
            ) : (
              <EmptyCard>No past drops yet.</EmptyCard>
            )}
          </Block>

          <button type="button" className="btn btn-ghost" onClick={() => void gt.exportCsv(null, "game-time-winners.csv")}>
            <Download size={14} aria-hidden /> EXPORT ALL WINNERS (CSV)
          </button>
        </div>

        <aside className="min-w-0 space-y-7">
          <SideCard title="Members">
            <p className="num text-4xl">{members ?? "?"}</p>
            {info?.joined_today != null && <p className="seclabel mt-3">+{info.joined_today} joined today</p>}
            {capacity !== null && <p className="hint mt-3 text-[14px]">The room fits {capacity} people at once.</p>}
            {tooSmall && <p className="mt-2 text-[13px] leading-snug text-fireant">Raise the room&apos;s capacity before a big drop.</p>}
          </SideCard>

          <SideCard title="Who can win">
            {ruleGame ? (
              <>
                <p className="font-display text-[17px] font-black leading-snug">One ticket per person across {seriesName(ruleGame.campaign_key, crew.name)}</p>
                <p className="hint mt-2 text-[14px]">
                  {won === 0 ? "Nobody has won on this rule yet." : `${won === 1 ? "1 person has" : `${won} people have`} won on this rule and cannot win again.`} Crew members only.
                </p>
              </>
            ) : (
              <p className="hint text-[14px]">No drops yet. Each new drop asks who can win.</p>
            )}
          </SideCard>

          <SideCard title="Announcements">
            {announcements.length ? (
              <ul className="grid gap-4">
                {announcements.map((a) => (
                  <li key={a.id} className="flex items-start gap-3">
                    <Megaphone size={16} className="mt-1 flex-none text-orange" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[15px] leading-snug [overflow-wrap:anywhere]">{a.body}</p>
                      <p className="hint mt-0.5">
                        {dayWord(a.created_at).replace(/^./, (c) => c.toUpperCase())} {hhmm(a.created_at)}
                        {a.author ? ` · ${a.author}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint text-[14px]">No announcements.</p>
            )}
          </SideCard>
        </aside>
      </div>
    </div>
  );
}
