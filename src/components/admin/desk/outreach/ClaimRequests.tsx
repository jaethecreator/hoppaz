"use client";

import { useState } from "react";
import { ago } from "./format";
import { Btn, Fail } from "./ui";
import { useOutreach } from "./useOutreach";

/** "Is this your event?" requests from the event page. Handle clears it; Link opens the organiser with their email filled in. */
export default function ClaimRequests() {
  const { data, api, by, say, openOrganiser } = useOutreach();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const list = (data.requests ?? []).filter((r) => r.status === "new");
  if (!list.length && !data.errors.requests) return null;

  const handle = async (id: string, event: string) => {
    setBusy(id);
    setErr("");
    const before = data.requests;
    data.setRequests((l) => (l ? l.map((r) => (r.id === id ? { ...r, status: "handled" as const } : r)) : l));
    try {
      await api.handleClaimRequest(id, by);
      say(`Marked as handled: ${event}`);
      void data.reloadRequests();
      void data.reloadOrganisers();
    } catch (e) {
      data.setRequests(before);
      setErr(e instanceof Error ? e.message : "That did not work");
    }
    setBusy("");
  };

  return (
    <section aria-label="Claim requests" className="card mb-4 !p-3">
      <h2 className="seclabel mb-2 text-orange">Is this your event? ({list.length})</h2>
      {data.errors.requests && <Fail>{data.errors.requests}</Fail>}
      {list.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-0">
          <div className="min-w-0 flex-1 basis-[220px]">
            <p className="font-display text-sm font-bold">{r.event_title}</p>
            <p className="font-body text-[14px]">
              {r.name} · <span className="break-all">{r.email}</span>
              {r.phone ? ` · ${r.phone}` : ""}
            </p>
            {r.note && <p className="font-body text-[14px] text-dim">“{r.note}”</p>}
            <p className="hint">
              {r.organiser_name ?? "Organiser not matched"} · {ago(r.created_at)}
            </p>
          </div>
          <Btn solid disabled={!r.organiser_id} title={r.organiser_id ? undefined : "No organiser on this event yet"} onClick={() => r.organiser_id && openOrganiser(r.organiser_id, "link", r.email)}>
            Link
          </Btn>
          <Btn disabled={busy === r.id} onClick={() => void handle(r.id, r.event_title)}>
            Handle
          </Btn>
        </div>
      ))}
      <Fail>{err}</Fail>
    </section>
  );
}
