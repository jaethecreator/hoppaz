"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { useToast } from "@/lib/store";
import { Row, Section, SectionHead, type Act, type Queue } from "./parts";

/**
 * Quests: the evidence Hoppers sent (approve or reject) and the form that makes a quest. A quest with a one-time venue code
 * shows its QR here once, to print. Same actions as the old desk: review_quest, save_quest.
 */
export default function QuestsSection({ queue, act, busy }: { queue: Queue; act: Act; busy: boolean }) {
  const say = useToast((s) => s.say);
  const [qr, setQr] = useState<{ value: string; dataUrl: string } | null>(null);
  return (
    <>
      <SectionHead title="Quests" hint="Check the evidence Hoppers sent, and make new quests." />
      <Section title="Quest evidence">
        {queue.claims.map((c) => (
          <Row key={c.id} title={`Quest claim · ${c.id.slice(0, 8)}`} sub={c.evidence ?? "Evidence attached to claim"}>
            <button className="btn px-3 py-2" onClick={() => void act({ action: "review_quest", id: c.id, approve: true })}>
              APPROVE
            </button>
            <button className="btn btn-ghost px-3 py-2" onClick={() => void act({ action: "review_quest", id: c.id, approve: false })}>
              REJECT
            </button>
          </Row>
        ))}
        {!queue.claims.length && <p className="hint">No evidence awaiting review.</p>}
      </Section>
      <Section title="Create a quest">
        <form
          className="grid gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const r = await act({
              action: "save_quest",
              key: f.get("key"),
              title: f.get("title"),
              description: f.get("description"),
              quest_type: f.get("type"),
              event_id: f.get("event_id"),
              repeat_period: f.get("period"),
              xp_reward: f.get("xp"),
              group_size: f.get("group_size"),
              code: f.get("code"),
            });
            if (r) {
              say("QUEST SAVED", "violet");
              const code = String(r.verification_code ?? "");
              if (code) setQr({ value: code, dataUrl: await QRCode.toDataURL(code, { width: 220, margin: 1 }) });
            }
          }}
        >
          <input name="key" required placeholder="quest-key" />
          <input name="title" required placeholder="Quest title" />
          <textarea name="description" placeholder="What players do" />
          <div className="grid grid-cols-2 gap-2">
            <select name="type">
              <option value="checkin">Verified check-in</option>
              <option value="photo">Approved event photo</option>
              <option value="qr">Venue QR code</option>
              <option value="insight">Talk insight + QR</option>
              <option value="group">Group check-in</option>
            </select>
            <select name="period">
              <option value="once">One time</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <select name="event_id">
            <option value="">Any event</option>
            {queue.liveEvents.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input name="xp" type="number" min="0" max="10000" defaultValue="50" placeholder="XP reward" />
            <input name="group_size" type="number" min="2" max="100" defaultValue="2" placeholder="Crew size" />
          </div>
          <input name="code" placeholder="Optional one-time venue code" />
          <button className="btn" disabled={busy}>
            SAVE QUEST
          </button>
        </form>
        {qr && (
          <div className="mt-3 rounded border border-line p-3">
            <p className="seclabel">PRINT THIS QUEST QR</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made in this tab */}
            <img src={qr.dataUrl} alt="Quest QR code" className="mx-auto mt-2 h-44 w-44" />
            <p className="break-all text-center font-mono text-[10px]">{qr.value}</p>
            <button className="btn btn-ghost mt-2 w-full" onClick={() => setQr(null)}>
              HIDE CODE
            </button>
          </div>
        )}
      </Section>
    </>
  );
}
