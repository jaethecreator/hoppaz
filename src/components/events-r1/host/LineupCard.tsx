"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Seg } from "@/components/events-r1/create/CreateEvent";
import { useR1Api } from "@/lib/events-r1/hooks";
import { cleanLineup, LINEUP_MAX, LINEUP_TITLE } from "@/lib/events-r1/lineup";
import type { Lineup, LineupKind } from "@/lib/events-r1/lineup";
import { errWord } from "./words";

const KINDS: Array<{ value: LineupKind; label: string }> = [
  { value: "lineup", label: "Lineup" },
  { value: "programme", label: "Programme" },
];
const HINT: Record<LineupKind, { time: string; name: string }> = {
  lineup: { time: "9:00 PM", name: "Artist or act" },
  programme: { time: "5:00 PM", name: "Talk or session" },
};

type Row = { key: number; time: string; name: string; note: string };

/**
 * The Lineup or Programme card on Details (design: host-dashboard-final.html, "lineup"). The host picks the heading, then adds rows of a
 * time (free text, optional) and a name. It saves by itself a moment after the last change, like the rest of Details, and shows on the
 * event page after About. Rows with no name are kept on screen but not saved. The data note (a line under a row) has no field yet:
 * a row loaded with one keeps it.
 */
export default function LineupCard({ eventId, onSaved, onError }: { eventId: string; onSaved: () => void; onError: (m: string) => void }) {
  const api = useR1Api();
  const [kind, setKind] = useState<LineupKind>("lineup");
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const keys = useRef(0);
  const last = useRef("");
  const focusKey = useRef<number | null>(null);

  // Read once. Later changes to the store come from this card's own saves, so they are not read back over what is being typed.
  useEffect(() => {
    if (!api || loaded) return;
    let live = true;
    api.events.getLineup(eventId).then(
      (l) => {
        if (!live) return;
        last.current = JSON.stringify(cleanLineup(l));
        setKind(l.kind);
        setRows(l.rows.map((r) => ({ key: ++keys.current, time: r.time ?? "", name: r.name, note: r.note ?? "" })));
        setLoaded(true);
      },
      () => live && setLoaded(true)
    );
    return () => {
      live = false;
    };
  }, [api, eventId, loaded]);

  const current: Lineup = cleanLineup({ kind, rows: rows.map((r) => ({ time: r.time, name: r.name, note: r.note })) });
  const json = JSON.stringify(current);
  useEffect(() => {
    if (!api || !loaded || json === last.current) return;
    const id = window.setTimeout(() => {
      const before = last.current;
      last.current = json; // counted as saved at once; put back if it fails
      api.events.setLineup(eventId, JSON.parse(json) as Lineup).then(onSaved, (e) => {
        last.current = before;
        onError(errWord(e));
      });
    }, 800);
    return () => window.clearTimeout(id);
  }, [api, loaded, json, eventId, onSaved, onError]);

  // A new row takes the cursor.
  useEffect(() => {
    if (focusKey.current === null) return;
    document.querySelector<HTMLInputElement>(`[data-lu-time="${focusKey.current}"]`)?.focus();
    focusKey.current = null;
  }, [rows.length]);

  // The done sheet's "Add the lineup or programme" lands here (/host/<id>?tab=details#lineup).
  useEffect(() => {
    if (!loaded || window.location.hash !== "#lineup") return;
    const id = window.setTimeout(() => document.getElementById("lineup")?.scrollIntoView({ block: "start", behavior: "smooth" }), 120);
    return () => window.clearTimeout(id);
  }, [loaded]);

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => {
    const key = ++keys.current;
    focusKey.current = key;
    setRows((rs) => (rs.length >= LINEUP_MAX ? rs : [...rs, { key, time: "", name: "", note: "" }]));
  };
  const hint = HINT[kind];

  return (
    <section id="lineup" className="t-card grid scroll-mt-32 gap-3 p-4 lg:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 className="font-body text-[13.5px] font-bold text-t-muted">{LINEUP_TITLE[kind]}</h3>
          <span className="font-body text-[12.5px] text-t-muted">Shown on your event page</span>
        </div>
        <Seg label="Heading on the event page" value={kind} options={KINDS} onChange={setKind} />
      </div>

      {loaded && rows.length > 0 && (
        <ul className="grid gap-2" aria-label={LINEUP_TITLE[kind]}>
          {rows.map((r, i) => (
            <li key={r.key} className="grid grid-cols-[96px_minmax(0,1fr)_44px] items-center gap-2">
              <input value={r.time} onChange={(e) => set(r.key, { time: e.target.value })} placeholder={hint.time} aria-label={`Time, row ${i + 1}`} maxLength={20} autoComplete="off" data-lu-time={r.key} />
              <input value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} placeholder={hint.name} aria-label={`Name, row ${i + 1}`} maxLength={80} autoComplete="off" />
              <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove row ${i + 1}`} className="grid h-11 w-11 place-items-center rounded-hz text-t-muted">
                <X size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {loaded && rows.length === 0 && (
        <p className="font-body text-[13.5px] text-t-muted">
          {kind === "lineup" ? "Who is playing or performing? Add the acts, with a time if you have one." : "What happens when? Add the talks and breaks, with a time if you have one."}
        </p>
      )}
      {loaded && (rows.length < LINEUP_MAX ? (
        <button type="button" onClick={add} className="min-h-[44px] justify-self-start font-body text-[13.5px] font-bold text-t-accent">
          + Add a row
        </button>
      ) : (
        <span className="font-body text-[12.5px] text-t-muted">{LINEUP_MAX} rows is the most.</span>
      ))}
    </section>
  );
}
