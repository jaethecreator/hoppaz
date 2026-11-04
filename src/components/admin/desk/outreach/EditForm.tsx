"use client";

import { useState } from "react";
import type { PulledEvent, PulledPatch, ScoutTicket } from "@/lib/events-r1/types";
import { fromLagosInput, isLagos, toLagosInput } from "./format";
import { Btn, Fail, Field } from "./ui";

/**
 * The inline edit of one pulled row. Only fields that changed go in the patch. Times are typed in Lagos time. A pin must be inside
 * Lagos, or empty (then the listing has no pin).
 */

const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));

export default function EditForm({
  row,
  busy,
  onSave,
  onSaveApprove,
  onCancel,
  canApprove,
}: {
  row: PulledEvent;
  busy: boolean;
  onSave: (patch: PulledPatch) => void;
  onSaveApprove: (patch: PulledPatch) => void;
  onCancel: () => void;
  canApprove: boolean;
}) {
  const f = row.fields;
  const [name, setName] = useState(f.name);
  const [start, setStart] = useState(toLagosInput(f.starts_at));
  const [end, setEnd] = useState(toLagosInput(f.ends_at));
  const [venue, setVenue] = useState(f.venue ?? "");
  const [area, setArea] = useState(f.area ?? "");
  const [lat, setLat] = useState(f.lat === null ? "" : String(f.lat));
  const [lng, setLng] = useState(f.lng === null ? "" : String(f.lng));
  const [desc, setDesc] = useState(f.description);
  const [ticketUrl, setTicketUrl] = useState(f.ticket_url ?? "");
  const [flyer, setFlyer] = useState(f.flyer_url ?? "");
  const [orgName, setOrgName] = useState(f.organiser_name ?? "");
  const [orgHandle, setOrgHandle] = useState(f.organiser_handle ?? "");
  const [tickets, setTickets] = useState<{ name: string; price: string; sold_out: boolean }[]>(f.tickets.map((t) => ({ name: t.name, price: t.price_naira === null ? "" : String(t.price_naira), sold_out: t.sold_out })));
  const [err, setErr] = useState("");

  const build = (): PulledPatch | null => {
    const la = num(lat);
    const ln = num(lng);
    if ((la === null) !== (ln === null)) return fail("Add both the latitude and the longitude, or clear both");
    if (la !== null && ln !== null && (!Number.isFinite(la) || !Number.isFinite(ln) || !isLagos(la, ln))) return fail("The pin must be in Lagos (latitude 6.3 to 6.8, longitude 3.05 to 3.95)");
    if (!name.trim()) return fail("The event needs a name");
    const nextTickets: ScoutTicket[] = [];
    for (const t of tickets) {
      if (!t.name.trim() && t.price.trim() === "") continue;
      const p = num(t.price);
      if (p !== null && (!Number.isFinite(p) || p < 0)) return fail("Prices are whole naira, 0 or more");
      nextTickets.push({ name: t.name.trim() || "Ticket", price_naira: p === null ? null : Math.round(p), sold_out: t.sold_out });
    }
    const patch: PulledPatch = {};
    const put = <K extends keyof PulledPatch>(k: K, v: PulledPatch[K], was: unknown) => {
      if (JSON.stringify(v) !== JSON.stringify(was)) patch[k] = v;
    };
    put("name", name.trim(), f.name);
    if (start !== toLagosInput(f.starts_at)) patch.starts_at = fromLagosInput(start);
    if (end !== toLagosInput(f.ends_at)) patch.ends_at = fromLagosInput(end);
    put("venue", venue.trim() || null, f.venue);
    put("area", area.trim() || null, f.area);
    put("lat", la, f.lat);
    put("lng", ln, f.lng);
    put("description", desc, f.description);
    put("ticket_url", ticketUrl.trim() || null, f.ticket_url);
    put("flyer_url", flyer.trim() || null, f.flyer_url);
    put("organiser_name", orgName.trim() || null, f.organiser_name);
    put("organiser_handle", orgHandle.trim().replace(/^@/, "") || null, f.organiser_handle);
    put("tickets", nextTickets, f.tickets);
    return patch;
  };
  const fail = (m: string): null => {
    setErr(m);
    return null;
  };
  const go = (fn: (p: PulledPatch) => void) => {
    setErr("");
    const p = build();
    if (p) fn(p);
  };

  return (
    <form
      className="mt-3 space-y-3 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        go(onSave);
      }}
    >
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starts (Lagos time)">
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Ends (Lagos time)">
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="Venue">
          <input value={venue} onChange={(e) => setVenue(e.target.value)} />
        </Field>
        <Field label="Area">
          <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Lekki, Yaba, Ikeja" />
        </Field>
        <Field label="Latitude">
          <input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="6.43" />
        </Field>
        <Field label="Longitude">
          <input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="3.42" />
        </Field>
      </div>
      <Field label="Description">
        <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ticket link">
          <input inputMode="url" value={ticketUrl} onChange={(e) => setTicketUrl(e.target.value)} placeholder="https://" />
        </Field>
        <Field label="Flyer link">
          <input inputMode="url" value={flyer} onChange={(e) => setFlyer(e.target.value)} placeholder="https://" />
        </Field>
        <Field label="Organiser name">
          <input value={orgName} onChange={(e) => setOrgName(e.target.value)} />
        </Field>
        <Field label="Organiser Instagram handle">
          <input value={orgHandle} onChange={(e) => setOrgHandle(e.target.value)} placeholder="without the @" />
        </Field>
      </div>
      <fieldset>
        <legend className="label">Ticket prices (naira)</legend>
        <div className="space-y-2">
          {tickets.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={`Ticket ${i + 1} name`} className="min-w-0 flex-1" value={t.name} placeholder="Ticket name" onChange={(e) => setTickets((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input aria-label={`Ticket ${i + 1} price`} className="w-28" inputMode="numeric" value={t.price} placeholder="Price" onChange={(e) => setTickets((l) => l.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
              <button type="button" className="btn btn-ghost min-h-[44px] w-11 flex-none px-0 normal-case" aria-label={`Remove ticket ${i + 1}`} onClick={() => setTickets((l) => l.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          <Btn onClick={() => setTickets((l) => [...l, { name: "", price: "", sold_out: false }])}>Add a ticket</Btn>
        </div>
      </fieldset>
      <Fail>{err}</Fail>
      <div className="flex flex-wrap gap-2">
        <Btn solid type="submit" disabled={busy}>
          Save
        </Btn>
        {canApprove && (
          <Btn solid disabled={busy} onClick={() => go(onSaveApprove)}>
            Save and approve
          </Btn>
        )}
        <Btn onClick={onCancel}>Cancel</Btn>
      </div>
    </form>
  );
}
