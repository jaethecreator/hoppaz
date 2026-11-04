"use client";

import clsx from "clsx";
import { useRef, useState, type KeyboardEvent } from "react";
import type { PulledEvent, PulledPatch } from "@/lib/events-r1/types";
import EditForm from "./EditForm";
import { flagsOf, FLAG_LABEL, naira, priceText, when } from "./format";
import { Btn, Fail, Field, StageTag, Tag } from "./ui";
import { useOutreach } from "./useOutreach";

type Mode = null | "edit" | "reject" | "merge";

/** Flags that tell staff to look twice; the rest are information. */
const WARN = new Set(["duplicate", "blocked", "gone", "moved", "changed"]);

/** Why this row cannot be approved right now, or "". */
export function approveBlock(row: PulledEvent, patch?: PulledPatch): string {
  if (row.status === "blocked" || row.flags.includes("blocked")) return "Blocked: this organiser said no or asked not to be contacted. Reject it.";
  if (!(patch?.starts_at ?? row.fields.starts_at)) return "No start time yet. Edit it first.";
  return "";
}

/**
 * One row of the review queue. Approve and reject take the card out of the list at once and put it back, with the reason, if the
 * call fails. Keyboard: focus the card, then A approves, E edits, R rejects, J and K move between cards.
 */
export default function ReviewCard({ row, others }: { row: PulledEvent; others: PulledEvent[] }) {
  const { data, api, by, say } = useOutreach();
  const [mode, setMode] = useState<Mode>(null);
  const card = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reason, setReason] = useState("");
  const [into, setInto] = useState(() => (row.duplicate_of && others.some((o) => o.id === row.duplicate_of) ? row.duplicate_of : ""));
  const f = row.fields;
  const flags = flagsOf(row);
  const block = approveBlock(row);
  const live = row.status === "approved";
  const range = f.tickets.length ? priceText(f.tickets) : "Price missing";

  /** Take the row out now; the returned function puts it back where it was. */
  const takeOut = () => {
    // Keyboard routine: hand focus to the next card so the next A or R lands on it.
    const el = card.current;
    if (el?.contains(document.activeElement)) {
      const next = (el.nextElementSibling ?? el.previousElementSibling) as HTMLElement | null;
      setTimeout(() => next?.matches("[data-review-card]") && next.focus(), 0);
    }
    const at = (data.queue ?? []).findIndex((r) => r.id === row.id);
    data.setQueue((q) => (q ? q.filter((r) => r.id !== row.id) : q));
    return () => data.setQueue((q) => (q && !q.some((r) => r.id === row.id) ? [...q.slice(0, Math.max(at, 0)), row, ...q.slice(Math.max(at, 0))] : q));
  };

  const approve = async (patch?: PulledPatch) => {
    const why = approveBlock(row, patch);
    if (why) {
      setErr(why);
      return;
    }
    setErr("");
    setBusy(true);
    const putBack = takeOut();
    try {
      await api.approve(row.id, by, patch);
      say(live ? `Accepted the changes to ${f.name}` : `Approved ${f.name}`);
      void data.reloadQueue();
      void data.reloadOrganisers();
    } catch (e) {
      putBack();
      setErr(e instanceof Error ? e.message : "That did not work");
      setMode(patch ? "edit" : null);
      setBusy(false);
    }
  };

  const save = async (patch: PulledPatch) => {
    setErr("");
    setBusy(true);
    try {
      const next = await api.edit(row.id, patch);
      data.setQueue((q) => (q ? q.map((r) => (r.id === row.id ? next : r)) : q));
      setMode(null);
      say(`Saved ${next.fields.name}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That did not work");
    }
    setBusy(false);
  };

  const reject = async () => {
    setErr("");
    setBusy(true);
    const putBack = takeOut();
    try {
      await api.reject(row.id, by, reason.trim() || undefined);
      say(`Rejected ${f.name}`);
      void data.reloadQueue();
    } catch (e) {
      putBack();
      setErr(e instanceof Error ? e.message : "That did not work");
      setBusy(false);
    }
  };

  const merge = async () => {
    const target = others.find((o) => o.id === into);
    if (!target) {
      setErr("Pick the row to merge into");
      return;
    }
    setErr("");
    setBusy(true);
    const putBack = takeOut();
    try {
      await api.merge(row.id, target.id, by);
      say(`Merged ${f.name} (${f.source_site}) into ${target.fields.name} (${target.fields.source_site})`);
      void data.reloadQueue();
    } catch (e) {
      putBack();
      setErr(e instanceof Error ? e.message : "That did not work");
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "a") void approve();
    else if (k === "e") setMode("edit");
    else if (k === "r" && !live) setMode("reject");
    else if (k === "j" || k === "k") {
      const cards = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-review-card]") ?? [])];
      cards[cards.indexOf(e.currentTarget) + (k === "j" ? 1 : -1)]?.focus();
    } else return;
    e.preventDefault();
  };

  const sourceLine = [f.source_site, ...row.also_at.map((a) => a.source_site)].join(" + ");

  return (
    <article ref={card} tabIndex={0} data-review-card onKeyDown={onKey} className={clsx("card mb-3 !p-3 outline-none focus-visible:ring-2 focus-visible:ring-orange", busy && "opacity-60")} aria-label={f.name}>
      <div className="flex gap-3">
        <div className="h-24 w-[72px] flex-none overflow-hidden rounded-hz border border-line bg-ink-3">
          {f.flyer_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- flyers come from many sites, sizes unknown
            <img src={f.flyer_url} alt="" className="h-full w-full object-cover" loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} />
          ) : (
            <span className="grid h-full place-items-center px-1 text-center font-body text-[11px] text-dim">No flyer</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-display text-[16px] font-black leading-tight">{f.name}</h3>
          <p className="mt-1 font-body text-[14px]">{f.starts_at ? when(f.starts_at) : <span className="text-fireant">No start time</span>}</p>
          <p className="font-body text-[14px] text-dim">{[f.venue, f.area].filter(Boolean).join(", ") || "Venue not set"}</p>
          <p className="mt-1 font-body text-[14px]">
            {range}
            {f.sold_out && <span className="text-fireant"> · Sold out at source</span>}
          </p>
          {f.tickets.length > 1 && (
            <p className="hint">
              {f.tickets.map((t) => `${t.name} ${t.price_naira === null ? "?" : naira(t.price_naira)}`).join(" · ")}
            </p>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {f.organiser_name ? (
          <>
            <span className="font-body text-[14px] font-bold">{f.organiser_name}</span>
            {row.organiser_stage && <StageTag stage={row.organiser_stage} />}
          </>
        ) : (
          <span className="hint">Organiser not known</span>
        )}
        <Tag>{sourceLine}</Tag>
        <Tag tone={row.confidence === "confirmed" ? "pill-keke" : "pill-danfo"}>{row.confidence === "confirmed" ? "Confirmed" : "Lead only"}</Tag>
        {flags.map((fl) => (
          <Tag key={fl} tone={fl === "blocked" ? "pill-fireant" : WARN.has(fl) ? "pill-danfo" : ""}>
            {FLAG_LABEL[fl]}
          </Tag>
        ))}
      </div>
      {f.ticket_url && (
        <p className="mt-2 truncate font-body text-[13px]">
          <a href={f.ticket_url} target="_blank" rel="noreferrer noopener" className="text-orange underline underline-offset-4">
            {f.ticket_url.replace(/^https?:\/\/(www\.)?/, "")} ↗
          </a>
        </p>
      )}
      {live && <p className="hint mt-1">Already live. Accepting applies the changes to the listing.</p>}

      {mode === "edit" ? (
        <EditForm row={row} busy={busy} canApprove={row.status !== "blocked"} onSave={(p) => void save(p)} onSaveApprove={(p) => void approve(p)} onCancel={() => setMode(null)} />
      ) : mode === "reject" ? (
        <form
          className="mt-3 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void reject();
          }}
        >
          <Field label="Reason (optional)">
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Not in Lagos, not a public event" />
          </Field>
          <div className="mt-3 flex gap-2">
            <Btn solid danger type="submit" disabled={busy}>
              Reject
            </Btn>
            <Btn onClick={() => setMode(null)}>Cancel</Btn>
          </div>
        </form>
      ) : mode === "merge" ? (
        <form
          className="mt-3 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void merge();
          }}
        >
          <Field label="Merge into">
            <select value={into} onChange={(e) => setInto(e.target.value)}>
              <option value="">Pick a row</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.fields.name} · {when(o.fields.starts_at) || "no time"} · {o.fields.source_site}
                </option>
              ))}
            </select>
          </Field>
          <p className="hint mt-1">This source is kept on the other row as an extra place to buy.</p>
          <div className="mt-3 flex gap-2">
            <Btn solid type="submit" disabled={busy || !into}>
              Merge
            </Btn>
            <Btn onClick={() => setMode(null)}>Cancel</Btn>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Btn solid disabled={busy || !!block} onClick={() => void approve()} aria-keyshortcuts="A">
            {live ? "Accept changes" : "Approve"}
          </Btn>
          <Btn disabled={busy} onClick={() => setMode("edit")} aria-keyshortcuts="E">
            Edit
          </Btn>
          {!live && (
            <Btn disabled={busy} onClick={() => setMode("reject")} aria-keyshortcuts="R">
              Reject
            </Btn>
          )}
          {!live && others.length > 0 && (
            <Btn disabled={busy} onClick={() => setMode("merge")}>
              Merge into another
            </Btn>
          )}
        </div>
      )}
      {mode === null && block && <p className="hint mt-2 text-danfo">{block}</p>}
      <Fail>{err}</Fail>
    </article>
  );
}
