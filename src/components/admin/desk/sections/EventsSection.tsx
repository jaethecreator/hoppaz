"use client";

import { useState } from "react";
import { Row, Section, SectionHead, type Act, type Queue } from "./parts";

/**
 * Events waiting for a yes. Approving needs the venue's real coordinates (Lagos only), so an event can never go live on a
 * guessed spot. Same actions as the old desk's "Event queue": review_event with status live (and lat, lng) or rejected.
 */
export default function EventsSection({ queue, act }: { queue: Queue; act: Act }) {
  return (
    <>
      <SectionHead title="Events" hint="Approve the events Hoppers sent in. Add the venue's coordinates first." />
      <Section title="Event queue">
        {queue.events.map((e) => (
          <PendingEventRow key={e.id} event={e} review={act} />
        ))}
        {!queue.events.length && <p className="hint">No pending events.</p>}
      </Section>
    </>
  );
}

function PendingEventRow({ event, review }: { event: Queue["events"][number]; review: Act }) {
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const coords =
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng)) &&
    lat !== "" &&
    lng !== "" &&
    Number(lat) >= 6.3 &&
    Number(lat) <= 6.8 &&
    Number(lng) >= 3.05 &&
    Number(lng) <= 3.95;
  return (
    <Row
      title={event.title}
      sub={`${event.venue_name} · ${event.area ?? "area not set"} · ${new Date(event.starts_at).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })}`}
    >
      <div className="flex gap-1">
        <input aria-label="Venue latitude" className="w-24" inputMode="decimal" placeholder="Latitude" value={lat} onChange={(e) => setLat(e.target.value)} />
        <input aria-label="Venue longitude" className="w-24" inputMode="decimal" placeholder="Longitude" value={lng} onChange={(e) => setLng(e.target.value)} />
      </div>
      {event.ig_url && (
        <a href={event.ig_url} target="_blank" rel="noreferrer noopener" className="tag">
          SOURCE ↗
        </a>
      )}
      <button
        className="btn px-3 py-2"
        disabled={!coords}
        title="Set the verified venue coordinates first"
        onClick={() => void review({ action: "review_event", id: event.id, status: "live", lat: Number(lat), lng: Number(lng) })}
      >
        APPROVE
      </button>
      <button className="btn btn-ghost px-3 py-2" onClick={() => void review({ action: "review_event", id: event.id, status: "rejected" })}>
        REJECT
      </button>
    </Row>
  );
}
