"use client";

import clsx from "clsx";
import { Send } from "lucide-react";
import { useState } from "react";
import { Choice, Toggle } from "@/components/events-r1/create/Fields";
import DateTimePicker from "@/components/events-r1/DateTimePicker";
import { lagosIso } from "@/components/events-r1/dateTime";
import { eventUrl } from "@/components/events-r1/page/share";
import { popWhen } from "@/components/events-r1/page/time";
import { useR1Api } from "@/lib/events-r1/hooks";
import type { PopAudience, R1Event } from "@/lib/events-r1/types";
import { ErrorLine, Section, useFlash } from "../ui";
import { errWord } from "../words";
import { shareToWhatsApp } from "./share";
import { AUDIENCES, COUNTER_FROM, peopleWord, POP_MAX } from "./words";

const QUARTER = 15 * 60_000;

/** One hour from now, on a quarter hour, and never later than the start. */
function defaultTime(now: number, start: number): string {
  const t = Math.ceil((now + 3.6e6) / QUARTER) * QUARTER;
  return lagosIso(Math.min(t, start));
}

/**
 * "Send a Pop": who gets it, the message, whether it also goes into the room's Announcements, and when. Send now or
 * Schedule (a time in the future, up to the start). Share to WhatsApp copies the text and the event link.
 */
export default function Composer({ event, counts, now }: { event: R1Event; counts: Record<PopAudience, number>; now: number }) {
  const api = useR1Api();
  const [to, setTo] = useState<PopAudience>("going");
  const [text, setText] = useState("");
  const [also, setAlso] = useState(true);
  const [mode, setMode] = useState<"now" | "later">("now");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [said, say] = useFlash();

  const start = Date.parse(event.starts_at);
  const canSchedule = start > now;
  const hasRoom = !!event.room_id;
  const roomName = event.host.roomName;
  const n = counts[to];
  const clean = text.trim();

  const whenMs = Date.parse(when);
  const whenError =
    mode !== "later" ? "" : !Number.isFinite(whenMs) ? "Pick a time" : whenMs <= now ? "Pick a time in the future" : whenMs > start ? "Pick a time before the event starts" : "";

  const pickMode = (m: "now" | "later") => {
    setMode(m);
    setError("");
    if (m === "later" && !when) setWhen(defaultTime(now, start));
  };

  const edit = (v: string) => {
    setText(v.slice(0, POP_MAX));
    setDone("");
    setError("");
  };

  const send = async () => {
    if (!api || busy || !clean || whenError) return;
    setBusy(true);
    setError("");
    try {
      const pop = await api.pops.send({
        eventId: event.id,
        body: clean,
        audience: to,
        alsoRoom: hasRoom && also,
        sendAt: mode === "later" ? new Date(whenMs).toISOString() : null,
      });
      setText("");
      setDone(pop.status === "scheduled" ? `Scheduled for ${popWhen(pop.send_at)}` : `Sent to ${pop.recipients.toLocaleString("en-NG")}`);
    } catch (e) {
      setError(errWord(e));
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!clean) return;
    const r = await shareToWhatsApp(`${clean}\n\n${eventUrl(event)}`);
    say(r === "copied" ? "Copied" : "Could not copy");
  };

  return (
    <Section title="Send a Pop">
      <p className="hint -mt-1">Pops reach people in the app. Share to WhatsApp to reach everyone.</p>

      <p className="mt-4 font-body text-[13px] text-dim">To</p>
      <Choice
        label="To"
        value={to}
        options={AUDIENCES}
        onChange={(v) => {
          setTo(v);
          // A note to pending or waitlisted people is not for the whole room: Announcements start off for them.
          setAlso(v === "going");
        }}
        className="mt-1.5"
      />
      <p className="hint mt-2" aria-live="polite">
        Sends to {peopleWord(n)}
      </p>

      <label className="sr-only" htmlFor="pop-body">
        Message
      </label>
      <textarea
        id="pop-body"
        value={text}
        onChange={(e) => edit(e.target.value)}
        placeholder="Doors open at 7pm. Bring your ticket."
        rows={4}
        maxLength={POP_MAX}
        className="mt-3 w-full resize-none"
      />
      <p className={clsx("hint mt-1 text-right", text.length < COUNTER_FROM && "invisible")} aria-live="polite">
        {text.length}/{POP_MAX}
      </p>

      <div className="mt-1 border-t border-line pt-1">
        {hasRoom ? (
          <Toggle on={also} onChange={setAlso} label={`Also post in ${roomName ?? "your room"} Announcements`} />
        ) : (
          <p className="hint py-2">
            {event.host.roomId ? `Add this event to ${roomName ?? "your room"} in the Roomz tab to also post in Announcements.` : "You have no Roomz yet. This Pop reaches the event only."}
          </p>
        )}
      </div>

      <Choice
        label="When"
        value={mode}
        options={canSchedule ? [{ value: "now", label: "Send now" }, { value: "later", label: "Schedule" }] : [{ value: "now", label: "Send now" }]}
        onChange={pickMode}
        className="mt-2"
      />
      {mode === "later" && (
        <div className="mt-1">
          <DateTimePicker label="Send at" value={when} onChange={setWhen} min={lagosIso(now)} now={now} error={whenError && when ? whenError : ""} />
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <button type="button" className="btn btn-ghost min-h-[48px] normal-case" onClick={share} disabled={!clean}>
          Share to WhatsApp
        </button>
        <button type="button" className="btn min-h-[48px] normal-case" onClick={send} disabled={busy || !api || !clean || !!whenError}>
          <Send size={16} aria-hidden className="mr-2 inline" />
          Send Pop
        </button>
      </div>
      <div aria-live="polite" className="mt-2 min-h-[20px]">
        {said ? <p className="hint">{said}</p> : done ? <p className="hint">{done}</p> : null}
        <ErrorLine>{error}</ErrorLine>
      </div>
    </Section>
  );
}
