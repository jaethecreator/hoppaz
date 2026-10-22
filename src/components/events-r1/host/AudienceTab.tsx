"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { copyText, eventUrl, shareOrCopy } from "@/components/events-r1/page/share";
import { useR1Api, useR1Now, useR1Query } from "@/lib/events-r1/hooks";
import type { R1Event, Registration, RegStatus } from "@/lib/events-r1/types";
import { CARD, ErrorLine, Pill, useFlash } from "./ui";
import { countsOf, errWord, metaWord, registeredWord, STATUS_TONE, STATUS_WORD, stampWord } from "./words";

type Filter = "all" | "going" | "pending" | "waitlist" | "checked_in";
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "going", label: "Going" },
  { id: "pending", label: "Pending" },
  { id: "waitlist", label: "Waitlist" },
  { id: "checked_in", label: "Checked in" },
];

const MATCH: Record<Filter, (s: RegStatus) => boolean> = {
  all: () => true,
  going: (s) => s === "going" || s === "checked_in",
  pending: (s) => s === "requested",
  waitlist: (s) => s === "waitlisted",
  checked_in: (s) => s === "checked_in",
};

/** Audience: who is coming, and letting people in or out. Updates live with the data layer. */
export default function AudienceTab({ event, regs, loading }: { event: R1Event; regs: Registration[] | null; loading: boolean }) {
  const api = useR1Api();
  const now = useR1Now();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fail, setFail] = useState<{ id: string; text: string } | null>(null);
  const [said, say] = useFlash();

  const c = countsOf(regs);
  const typeOf = (r: Registration) => event.ticket_types.find((t) => t.id === r.ticket_type_id);
  /** Approval is for free events only: on a paid ticket, paying is the way in. */
  const canApprove = (r: Registration) => r.status === "requested" && (typeOf(r)?.price_naira ?? event.price_naira) === 0;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (regs ?? []).filter((r) => MATCH[filter](r.status) && (!needle || r.name.toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle)));
  }, [regs, filter, q]);

  const act = async (r: Registration, what: "approve" | "decline" | "promote") => {
    if (!api || busy) return;
    setBusy(r.id);
    setFail(null);
    try {
      await api.registrations[what](r.id);
    } catch (e) {
      setFail({ id: r.id, text: errWord(e) });
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    if (!api) return;
    try {
      const text = await api.registrations.exportCsv(event.id);
      const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${event.slug || event.id}-guests.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      say(errWord(e, "Could not download"));
    }
  };

  const invite = async () => {
    const link = eventUrl(event);
    const res = await shareOrCopy({ title: event.title, text: `Come to ${event.title}`, url: link });
    if (res === "copied") say("Link copied");
    else if (res === "failed") say((await copyText(link)) ? "Link copied" : "Could not copy");
  };

  const person = openId ? (regs ?? []).find((r) => r.id === openId) : null;
  if (person) {
    return (
      <Person
        event={event}
        reg={person}
        now={now}
        busy={busy === person.id}
        canApprove={canApprove(person)}
        error={fail?.id === person.id ? fail.text : ""}
        onBack={() => setOpenId(null)}
        onAct={(w) => void act(person, w)}
        ticket={ticketLine(person, typeOf(person)?.price_naira ?? 0)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={clsx(CARD, "grid grid-cols-3 gap-2")} aria-label="Counts">
        <Count n={c.going} label="Going" />
        <Count n={c.pending} label="Pending" />
        <Count n={c.checkedIn} label="Checked in" />
      </div>

      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" aria-label="Search name or email" autoComplete="off" />

      <div role="radiogroup" aria-label="Filter" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={filter === f.id}
            onClick={() => setFilter(f.id)}
            className="chip min-h-[40px] flex-none px-4 font-body text-[14px] normal-case tracking-normal"
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && !regs ? (
        <p className="hint">Loading</p>
      ) : rows.length === 0 ? (
        <p className="hint">{(regs ?? []).length === 0 ? "No one yet. Share your link." : "No one here."}</p>
      ) : (
        <ul className="divide-y divide-line rounded-hz border border-line bg-ink-2">
          {rows.map((r) => {
            const t = typeOf(r);
            const approve = canApprove(r);
            return (
              <li key={r.id} className="px-4 py-3">
                <button type="button" onClick={() => setOpenId(r.id)} className="flex min-h-[44px] w-full items-start justify-between gap-3 text-left">
                  <span className="min-w-0">
                    <span className="block truncate font-body text-[16px] text-cream">{r.name}</span>
                    <span className="block font-body text-[13px] text-dim">
                      {[ticketLine(r, t?.price_naira ?? 0), metaWord(r, now)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <Pill tone={STATUS_TONE[r.status]}>{STATUS_WORD[r.status]}</Pill>
                </button>
                {(approve || r.status === "waitlisted") && (
                  <div className="mt-2 flex justify-end gap-2">
                    {approve ? (
                      <>
                        <button type="button" disabled={busy === r.id} onClick={() => void act(r, "decline")} className="btn btn-ghost min-h-[40px] px-5 normal-case">
                          Decline
                        </button>
                        <button type="button" disabled={busy === r.id} onClick={() => void act(r, "approve")} className="btn min-h-[40px] px-5 normal-case">
                          Approve
                        </button>
                      </>
                    ) : (
                      <button type="button" disabled={busy === r.id} onClick={() => void act(r, "promote")} className="btn min-h-[40px] px-5 normal-case">
                        Promote
                      </button>
                    )}
                  </div>
                )}
                {fail?.id === r.id && (
                  <div className="mt-2 text-right">
                    <ErrorLine>{fail.text}</ErrorLine>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" onClick={() => void download()} className="btn btn-ghost px-4 normal-case">
          Download list
        </button>
        <button type="button" onClick={() => void invite()} className="btn btn-ghost px-4 normal-case">
          Invite people
        </button>
        <span className="font-body text-[13px] text-dim" aria-live="polite">
          {said}
        </span>
      </div>
    </div>
  );
}

/** "General" or "General · ₦3,000". */
function ticketLine(r: Registration, price: number): string {
  return price > 0 ? `${r.ticket_name} · ₦${price.toLocaleString("en-NG")}` : r.ticket_name;
}

function Count({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <p className="num text-[28px]">{n}</p>
      <p className="mt-1 font-body text-[14px] text-dim">{label}</p>
    </div>
  );
}

/** One person, in place of the list: answers, ticket, who invited them, when they checked in. */
function Person({
  event, reg, now, busy, canApprove, error, ticket, onBack, onAct,
}: {
  event: R1Event;
  reg: Registration;
  now: number;
  busy: boolean;
  canApprove: boolean;
  error: string;
  ticket: string;
  onBack: () => void;
  onAct: (w: "approve" | "decline" | "promote") => void;
}) {
  const { data: settings } = useR1Query((a) => a.events.getRegistrationSettings(event.id), [event.id]);
  const asked = (settings?.questions ?? []).filter((x) => !x.builtin && reg.answers[x.id]);
  const rows: Array<[string, string]> = [
    ["Email", reg.email],
    ...(reg.phone ? ([["Phone", reg.phone]] as Array<[string, string]>) : []),
    ["Ticket", ticket],
    ["Registered", `${stampWord(reg.created_at)} (${registeredWord(reg.created_at, now).replace("Registered ", "")})`],
    ...(reg.status === "waitlisted" && reg.waitlist_pos ? ([["Waitlist place", String(reg.waitlist_pos)]] as Array<[string, string]>) : []),
    ["Invited by", reg.referrer_name ?? "No one"],
    ...(reg.checked_in_at ? ([["Checked in", stampWord(reg.checked_in_at)]] as Array<[string, string]>) : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="-ml-2 inline-flex min-h-[44px] items-center gap-1 self-start font-body text-[15px] text-dim">
        <ChevronLeft size={18} aria-hidden /> Audience
      </button>
      <div className="flex items-center justify-between gap-3">
        <h2 className="min-w-0 truncate font-display text-[22px] font-black">{reg.name}</h2>
        <Pill tone={STATUS_TONE[reg.status]}>{STATUS_WORD[reg.status]}</Pill>
      </div>
      <dl className={clsx(CARD, "flex flex-col gap-3")}>
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="flex-none font-body text-[14px] text-dim">{k}</dt>
            <dd className="min-w-0 break-words text-right font-body text-[15px]">{v}</dd>
          </div>
        ))}
      </dl>
      {asked.length > 0 && (
        <section className={CARD}>
          <h3 className="font-display text-[15px] font-black">Answers</h3>
          <dl className="mt-3 flex flex-col gap-3">
            {asked.map((x) => (
              <div key={x.id}>
                <dt className="font-body text-[14px] text-dim">{x.label}</dt>
                <dd className="font-body text-[15px]">{reg.answers[x.id]}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {(canApprove || reg.status === "waitlisted") && (
        <div className="flex gap-2">
          {canApprove ? (
            <>
              <button type="button" disabled={busy} onClick={() => onAct("decline")} className="btn btn-ghost flex-1 normal-case">
                Decline
              </button>
              <button type="button" disabled={busy} onClick={() => onAct("approve")} className="btn flex-1 normal-case">
                Approve
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => onAct("promote")} className="btn flex-1 normal-case">
              Promote
            </button>
          )}
        </div>
      )}
      <ErrorLine>{error}</ErrorLine>
    </div>
  );
}
