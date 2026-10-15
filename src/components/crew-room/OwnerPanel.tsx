"use client";

import { ChevronRight, Settings2 } from "lucide-react";
import { FaceDisc } from "@/components/Avatar";
import { useFeatured } from "@/lib/crew-room/featured";
import { useExploreStore, useGoOut } from "@/lib/crew-room/rails";
import { useCrewStaff, type Staff } from "@/lib/crew-room/staff";
import { sayHi, sayResult, useVibes } from "@/lib/crew-room/vibes";
import { messageCrew } from "@/lib/social";

/**
 * The owner's logo (top right in a room) opens this: who runs the room. The owner, then the admins when there are any, each
 * with a face, a name and since when, and one action under the crew = friends rule: SAY HI if they are not your crew,
 * MESSAGE if they are. A wave to an owner who is away waits in their inbox.
 *
 * ANNOUNCEMENTS go under the people when the room has any. They are not built yet, so nothing is drawn for them: no empty
 * heading, no sample line. The owner also gets ROOM SETTINGS at the foot.
 */
export default function OwnerPanel({ crewId }: { crewId: string }) {
  const { people, failed, reload } = useCrewStaff(crewId);
  const { isOwner } = useFeatured(crewId);
  return <OwnerPanelView crewId={crewId} people={people} failed={failed} isOwner={isOwner} onRetry={() => void reload()} />;
}

/** The panel itself, from what it is given: the data comes from OwnerPanel above, or from a sample on the dev page. */
export function OwnerPanelView({
  crewId,
  people,
  failed,
  isOwner,
  onRetry,
}: {
  crewId: string;
  people: Staff[] | null;
  failed: boolean;
  isOwner: boolean;
  onRetry: () => void;
}) {
  const goOut = useGoOut();
  const owners = (people ?? []).filter((p) => p.role === "owner");
  const admins = (people ?? []).filter((p) => p.role !== "owner");

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-owner-panel>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ touchAction: "pan-y" }}>
        {people === null && !failed && <Skeleton />}
        {failed && people === null && (
          <div className="flex flex-col items-start gap-3 px-3 py-4">
            <p className="hint">Couldn&apos;t load.</p>
            <button type="button" className="chip" onClick={onRetry}>
              RETRY
            </button>
          </div>
        )}
        {owners.length > 0 && <Section label={owners.length === 1 ? "Owner" : "Owners"} people={owners} crewId={crewId} />}
        {admins.length > 0 && <Section label="Admins" people={admins} crewId={crewId} />}
      </div>
      {isOwner && (
        <a
          href={`/crew/${crewId}?manage=1`}
          onClick={(e) => {
            e.preventDefault();
            goOut(`/crew/${crewId}?manage=1`);
          }}
          className="flex min-h-[48px] flex-none items-center gap-3 border-t border-line px-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-cream active:bg-ink-3"
        >
          <Settings2 size={16} aria-hidden />
          <span className="flex-1">ROOM SETTINGS</span>
          <ChevronRight size={16} className="text-dim" aria-hidden />
        </a>
      )}
    </div>
  );
}

function Section({ label, people, crewId }: { label: string; people: Staff[]; crewId: string }) {
  return (
    <>
      <p className="seclabel px-3 pb-1 pt-3">{label}</p>
      {people.map((p) => (
        <Person key={p.id} person={p} crewId={crewId} />
      ))}
    </>
  );
}

const month = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-NG", { month: "short", year: "numeric", timeZone: "Africa/Lagos" }).toUpperCase() : null;

function Person({ person, crewId }: { person: Staff; crewId: string }) {
  const goOut = useGoOut();
  const waved = useVibes((s) => !!s.waved[person.id]);
  const since = month(person.since);

  const hi = () => {
    useExploreStore.getState().hide();
    void sayHi(crewId, { id: person.id, name: person.name, look: person.look }).then((r) => sayResult(r, (dm) => goOut(`/chat/dm/${dm}`), person.id));
  };
  const message = async () => {
    const r = await messageCrew(person.id);
    if (r.dm) goOut(`/chat/dm/${r.dm}`);
    else useVibes.getState().say(r.text ?? "COULD NOT OPEN THE CHAT", 3500, undefined, { own: true });
  };

  return (
    <div className="flex min-h-[64px] items-center gap-3 border-b border-line px-3 py-2">
      <FaceDisc look={person.look} initial={person.name} size={40} />
      <span className="min-w-0 flex-1">
        <b className="block truncate font-body text-[15px] font-semibold leading-5">{person.name}</b>
        <span className="block truncate font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-dim">
          {since ? `SINCE ${since}` : person.role === "owner" ? "OWNER" : "ADMIN"}
        </span>
      </span>
      {person.me ? (
        <span className="pill flex-none">YOU</span>
      ) : person.crew ? (
        <button type="button" className="btn flex-none px-3 text-[12px]" onClick={() => void message()}>
          MESSAGE
        </button>
      ) : (
        <button type="button" className="btn flex-none px-3 text-[12px]" onClick={hi} disabled={waved}>
          {waved ? "WAVED" : "SAY HI"}
        </button>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy aria-label="Loading">
      <div className="flex h-[64px] items-center gap-3 border-b border-line px-3">
        <span className="h-10 w-10 flex-none rounded-full bg-ink-3" />
        <span className="flex-1 space-y-2">
          <span className="block h-3 w-2/3 rounded-[3px] bg-ink-3" />
          <span className="block h-2.5 w-1/3 rounded-[3px] bg-ink-3" />
        </span>
      </div>
    </div>
  );
}
