"use client";

import { useCallback, useEffect, useState } from "react";
import type { ContactChannel, Organiser, OrganiserDetail, OrganiserLogEntry } from "@/lib/events-r1/types";
import CopyClaimLink from "./CopyClaimLink";
import { ago, igUrl, stamp, when } from "./format";
import LinkTool from "./LinkTool";
import MessageTool from "./MessageTool";
import { wentToBuy } from "./taps";
import { Btn, Fail, Field, FilterChip, Loading, Tag } from "./ui";
import { useOutreach, type FocusRequest } from "./useOutreach";

export type Mode = null | "message" | "contact" | "reply" | "link" | "no" | "reopen" | "delete";

const CHANNELS: { key: ContactChannel; label: string }[] = [
  { key: "instagram", label: "Instagram" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "other", label: "Other" },
];

const KIND: Record<OrganiserLogEntry["kind"], string> = {
  contact: "Contacted",
  reply: "Replied",
  offer: "Offer",
  note: "Note",
  stage: "Stage",
  transfer: "Link",
  claim_request: "Is this your event?",
  scrape: "Scout",
  delete: "Deleted",
};

/** The reason for a failed call, as plain text. */
const why = (e: unknown) => (e instanceof Error ? e.message : "That did not work");

/**
 * Everything about one organiser: the action bar, the tool that is open, the pending links, their events, the contact details and
 * notes, and the full log. The detail is loaded when it opens and again after each change.
 */
export default function OrganiserPanel({ org, mode, setMode, copyKey, copyMessage, focus }: { org: Organiser; mode: Mode; setMode: (m: Mode) => void; copyKey: number; copyMessage: () => void; focus?: FocusRequest }) {
  const { api, data, by, say } = useOutreach();
  const [detail, setDetail] = useState<OrganiserDetail | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await api.organiser(org.id));
      setLoadErr("");
    } catch (e) {
      setLoadErr(why(e));
    }
  }, [api, org.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const events = detail?.events ?? [];
  const claimed = org.stage === "claimed";
  const declined = org.stage === "declined" || org.do_not_contact;

  /** Change this organiser in the list now; the returned function puts the old one back. */
  const patchLocal = (p: Partial<Organiser>) => {
    const before = org;
    data.setOrganisers((l) => (l ? l.map((o) => (o.id === org.id ? { ...o, ...p } : o)) : l));
    return () => data.setOrganisers((l) => (l ? l.map((o) => (o.id === org.id ? before : o)) : l));
  };

  const setStage = async (stage: "offered" | "declined" | "listed") => {
    setErr("");
    setBusy(true);
    const undo = patchLocal(stage === "declined" ? { stage, do_not_contact: true, declined_at: new Date().toISOString() } : stage === "listed" ? { stage, do_not_contact: false, declined_at: null } : { stage });
    try {
      const next = await api.setStage(org.id, stage, by);
      data.setOrganisers((l) => (l ? l.map((o) => (o.id === org.id ? next : o)) : l));
      say(stage === "offered" ? `${org.name} marked as offered` : stage === "declined" ? `${org.name} said no. They will not be listed or contacted again` : `${org.name} is listed again`);
      setMode(null);
      void data.reloadQueue();
      void load();
    } catch (e) {
      undo();
      setErr(why(e));
    }
    setBusy(false);
  };

  return (
    <div className="mt-3 space-y-4 border-t border-line pt-3">
      <ActionBar org={org} mode={mode} setMode={(m) => (setErr(""), setMode(m))} copyMessage={copyMessage} claimed={claimed} declined={declined} onOffered={() => void setStage("offered")} busy={busy} />
      <Fail>{err}</Fail>

      {mode === "message" && (detail || loadErr ? <MessageTool key={copyKey} org={org} events={events} copyOnOpen /> : <Loading />)}
      {mode === "contact" && <LogForm org={org} kind="contact" onDone={() => (setMode(null), void load())} />}
      {mode === "reply" && <LogForm org={org} kind="reply" onDone={() => (setMode(null), void load())} />}
      {mode === "link" && (detail || loadErr) && <LinkTool org={org} events={events} email={focus?.mode === "link" ? focus.email : undefined} onChanged={() => void load()} />}
      {mode === "no" && (
        <Confirm
          text={`Mark ${org.name} as no? They will not be listed or contacted again. Their new pulled events are blocked.`}
          yes="Yes, mark no"
          busy={busy}
          danger
          onYes={() => void setStage("declined")}
          onNo={() => setMode(null)}
        />
      )}
      {mode === "reopen" && <Confirm text={`Reopen ${org.name}? They go back to Listed and can be contacted again.`} yes="Yes, reopen" busy={busy} onYes={() => void setStage("listed")} onNo={() => setMode(null)} />}
      {mode === "delete" && declined && !claimed && <DeleteForm org={org} onDone={() => setMode(null)} />}

      {detail && detail.transfers.some((t) => t.status === "pending") && <PendingLinks detail={detail} onChanged={() => void load()} />}

      {loadErr ? (
        <div>
          <Fail>{loadErr}</Fail>
          <Btn className="mt-2" onClick={() => void load()}>
            Try again
          </Btn>
        </div>
      ) : !detail ? (
        <Loading />
      ) : (
        <>
          <Events detail={detail} org={org} />
          <Details org={org} />
          <Log detail={detail} onNote={() => void load()} org={org} />
        </>
      )}
    </div>
  );
}

function ActionBar({ org, mode, setMode, copyMessage, claimed, declined, onOffered, busy }: { org: Organiser; mode: Mode; setMode: (m: Mode) => void; copyMessage: () => void; claimed: boolean; declined: boolean; onOffered: () => void; busy: boolean }) {
  const t = (m: Exclude<Mode, null>) => setMode(mode === m ? null : m);
  const on = (m: Mode) => (mode === m ? "!border-orange" : "");
  return (
    <div className="flex flex-wrap gap-2">
      <Btn className={on("message")} onClick={copyMessage}>
        Copy message
      </Btn>
      {org.ig_handle && (
        <a href={igUrl(org.ig_handle)} target="_blank" rel="noreferrer noopener" className="btn btn-ghost min-h-[44px] px-4 normal-case">
          Open Instagram ↗
        </a>
      )}
      <Btn className={on("contact")} onClick={() => t("contact")}>
        I contacted them
      </Btn>
      <Btn className={on("reply")} onClick={() => t("reply")}>
        They replied
      </Btn>
      {!claimed && !declined && org.stage !== "offered" && (
        <Btn disabled={busy} onClick={onOffered}>
          Mark offered
        </Btn>
      )}
      {!claimed && !declined && (
        <Btn className={on("link")} onClick={() => t("link")}>
          Create transfer link
        </Btn>
      )}
      {!claimed && !declined && <CopyClaimLink target={{ organiserId: org.id }} name={org.name} />}
      {!claimed && !declined && (
        <Btn danger className={on("no")} onClick={() => t("no")}>
          Mark no
        </Btn>
      )}
      {declined && !claimed && (
        <Btn className={on("reopen")} onClick={() => t("reopen")}>
          Reopen
        </Btn>
      )}
      {declined && !claimed && (
        <Btn danger className={on("delete")} onClick={() => t("delete")}>
          Delete event and room
        </Btn>
      )}
    </div>
  );
}

function Confirm({ text, yes, onYes, onNo, busy, danger }: { text: string; yes: string; onYes: () => void; onNo: () => void; busy: boolean; danger?: boolean }) {
  return (
    <div role="group" aria-label="Confirm" className="rounded-hz border border-line bg-ink-3 p-3">
      <p className="font-body text-[14px]">{text}</p>
      <div className="mt-3 flex gap-2">
        <Btn solid danger={danger} disabled={busy} onClick={onYes}>
          {yes}
        </Btn>
        <Btn onClick={onNo}>Cancel</Btn>
      </div>
    </div>
  );
}

/** "I contacted them" (channel and an optional note) and "They replied" (a note). */
function LogForm({ org, kind, onDone }: { org: Organiser; kind: "contact" | "reply"; onDone: () => void }) {
  const { api, data, by, say } = useOutreach();
  const [channel, setChannel] = useState<ContactChannel>(org.ig_handle ? "instagram" : org.phone ? "whatsapp" : "email");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    setBusy(true);
    const now = new Date().toISOString();
    const before = org;
    if (kind === "contact") data.setOrganisers((l) => (l ? l.map((o) => (o.id === org.id ? { ...o, last_contacted_at: now, last_contacted_by: by } : o)) : l));
    else if (kind === "reply") data.setOrganisers((l) => (l ? l.map((o) => (o.id === org.id ? { ...o, last_replied_at: now } : o)) : l));
    try {
      await api.logContact(org.id, { by, kind, channel, body: body.trim() });
      say(kind === "contact" ? `Logged: ${by} contacted ${org.name}` : `Logged: ${org.name} replied`);
      void data.reloadOrganisers();
      onDone();
    } catch (e) {
      data.setOrganisers((l) => (l ? l.map((o) => (o.id === org.id ? before : o)) : l));
      setErr(why(e));
    }
    setBusy(false);
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <span className="label">{kind === "contact" ? "How did you contact them?" : "Where did they reply?"}</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Channel">
          {CHANNELS.map((c) => (
            <FilterChip key={c.key} on={channel === c.key} onClick={() => setChannel(c.key)}>
              {c.label}
            </FilterChip>
          ))}
        </div>
      </div>
      <Field label={kind === "contact" ? "Note (optional)" : "What did they say?"}>
        <input autoFocus value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === "contact" ? "Sent the first message" : "Asked for the link"} />
      </Field>
      <div className="flex gap-2">
        <Btn solid type="submit" disabled={busy}>
          {kind === "contact" ? "Log contact" : "Log reply"}
        </Btn>
      </div>
      <Fail>{err}</Fail>
    </form>
  );
}


function DeleteForm({ org, onDone }: { org: Organiser; onDone: () => void }) {
  const { api, data, by, say } = useOutreach();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async () => {
    setErr("");
    setBusy(true);
    try {
      const out = await api.deleteListingAndRoom(org.id, typed, by);
      say(`Deleted ${out.events} ${out.events === 1 ? "event" : "events"} and the room of ${org.name}`);
      data.setOrganisers((l) => (l ? l.map((o) => (o.id === org.id ? { ...o, events_total: 0, events_upcoming: 0, room_id: null, room_slug: null, room_name: null } : o)) : l));
      void data.reloadOrganisers();
      void data.reloadQueue();
      onDone();
    } catch (e) {
      setErr(why(e));
    }
    setBusy(false);
  };
  return (
    <form
      className="rounded-hz border border-fireant p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (typed === org.name) void run();
      }}
    >
      <p className="font-body text-[14px]">
        This deletes their events and their room. The organiser stays on the list as declined. It is refused if anyone registered or paid.
      </p>
      <Field label={`Type ${org.name} to confirm`} className="mt-3">
        <input autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={org.name} />
      </Field>
      <div className="mt-3 flex gap-2">
        <Btn solid danger type="submit" disabled={busy || typed !== org.name}>
          Delete event and room
        </Btn>
        <Btn onClick={onDone}>Cancel</Btn>
      </div>
      {err && (
        <div role="alert" className="mt-3 rounded-hz border border-fireant bg-ink-3 p-3">
          <p className="seclabel text-fireant">Not deleted</p>
          <p className="mt-1 whitespace-pre-line font-body text-[14px]">{err}</p>
        </div>
      )}
    </form>
  );
}

function PendingLinks({ detail, onChanged }: { detail: OrganiserDetail; onChanged: () => void }) {
  const { api, data, by, say } = useOutreach();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  return (
    <div>
      <p className="seclabel mb-1">Open links</p>
      {detail.transfers
        .filter((t) => t.status === "pending")
        .map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-0">
            <p className="min-w-0 flex-1 font-body text-[14px]">
              <span className="break-all">{t.to_email}</span>
              <span className="hint block">Made {ago(t.created_at)}{t.created_by ? ` by ${t.created_by}` : ""}. Expires {stamp(t.expires_at)}.</span>
            </p>
            <Btn
              danger
              disabled={busy === t.id}
              onClick={async () => {
                setBusy(t.id);
                setErr("");
                try {
                  await api.revokeTransfer(t.id, by);
                  say(`Link for ${t.to_email} cancelled`);
                  void data.reloadOrganisers();
                  onChanged();
                } catch (e) {
                  setErr(why(e));
                }
                setBusy("");
              }}
            >
              Revoke
            </Btn>
          </div>
        ))}
      <Fail>{err}</Fail>
    </div>
  );
}

function Events({ detail, org }: { detail: OrganiserDetail; org: Organiser }) {
  const { data } = useOutreach();
  const claimable = org.stage !== "claimed" && org.stage !== "declined" && !org.do_not_contact;
  return (
    <div>
      <p className="seclabel mb-1">Events</p>
      {detail.events.length === 0 && <p className="hint">No live events.</p>}
      {detail.events.map((e) => (
        <div key={e.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-0" data-listing-row>
          <div className="min-w-0 flex-1">
            <p className="font-body text-[14px] font-bold">{e.title}</p>
            <p className="hint">
              {when(e.starts_at)} · {e.upcoming ? "Upcoming" : "Past"}
              {wentToBuy(data.taps?.events[e.id]) && ` · ${wentToBuy(data.taps?.events[e.id])}`}
            </p>
          </div>
          {e.ticket_url && (
            <a href={e.ticket_url} target="_blank" rel="noreferrer noopener" className="font-body text-[13px] text-orange underline underline-offset-4">
              Tickets ↗
            </a>
          )}
          <a href={`/event/${encodeURIComponent(e.id)}`} target="_blank" rel="noreferrer noopener" className="font-body text-[13px] text-orange underline underline-offset-4">
            Event page ↗
          </a>
          {claimable && e.upcoming && <CopyClaimLink target={{ eventId: e.id }} name={e.title} />}
        </div>
      ))}
    </div>
  );
}

/** Contact details and notes, saved with one button. Handles other than Instagram show as links. */
function Details({ org }: { org: Organiser }) {
  const { api, data, say } = useOutreach();
  const [ig, setIg] = useState(org.ig_handle ?? "");
  const [email, setEmail] = useState(org.email ?? "");
  const [phone, setPhone] = useState(org.phone ?? "");
  const [notes, setNotes] = useState(org.notes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const dirty = ig !== (org.ig_handle ?? "") || email !== (org.email ?? "") || phone !== (org.phone ?? "") || notes !== org.notes;

  const save = async () => {
    setErr("");
    setBusy(true);
    try {
      const next = await api.saveOrganiser(org.id, { ig_handle: ig.trim().replace(/^@/, "") || null, email: email.trim() || null, phone: phone.trim() || null, notes });
      data.setOrganisers((l) => (l ? l.map((o) => (o.id === org.id ? next : o)) : l));
      say("Saved");
    } catch (e) {
      setErr(why(e));
    }
    setBusy(false);
  };

  const h = org.handles;
  const others = [h.x && ["X", h.x], h.tiktok && ["TikTok", h.tiktok], h.website && ["Website", h.website], h.whatsapp && ["WhatsApp", h.whatsapp]].filter(Boolean) as string[][];

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="seclabel">Contact and notes</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Instagram handle">
          <input value={ig} onChange={(e) => setIg(e.target.value)} placeholder="without the @" />
        </Field>
        <Field label="Email">
          <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Phone">
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </div>
      {others.length > 0 && (
        <p className="font-body text-[14px]">
          {others.map(([k, v], i) => (
            <span key={k}>
              {i > 0 && " · "}
              {k}: {/^https?:/.test(v) ? (
                <a href={v} target="_blank" rel="noreferrer noopener" className="text-orange underline underline-offset-4">
                  {v.replace(/^https?:\/\/(www\.)?/, "")} ↗
                </a>
              ) : (
                v
              )}
            </span>
          ))}
        </p>
      )}
      <Field label="Notes">
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Btn solid type="submit" disabled={!dirty || busy}>
        Save
      </Btn>
      <Fail>{err}</Fail>
    </form>
  );
}

function Log({ detail, org, onNote }: { detail: OrganiserDetail; org: Organiser; onNote: () => void }) {
  const { api, by, say } = useOutreach();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const add = async () => {
    if (!note.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await api.logContact(org.id, { by, kind: "note", body: note.trim() });
      setNote("");
      say("Note added");
      onNote();
    } catch (e) {
      setErr(why(e));
    }
    setBusy(false);
  };
  return (
    <div>
      <p className="seclabel mb-1">Log</p>
      <form
        className="mb-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input aria-label="Add a note to the log" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" />
        <Btn type="submit" disabled={busy || !note.trim()}>
          Add
        </Btn>
      </form>
      <Fail>{err}</Fail>
      {detail.log.length === 0 && <p className="hint">Nothing logged yet.</p>}
      {detail.log.map((l) => (
        <div key={l.id} className="border-t border-line py-2 first:border-0">
          <p className="flex flex-wrap items-center gap-1.5 font-body text-[13px] text-dim">
            <Tag>{KIND[l.kind]}</Tag>
            {l.channel && <Tag>{CHANNELS.find((c) => c.key === l.channel)?.label ?? l.channel}</Tag>}
            <span>
              {stamp(l.at)}
              {l.by ? ` · ${l.by}` : ""}
            </span>
          </p>
          {l.body && <p className="mt-1 whitespace-pre-line font-body text-[14px]">{l.body}</p>}
        </div>
      ))}
    </div>
  );
}
