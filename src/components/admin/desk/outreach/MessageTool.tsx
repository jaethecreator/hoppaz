"use client";

import { useEffect, useMemo, useState } from "react";
import { draftFor, type DraftChannel, type DraftStage } from "@/lib/events-r1/outreach/drafts";
import type { Organiser, OrganiserEvent } from "@/lib/events-r1/types";
import { copyText } from "./format";
import { Btn, FilterChip } from "./ui";
import { useOutreach } from "./useOutreach";

const CHANNELS: { key: DraftChannel; label: string }[] = [
  { key: "instagram", label: "Instagram" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "email", label: "Email" },
];

const STAGES: { key: DraftStage; label: string }[] = [
  { key: "first", label: "First message" },
  { key: "follow_up", label: "Follow up" },
  { key: "offer", label: "Offer with link" },
  { key: "claimed", label: "Welcome" },
  { key: "declined", label: "Removed" },
];

/** The message that fits where this organiser is now. */
export function defaultDraftStage(o: Organiser): DraftStage {
  if (o.stage === "claimed") return "claimed";
  if (o.stage === "declined") return "declined";
  if (!o.last_contacted_at) return "first";
  return "follow_up";
}

export function defaultChannel(o: Organiser): DraftChannel {
  if (o.ig_handle) return "instagram";
  if (o.phone || o.handles.whatsapp) return "whatsapp";
  if (o.email) return "email";
  return "instagram";
}

/**
 * A draft for the organiser, with a preview, a channel pick and one Copy. Picking a channel copies at once, because the routine is
 * "tap the channel, paste into the app". After a copy it offers to log "I contacted them" on that channel.
 */
export default function MessageTool({
  org,
  events,
  stage: fixed,
  link,
  copyOnOpen = false,
  autoChannel,
}: {
  org: Organiser;
  events: OrganiserEvent[];
  /** A fixed message (the offer after a link is made); the stage pick is hidden. */
  stage?: DraftStage;
  link?: string;
  copyOnOpen?: boolean;
  autoChannel?: DraftChannel;
}) {
  const { api, data, by, say } = useOutreach();
  const [channel, setChannel] = useState<DraftChannel>(autoChannel ?? defaultChannel(org));
  const [stage, setStage] = useState<DraftStage>(fixed ?? defaultDraftStage(org));
  const [copied, setCopied] = useState<"" | "body" | "subject">("");
  const [copiedOn, setCopiedOn] = useState<DraftChannel | null>(null);
  const [logged, setLogged] = useState(false);
  const [fail, setFail] = useState("");

  const shown = useMemo(() => {
    const up = events.filter((e) => e.upcoming);
    return (up.length ? up : events).map((e) => ({ title: e.title, starts_at: e.starts_at }));
  }, [events]);
  const build = (ch: DraftChannel) =>
    draftFor({ stage, channel: ch, organiser: { name: org.name, ig_handle: org.ig_handle }, events: shown, roomName: org.room_name ?? org.name, link, staffName: by });
  const draft = useMemo(
    () => draftFor({ stage, channel, organiser: { name: org.name, ig_handle: org.ig_handle }, events: shown, roomName: org.room_name ?? org.name, link, staffName: by }),
    [stage, channel, org.name, org.ig_handle, org.room_name, shown, link, by],
  );

  const copy = async (what: "body" | "subject", ch: DraftChannel = channel) => {
    const ok = await copyText(what === "body" ? draft.body : (draft.subject ?? ""));
    if (!ok) {
      setFail("Could not copy. Select the text and copy it by hand.");
      return;
    }
    setFail("");
    setCopied(what);
    if (what === "body") {
      setCopiedOn(ch);
      setLogged(false);
    }
  };

  // Opened by "Copy message": copy the draft for the default channel straight away.
  useEffect(() => {
    if (copyOnOpen) void copy("body");
    // once, when it opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (ch: DraftChannel) => {
    setChannel(ch);
    setCopied("");
    setCopiedOn(null);
    const d = build(ch);
    void copyText(d.body).then((ok) => {
      if (ok) {
        setCopied("body");
        setCopiedOn(ch);
        setLogged(false);
        setFail("");
      } else setFail("Could not copy. Select the text and copy it by hand.");
    });
  };

  const logIt = async () => {
    if (!copiedOn) return;
    const when = new Date().toISOString();
    data.setOrganisers((l) => (l ? l.map((o) => (o.id === org.id ? { ...o, last_contacted_at: when, last_contacted_by: by } : o)) : l));
    setLogged(true);
    try {
      await api.logContact(org.id, { by, kind: "contact", channel: copiedOn, body: "" });
      say(`Logged: ${by} contacted ${org.name} on ${CHANNELS.find((c) => c.key === copiedOn)?.label ?? copiedOn}`);
      void data.reloadOrganisers();
    } catch (e) {
      setLogged(false);
      void data.reloadOrganisers();
      say(e instanceof Error ? e.message : "That did not work", "error");
    }
  };

  return (
    <div className="space-y-3">
      {!fixed && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Message">
          {STAGES.map((s) => (
            <FilterChip key={s.key} on={stage === s.key} onClick={() => (setStage(s.key), setCopied(""))}>
              {s.label}
            </FilterChip>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Channel">
        {CHANNELS.map((c) => (
          <FilterChip key={c.key} on={channel === c.key} onClick={() => pick(c.key)}>
            {c.label}
          </FilterChip>
        ))}
      </div>
      {draft.subject && (
        <p className="font-body text-[14px]">
          <span className="label !mb-0 inline">Subject </span> {draft.subject}
        </p>
      )}
      <pre aria-label="Message preview" className="max-h-72 overflow-auto whitespace-pre-wrap rounded-hz border border-line bg-ink-3 p-3 font-body text-[14px] leading-snug text-cream">
        {draft.body}
      </pre>
      {stage === "offer" && !link && <p className="hint text-danfo">There is no link yet. Create one below and the message fills it in.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Btn solid onClick={() => void copy("body")}>
          {copied === "body" ? "Copied" : "Copy message"}
        </Btn>
        {draft.subject && <Btn onClick={() => void copy("subject")}>{copied === "subject" ? "Copied" : "Copy subject"}</Btn>}
        {copiedOn && !logged && (
          <Btn onClick={() => void logIt()}>I sent it on {CHANNELS.find((c) => c.key === copiedOn)?.label}</Btn>
        )}
        {logged && <span className="hint">Logged as contacted today</span>}
      </div>
      {fail && (
        <p role="alert" className="font-body text-[14px] text-fireant">
          {fail}
        </p>
      )}
    </div>
  );
}
