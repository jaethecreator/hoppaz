"use client";

import { ShieldCheck, XCircle } from "lucide-react";
import { Row, Section, SectionHead, type Act, type Queue } from "./parts";

/**
 * What Hoppers flagged and what waits for a look: open reports (chat and event photo reports) and event photos that stay
 * hidden until a staff member approves them. Same actions as the old desk: resolve_report, review_photo.
 */
export default function SafetySection({ queue, act }: { queue: Queue; act: Act }) {
  return (
    <>
      <SectionHead title="Safety" hint="Close the reports Hoppers sent, and check photos before anyone else sees them." />
      <Section title="Reports">
        {queue.reports.map((r) => (
          <Row key={r.id} title={`${r.kind.toUpperCase()} · ${r.reason}`} sub={r.excerpt ?? "No excerpt"}>
            <span className="hint">{new Date(r.created_at).toLocaleDateString("en-NG")}</span>
            <button className="btn btn-ghost px-3 py-2" onClick={() => void act({ action: "resolve_report", id: r.id })}>
              CLOSE
            </button>
          </Row>
        ))}
        {!queue.reports.length && <p className="hint">No open reports.</p>}
      </Section>
      <Section title="Photo review">
        {queue.photos.map((p) => (
          <Row key={p.id} title={`Photo · ${p.event_id.slice(0, 8)}`} sub="Hidden until approved">
            {p.url && (
              <a href={p.url} target="_blank" rel="noreferrer" className="tag">
                PREVIEW
              </a>
            )}
            <button className="btn px-3 py-2" onClick={() => void act({ action: "review_photo", id: p.id, status: "approved" })}>
              <ShieldCheck size={13} /> APPROVE
            </button>
            <button className="btn btn-ghost px-3 py-2" onClick={() => void act({ action: "review_photo", id: p.id, status: "rejected" })}>
              <XCircle size={13} /> REJECT
            </button>
          </Row>
        ))}
        {!queue.photos.length && <p className="hint">No photos awaiting review.</p>}
      </Section>
    </>
  );
}
