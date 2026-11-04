"use client";

import { useState } from "react";
import { getMailer } from "@/lib/events-r1/outreach/mailer";
import type { Organiser, OrganiserEvent, TransferLink } from "@/lib/events-r1/types";
import { copyText, stamp } from "./format";
import MessageTool from "./MessageTool";
import { Btn, Fail, Field, FilterChip } from "./ui";
import { useOutreach } from "./useOutreach";

const DAYS = [3, 7, 14];

/**
 * Make the single-use transfer link for an organiser: type their email, pick how long it lasts, Create. The link is shown once
 * (the server keeps only a hash), with a big Copy link button and the offer message with the link filled in. Send appears only when a
 * mailer is connected.
 */
export default function LinkTool({ org, events, email: preset, onChanged }: { org: Organiser; events: OrganiserEvent[]; email?: string; onChanged: () => void }) {
  const { api, data, by, say } = useOutreach();
  const [email, setEmail] = useState(preset ?? org.email ?? "");
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [made, setMade] = useState<TransferLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState("");
  const mailer = getMailer();

  const create = async () => {
    const to = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(to)) {
      setErr("Check the email address");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const out = await api.createTransfer(org.id, to, by, days);
      setMade(out);
      data.setOrganisers((l) => (l ? l.map((o) => (o.id === org.id ? { ...o, transfer_pending: true, stage: o.stage === "listed" || o.stage === "pulled" ? "offered" : o.stage } : o)) : l));
      say(`Link made for ${to}. Copy it now: it is shown once`);
      void data.reloadOrganisers();
      onChanged();
      if (await copyText(out.link)) setCopied(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That did not work");
    }
    setBusy(false);
  };

  const revoke = async () => {
    if (!made) return;
    setBusy(true);
    try {
      await api.revokeTransfer(made.transfer.id, by);
      setMade(null);
      setCopied(false);
      say("Link cancelled");
      void data.reloadOrganisers();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That did not work");
    }
    setBusy(false);
  };

  const send = async () => {
    if (!made) return;
    setBusy(true);
    const r = await mailer.send({
      to: made.transfer.to_email,
      organiserName: org.name,
      roomName: made.transfer.room_name,
      eventTitles: events.filter((e) => e.upcoming).map((e) => e.title),
      link: made.link,
      expiresAt: made.transfer.expires_at,
      by,
    });
    setBusy(false);
    setSent(r.sent ? `Sent to ${made.transfer.to_email}` : "The email did not send. Copy the link instead.");
  };

  if (made) {
    return (
      <div className="space-y-3">
        <div>
          <span className="label">Link for {made.transfer.to_email}</span>
          <input readOnly value={made.link} aria-label="Transfer link" onFocus={(e) => e.currentTarget.select()} className="font-mono !text-[13px]" />
          <p className="hint mt-1">Works once, for that email only. Expires {stamp(made.transfer.expires_at)}. It is not shown again after you leave.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn
            solid
            className="!min-h-[52px] flex-1 !text-[15px] sm:flex-none sm:px-8"
            onClick={async () => {
              setCopied(await copyText(made.link));
            }}
          >
            {copied ? "Link copied" : "Copy link"}
          </Btn>
          {mailer.connected && (
            <Btn solid disabled={busy} onClick={() => void send()}>
              Send email
            </Btn>
          )}
          <Btn danger disabled={busy} onClick={() => void revoke()}>
            Revoke
          </Btn>
        </div>
        {sent && <p className="hint">{sent}</p>}
        <div className="border-t border-line pt-3">
          <p className="seclabel mb-2">Message to send with it</p>
          <MessageTool org={org} events={events} stage="offer" link={made.link} />
        </div>
        <Fail>{err}</Fail>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <Field label="Their email (the link only works with this one)">
        <input type="email" inputMode="email" autoFocus autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@theirdomain.com" />
      </Field>
      <div>
        <span className="label">Link lasts</span>
        <div className="flex gap-2" role="group" aria-label="Link lasts">
          {DAYS.map((d) => (
            <FilterChip key={d} on={days === d} onClick={() => setDays(d)}>
              {d} days
            </FilterChip>
          ))}
        </div>
      </div>
      <Btn solid type="submit" disabled={busy || !email.trim()}>
        Create link
      </Btn>
      <Fail>{err}</Fail>
    </form>
  );
}
