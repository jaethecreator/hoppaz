"use client";

import { useMemo, useState } from "react";
import { MessageCircle, Search } from "lucide-react";
import { FaceDisc } from "@/components/Avatar";
import CrewSheet, { type CrewPerson } from "@/components/social/CrewSheet";
import type { CrewFace, WaveIn } from "@/lib/social";
import ChatFace from "./ChatFace";
import AccountNudge from "./AccountNudge";

/**
 * The CREW tab of Chat: your friends. Waves waiting for you sit on top (WAVE BACK or PASS), then everyone who is crew with a
 * search to find one, then the one setting that is about being seen: SHOW ME ON THE MAP, off until you switch it on.
 * Tap a friend for MESSAGE or POKE.
 */
export default function CrewTab({
  waves,
  crew,
  hasAccount,
  onMap,
  onToggleMap,
  onAnswer,
  onPass,
}: {
  waves: WaveIn[];
  crew: CrewFace[];
  hasAccount: boolean;
  /** The Hopper has chosen to be on their crew's map. Undefined hides the row (nothing draws friends yet). */
  onMap?: boolean;
  onToggleMap?: () => void;
  onAnswer: (wave: WaveIn) => void;
  onPass: (wave: WaveIn) => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<CrewPerson | null>(null);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? crew.filter((c) => c.name.toLowerCase().includes(t)) : crew;
  }, [crew, q]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto pb-3">
      {!hasAccount && <AccountNudge text="Make an account to wave back and build your crew." />}

      {waves.length > 0 && (
        <>
          <p className="seclabel mb-2">Waved at you</p>
          {waves.map((w) => (
            <div key={w.id} className="card mb-2 flex items-center gap-3 py-3">
              <ChatFace look={w.look} alias={w.look ? null : w.name} size={38} caption={!w.look} />
              <div className="min-w-0 flex-1">
                <b className="block truncate font-display text-[15px] font-semibold">{w.room ? w.name : `@${w.name}`}</b>
                {w.where && <p className="hint truncate">{w.where}</p>}
              </div>
              <button className="btn px-3" onClick={() => onAnswer(w)}>WAVE BACK</button>
              <button className="btn btn-ghost px-3" onClick={() => onPass(w)}>PASS</button>
            </div>
          ))}
        </>
      )}

      <p className={`seclabel mb-2 ${waves.length > 0 ? "mt-4" : ""}`}>Your crew{crew.length > 0 ? ` · ${crew.length}` : ""}</p>
      {crew.length > 0 && (
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-3.5 text-dim" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find someone in your crew" className="pl-9" autoComplete="off" aria-label="Find someone in your crew" />
        </div>
      )}
      {crew.length === 0 ? (
        <p className="hint">Say hi to someone in a crew room. When they wave back, they&apos;re here.</p>
      ) : list.length === 0 ? (
        <p className="hint">Nobody in your crew by that name.</p>
      ) : (
        list.map((c) => (
          <button
            key={c.id}
            type="button"
            className="card mb-2 flex w-full items-center gap-3 py-3 text-left"
            onClick={() => setPicked({ id: c.id, name: c.name, look: c.look })}
            aria-label={`Message or poke ${c.name}`}
          >
            <FaceDisc look={c.look} initial={c.name} size={38} />
            <b className="min-w-0 flex-1 truncate font-display text-[15px] font-semibold">{c.name}</b>
            <MessageCircle size={16} className="flex-none text-dim" aria-hidden />
          </button>
        ))
      )}

    </div>
      {/* Pinned, so it is always in view: being seen on the map is the one thing here that is yours to switch on. */}
      {onMap !== undefined && onToggleMap && (
        <div className="flex flex-none items-center gap-3 border-t border-line py-2">
          <b className="min-w-0 flex-1 font-display text-[15px] font-semibold">Show me on the map</b>
          <button type="button" role="switch" aria-checked={onMap} aria-label="Show me on the map to my crew" className="chip" onClick={onToggleMap}>
            {onMap ? "ON" : "OFF"}
          </button>
        </div>
      )}
      {picked && <CrewSheet person={picked} onClose={() => setPicked(null)} />}
    </div>
  );
}
