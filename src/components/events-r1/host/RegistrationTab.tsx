"use client";

import { useState } from "react";
import { Toggle } from "@/components/events-r1/create/Fields";
import Tickets, { newTicket, ticketsDraft, ticketsError } from "@/components/events-r1/create/Tickets";
import type { TicketForm } from "@/components/events-r1/create/Tickets";
import { PAID_UNAVAILABLE } from "@/lib/events-r1/constants";
import { useR1Api, useR1Query } from "@/lib/events-r1/hooks";
import type { R1Event, RegMessages, RegQuestion } from "@/lib/events-r1/types";
import GetPaidCard from "../pay/GetPaidCard";
import { usePaidGate } from "../pay/usePay";
import { CARD, ErrorLine, Section } from "./ui";
import { errWord } from "./words";

let seq = 0;
const newQuestionId = () => `q-${Date.now().toString(36)}${(++seq).toString(36)}`;

/** Registration: tickets, approval, capacity, waitlist, what we ask guests, what guests hear back. One Save. */
export default function RegistrationTab({ event }: { event: R1Event }) {
  const { data: settings, loading, error } = useR1Query((a) => a.events.getRegistrationSettings(event.id), [event.id]);
  if (error) return <p className="hint">Could not load this.</p>;
  if (loading || !settings) return <p className="hint">Loading</p>;
  return <Form event={event} questions={settings.questions} messages={settings.messages} />;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Form({ event, questions: q0, messages: m0 }: { event: R1Event; questions: RegQuestion[]; messages: RegMessages }) {
  const api = useR1Api();
  // The form keeps what the host typed: it starts from the saved values once and is not reset by later reloads.
  const [paid, setPaid] = useState(() => event.ticket_types.some((t) => t.price_naira > 0));
  const [types, setTypes] = useState<TicketForm[]>(() =>
    event.ticket_types.map((t) => ({ ...newTicket(t.name), price: t.price_naira > 0 ? String(t.price_naira) : "", capacity: t.capacity === null ? "" : String(t.capacity) }))
  );
  const [approval, setApproval] = useState(event.requires_approval);
  const [capacity, setCapacity] = useState(event.capacity === null ? "" : String(event.capacity));
  const [waitlist, setWaitlist] = useState(event.waitlist_on);
  const [questions, setQuestions] = useState<RegQuestion[]>(q0);
  const [messages, setMessages] = useState<RegMessages>(m0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    setSaved(false);
    set(v);
  };

  const tickets = ticketsDraft(paid, types);
  const ticketsChanged = !same(tickets, event.ticket_types.map((t) => ({ name: t.name, price_naira: t.price_naira, capacity: t.capacity })));
  /** A paid choice cannot be saved while paid tickets are off or the host cannot sell yet. A paid event left as it is can still change its other settings. */
  const gate = usePaidGate();
  const blocked = paid && ticketsChanged && gate.state !== "ready" && gate.state !== "signedout";

  const editQ = (id: string, patch: Partial<RegQuestion>) => touch(setQuestions)(questions.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const save = async () => {
    if (!api || busy || blocked) return;
    const bad = ticketsChanged ? ticketsError(paid, types) : "";
    if (bad) return setError(bad);
    if (questions.some((x) => !x.label.trim())) return setError("Every question needs a name");
    setBusy(true);
    setError("");
    try {
      await api.events.update(event.id, {
        requires_approval: approval && !paid,
        capacity: capacity.trim() ? Number(capacity) : null,
        waitlist_on: waitlist,
        ...(ticketsChanged ? { tickets } : {}),
      });
      await api.events.setRegistrationSettings(event.id, { questions: questions.map((x) => ({ ...x, label: x.label.trim() })), messages });
      setSaved(true);
    } catch (e) {
      setError(errWord(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <GetPaidCard returnPath={`/host/${encodeURIComponent(event.id)}?tab=registration`} />

      <Section title="Tickets">
        <Tickets paid={paid} onPaid={touch(setPaid)} types={types} onTypes={touch(setTypes)} />
      </Section>

      <section className={CARD}>
        {paid ? <p className="font-body text-[14px] text-dim">Approval is for free tickets only.</p> : <Toggle on={approval} onChange={touch(setApproval)} label="Require approval" hint="You say yes to each person." />}
        <label className="flex min-h-[48px] items-center justify-between gap-3 py-1">
          <span className="font-body text-[15px]">Capacity</span>
          <input
            value={capacity}
            onChange={(e) => touch(setCapacity)(e.target.value.replace(/\D/g, "").slice(0, 5))}
            inputMode="numeric"
            placeholder="None"
            aria-label="Capacity"
            className="!w-28 text-right"
          />
        </label>
        <Toggle on={waitlist} onChange={touch(setWaitlist)} label="Waitlist when full" />
      </section>

      <Section title="Questions we ask guests">
        <ul className="flex flex-col divide-y divide-line">
          {questions.map((x) => (
            <li key={x.id} className="py-2">
              {x.builtin === "name" || x.builtin === "email" ? (
                <div className="flex min-h-[44px] items-center justify-between gap-3">
                  <span className="font-body text-[15px]">{x.builtin === "name" ? "Name" : "Email"}</span>
                  <span className="font-body text-[14px] text-dim">{x.builtin === "name" ? "Full name" : "Required"}</span>
                </div>
              ) : x.builtin === "phone" ? (
                <>
                  <Toggle on={x.enabled !== false} onChange={(on) => editQ(x.id, { enabled: on, required: on ? x.required : false })} label="Phone" hint={x.enabled !== false ? "Asked" : "Off"} />
                  {x.enabled !== false && <Toggle on={x.required} onChange={(on) => editQ(x.id, { required: on })} label="Phone is required" />}
                </>
              ) : (
                <div className="flex flex-col gap-1">
                  <input value={x.label} onChange={(e) => editQ(x.id, { label: e.target.value })} aria-label="Question" maxLength={120} autoComplete="off" />
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Toggle on={x.required} onChange={(on) => editQ(x.id, { required: on })} label="Required" />
                    </div>
                    <button type="button" onClick={() => touch(setQuestions)(questions.filter((y) => y.id !== x.id))} className="min-h-[44px] flex-none px-1 font-body text-[14px] text-dim underline underline-offset-4">
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => touch(setQuestions)([...questions, { id: newQuestionId(), label: "", required: false }])} className="min-h-[44px] font-body text-[15px] text-orange">
          + Add a question
        </button>
      </Section>

      <Section title="Messages guests get">
        <div className="flex flex-col gap-3">
          {(
            [
              ["pending", "Pending"],
              ["going", "Going"],
              ["declined", "Declined"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="block">
              <span className="mb-1 block font-body text-[14px] text-dim">{label}</span>
              <textarea value={messages[k]} onChange={(e) => touch(setMessages)({ ...messages, [k]: e.target.value })} rows={2} maxLength={500} />
            </label>
          ))}
        </div>
      </Section>

      <div className="flex flex-col gap-2 pb-2">
        <button type="button" className="btn w-full normal-case" onClick={() => void save()} disabled={busy || !api || blocked}>
          {blocked && gate.state === "needs" ? "Set up payouts first" : blocked ? PAID_UNAVAILABLE : busy ? "Saving" : "Save"}
        </button>
        <ErrorLine>{error}</ErrorLine>
        <p className="h-4 px-1 font-body text-[13px] text-dim" aria-live="polite">
          {saved ? "Saved" : ""}
        </p>
      </div>
    </div>
  );
}
