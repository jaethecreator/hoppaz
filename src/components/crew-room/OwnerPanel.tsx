"use client";

import { useState } from "react";
import { ChevronRight, Plus, Settings2 } from "lucide-react";
import { chatTime } from "@/components/chat/Bubble";
import { FaceDisc } from "@/components/Avatar";
import {
  announce,
  deleteAnnouncement,
  editAnnouncement,
  useAnnouncements,
  type Announcement,
  type Result,
} from "@/lib/crew-room/announcements";
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
 * ANNOUNCEMENTS (src/lib/crew-room/announcements.ts) go under the people, latest first, and nothing is drawn for them when the
 * room has none and this member cannot post: no empty heading, no sample line. The owner (and admins) get "+ NEW ANNOUNCEMENT",
 * 280 characters, edit and delete on each, at most 2 a day. Opening this panel is what marks them seen (Explore.tsx). The owner
 * also gets ROOM SETTINGS at the foot.
 */
export default function OwnerPanel({ crewId }: { crewId: string }) {
  const { people, failed, reload } = useCrewStaff(crewId);
  const { isOwner } = useFeatured(crewId);
  const a = useAnnouncements(crewId);
  return (
    <OwnerPanelView
      crewId={crewId}
      people={people}
      failed={failed}
      isOwner={isOwner}
      onRetry={() => void reload()}
      news={
        a.supported
          ? {
              items: a.items,
              isStaff: a.isStaff,
              canSend: a.canSend,
              onSend: (body) => announce(crewId, body),
              onEdit: (id, body) => editAnnouncement(crewId, id, body),
              onDelete: (id) => deleteAnnouncement(crewId, id),
            }
          : undefined
      }
    />
  );
}

/** What the panel needs to draw and act on a room's announcements. Leave it out and there is no section. */
export type News = {
  items: Announcement[];
  isStaff: boolean;
  canSend: boolean;
  onSend: (body: string) => Promise<Result>;
  onEdit: (id: string, body: string) => Promise<Result>;
  onDelete: (id: string) => Promise<Result>;
};

/** The panel itself, from what it is given: the data comes from OwnerPanel above, or from a sample on the dev page. */
export function OwnerPanelView({
  crewId,
  people,
  failed,
  isOwner,
  onRetry,
  news,
}: {
  crewId: string;
  people: Staff[] | null;
  failed: boolean;
  isOwner: boolean;
  onRetry: () => void;
  news?: News;
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
        {news && (news.items.length > 0 || news.isStaff) && <Announcements news={news} />}
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

/** ANNOUNCEMENTS: latest first. Staff get the compose button and edit and delete on each. */
function Announcements({ news }: { news: News }) {
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <>
      <p className="seclabel px-3 pb-1 pt-4">Announcements</p>
      {news.isStaff &&
        (composing ? (
          <Editor
            initial=""
            label="POST"
            onCancel={() => setComposing(false)}
            onSave={async (body) => {
              const r = await news.onSend(body);
              if (r.ok) setComposing(false);
              return r;
            }}
          />
        ) : (
          <div className="px-3 pb-2">
            <button type="button" className="btn btn-ghost w-full text-[12px]" disabled={!news.canSend} onClick={() => setComposing(true)}>
              <Plus size={14} aria-hidden /> {news.canSend ? "NEW ANNOUNCEMENT" : "2 A DAY. TRY TOMORROW"}
            </button>
          </div>
        ))}
      {news.items.map((a) =>
        editing === a.id ? (
          <Editor
            key={a.id}
            initial={a.body}
            label="SAVE"
            onCancel={() => setEditing(null)}
            onSave={async (body) => {
              const r = await news.onEdit(a.id, body);
              if (r.ok) setEditing(null);
              return r;
            }}
          />
        ) : (
          <Note key={a.id} item={a} staff={news.isStaff} onEdit={() => setEditing(a.id)} onDelete={() => news.onDelete(a.id)} />
        )
      )}
    </>
  );
}

function Note({ item, staff, onEdit, onDelete }: { item: Announcement; staff: boolean; onEdit: () => void; onDelete: () => Promise<Result> }) {
  const [sure, setSure] = useState(false);
  return (
    <article className="border-b border-line px-3 py-2.5" data-announcement={item.id}>
      <p className="whitespace-pre-wrap break-words font-body text-[14px] leading-snug text-cream">{item.body}</p>
      <p className="mt-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
        {item.fresh && <i aria-label="New" className="h-1.5 w-1.5 flex-none rounded-full bg-orange" />}
        <span className="min-w-0 truncate">
          {item.by} · {chatTime(item.at)}
          {item.edited ? " · EDITED" : ""}
        </span>
      </p>
      {staff && (
        <div className="mt-1 flex gap-4">
          <button type="button" className="min-h-[36px] font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-dim" onClick={onEdit}>
            EDIT
          </button>
          <button
            type="button"
            className="min-h-[36px] font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-fireant"
            onClick={() => {
              if (!sure) {
                setSure(true);
                setTimeout(() => setSure(false), 3000);
              } else void onDelete();
            }}
          >
            {sure ? "SURE?" : "DELETE"}
          </button>
        </div>
      )}
    </article>
  );
}

/** One box for a new announcement and for an edit: 280 characters, a count, a refusal in one line. */
function Editor({ initial, label, onSave, onCancel }: { initial: string; label: string; onSave: (body: string) => Promise<Result>; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const left = 280 - text.length;
  return (
    <form
      className="px-3 pb-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !text.trim()) return;
        setBusy(true);
        const r = await onSave(text.trim());
        setBusy(false);
        setProblem(r.ok ? "" : r.text);
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={280}
        rows={3}
        autoFocus
        aria-label="Announcement"
        className="min-h-[88px] w-full resize-none"
      />
      <div className="mt-1 flex items-center gap-2">
        <span className={`flex-1 font-mono text-[10px] ${problem ? "text-fireant" : "text-dim"}`}>{problem || `${left} LEFT`}</span>
        <button type="button" className="btn btn-ghost px-3 text-[12px]" onClick={onCancel} disabled={busy}>
          CANCEL
        </button>
        <button type="submit" className="btn px-3 text-[12px]" disabled={busy || !text.trim()}>
          {busy ? "…" : label}
        </button>
      </div>
    </form>
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
