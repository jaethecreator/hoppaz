"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { useToast } from "@/lib/store";
import Hunt3D from "@/components/Hunt3D";
import SpawnerSection from "@/components/admin/SpawnerSection";
import GameTimeSection from "@/components/admin/GameTimeSection";
import { HUNT_ITEMS, HUNT_KEYS, RARITY, type HuntKey } from "@/lib/huntItems";
import { Row, Section, SectionHead, type Act, type Queue } from "./parts";

/**
 * The tools that are not part of a night's work: partner setup, 3D collectibles, map drops with partner rewards, the street
 * box spawner, Outside Score rules, and the old Game Time desk kept as a fallback. They are the old desk's cards, moved here
 * with the same forms and actions (save_partner, place_hunt, create_drop, add_drop_reward, set_score_rule).
 */
export default function MoreSection({ queue, act, busy, loaded, token, onLock }: { queue: Queue; act: Act; busy: boolean; loaded: boolean; token: string; onLock: () => void }) {
  const say = useToast((s) => s.say);
  const [eventId, setEventId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [qr, setQr] = useState<{ value: string; dataUrl: string } | null>(null);
  const [huntKey, setHuntKey] = useState<HuntKey>("jollof-pot");
  const [huntQr, setHuntQr] = useState<{ value: string; dataUrl: string; event: string } | null>(null);
  // The classic desk loads its own data, so it starts only once someone opens it.
  const [classicSeen, setClassicSeen] = useState(false);
  return (
    <>
      <SectionHead title="More tools" hint="Partners, map drops, collectibles, the street box spawner and score rules." />
      <Section title="Partner setup">
        <form
          className="grid gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const r = await act({ action: "save_partner", name: f.get("name"), description: f.get("description"), website: f.get("website") });
            if (r) {
              setPartnerId(String((r.partner as { id: string }).id));
              say("PARTNER ADDED", "violet");
            }
          }}
        >
          <input name="name" required placeholder="Partner name" />
          <input name="description" placeholder="Partner details" />
          <input name="website" type="url" placeholder="Website" />
          <button className="btn" disabled={busy}>
            ADD PARTNER
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-1">
          {queue.partners.map((p) => (
            <button key={p.id} className={`tag ${partnerId === p.id ? "tag-o" : ""}`} onClick={() => setPartnerId(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Hide a 3D collectible">
        <form
          className="grid gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const r = await act({
              action: "place_hunt",
              hunt_item: huntKey,
              event_id: f.get("event_id"),
              radius_m: f.get("radius"),
              xp_amount: f.get("xp"),
              max_claims: f.get("max_claims") || null,
              partner_id: f.get("partner_id") || null,
            });
            if (r) {
              const value = String(r.qr_code ?? "");
              setHuntQr({ value, event: String(r.event ?? ""), dataUrl: await QRCode.toDataURL(value, { width: 220, margin: 1 }) });
              say(`${HUNT_ITEMS[huntKey].name.toUpperCase()} HIDDEN`, "violet");
            }
          }}
        >
          <p className="hint">Hoppers at the event find it through their camera and claim it on location. Print the QR as a fallback for phones without a compass.</p>
          <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Item to hide">
            {HUNT_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={huntKey === k}
                onClick={() => setHuntKey(k)}
                className={`rounded border p-1 text-center ${huntKey === k ? "border-orange bg-orange/10" : "border-line"}`}
              >
                <span className="block text-2xl">{HUNT_ITEMS[k].emoji}</span>
                <span className="block font-mono text-[7px] font-bold" style={{ color: RARITY[HUNT_ITEMS[k].rarity].color }}>
                  {RARITY[HUNT_ITEMS[k].rarity].label}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Hunt3D item={huntKey} className="h-24 w-24 flex-none" />
            <div>
              <b className="font-display">{HUNT_ITEMS[huntKey].name}</b>
              <p className="hint">{HUNT_ITEMS[huntKey].blurb}</p>
            </div>
          </div>
          <select name="event_id" required defaultValue="">
            <option value="" disabled>
              Event to hide it at
            </option>
            {queue.liveEvents.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
          <select name="partner_id" defaultValue="">
            <option value="">Hoppaz hunt</option>
            {queue.partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-3 gap-2">
            <input key={huntKey} name="xp" type="number" min="0" defaultValue={HUNT_ITEMS[huntKey].xp} placeholder="XP" aria-label="XP reward" />
            <input name="radius" type="number" min="25" defaultValue="150" placeholder="Radius m" aria-label="Claim radius in metres" />
            <input name="max_claims" type="number" min="1" placeholder="Claims cap" aria-label="Claims cap" />
          </div>
          <p className="hint">Opens an hour before the event, closes an hour after. Add vouchers to its reward pool under Active map drops.</p>
          <button className="btn" disabled={busy}>
            HIDE IT AT THIS EVENT
          </button>
        </form>
        {huntQr && (
          <div className="mt-3 rounded border border-line p-3">
            <p className="seclabel">FALLBACK QR · {huntQr.event}</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made in this tab */}
            <img src={huntQr.dataUrl} alt="Hunt claim QR code" className="mx-auto mt-2 h-44 w-44" />
            <p className="break-all text-center font-mono text-[10px]">{huntQr.value}</p>
            <button className="btn btn-ghost mt-2 w-full" onClick={() => setHuntQr(null)}>
              HIDE CODE
            </button>
          </div>
        )}
      </Section>
      <Section title="Map drop (partner rewards)">
        <p className="hint mb-3">This is the map drop, not a Game Time ticket drop. Hoppers claim it on the map by location or QR. Add Game Time drops from Rooms.</p>
        <form
          className="grid gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const codes = String(f.get("codes") ?? "")
              .split(/[,\n]/)
              .map((x) => x.trim())
              .filter(Boolean);
            const r = await act({
              action: "create_drop",
              title: f.get("title"),
              description: f.get("description"),
              partner_id: partnerId || null,
              event_id: eventId || null,
              area: f.get("area"),
              lat: f.get("lat"),
              lng: f.get("lng"),
              opens_at: f.get("opens_at"),
              closes_at: f.get("closes_at"),
              radius_m: f.get("radius"),
              claim_method: f.get("claim_method"),
              max_claims: f.get("max_claims"),
              reward_model: f.get("reward_model"),
              reward: {
                type: f.get("reward_type"),
                title: f.get("reward_title"),
                description: f.get("reward_description"),
                quantity: f.get("quantity") || null,
                weight: f.get("weight"),
                xp_amount: f.get("xp"),
                codes,
              },
            });
            if (r) {
              const value = String(r.qr_code ?? "");
              if (value) {
                await navigator.clipboard.writeText(value).catch(() => {});
                setQr({ value, dataUrl: await QRCode.toDataURL(value, { width: 220, margin: 1 }) });
                say("DROP CREATED · CLAIM CODE COPIED", "violet");
              } else say("DROP CREATED", "violet");
            }
          }}
        >
          <input name="title" required placeholder="Mystery drop title" />
          <textarea name="description" placeholder="Where and how to claim" />
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            <option value="">Hoppaz drop</option>
            {queue.partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">Neighborhood drop</option>
            {queue.liveEvents.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input name="area" placeholder="Lagos area" />
            <input name="radius" type="number" defaultValue="250" placeholder="Radius m" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input name="lat" type="number" step="any" placeholder="Latitude if neighborhood drop" />
            <input name="lng" type="number" step="any" placeholder="Longitude" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="label">
              Opens
              <input name="opens_at" required type="datetime-local" />
            </label>
            <label className="label">
              Closes
              <input name="closes_at" required type="datetime-local" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select name="claim_method">
              <option value="either">Location or QR</option>
              <option value="proximity">Location</option>
              <option value="qr">QR only</option>
            </select>
            <select name="reward_model">
              <option value="fixed">Fixed reward</option>
              <option value="random">Random reward pool</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input name="max_claims" type="number" min="1" placeholder="Total claims cap" />
            <select name="reward_type">
              <option value="discount">Discount</option>
              <option value="ticket">Ticket</option>
              <option value="upgrade">Upgrade</option>
              <option value="xp">XP</option>
              <option value="badge">Badge</option>
              <option value="collectible">Collectible</option>
            </select>
          </div>
          <input name="reward_title" required placeholder="Reward reveal title" />
          <input name="reward_description" placeholder="Reward details" />
          <div className="grid grid-cols-3 gap-2">
            <input name="quantity" type="number" min="1" placeholder="Stock" />
            <input name="weight" type="number" step="any" min="0.01" defaultValue="1" placeholder="Random weight" />
            <input name="xp" type="number" min="0" defaultValue="0" placeholder="XP amount" />
          </div>
          <textarea name="codes" placeholder="Reward codes, one per line (discount/tickets)" />
          <button className="btn" disabled={busy}>
            CREATE LIVE DROP
          </button>
        </form>
        {qr && (
          <div className="mt-3 rounded border border-line p-3">
            <p className="seclabel">PRINT THIS CLAIM QR</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made in this tab */}
            <img src={qr.dataUrl} alt="Drop claim QR code" className="mx-auto mt-2 h-44 w-44" />
            <p className="break-all text-center font-mono text-[10px]">{qr.value}</p>
            <button className="btn btn-ghost mt-2 w-full" onClick={() => setQr(null)}>
              HIDE CODE
            </button>
          </div>
        )}
      </Section>
      <Section title="Active map drops">
        {queue.drops.map((d) => (
          <div key={d.id} className="border-t border-line py-2 first:border-0">
            <Row title={d.title} sub={`${d.claimed_count}${d.max_claims ? ` / ${d.max_claims}` : ""} claims`}>
              <span className="tag">{d.active ? "ACTIVE" : "PAUSED"}</span>
            </Row>
            <details className="mt-2">
              <summary className="font-mono text-[9px] font-bold text-orange">ADD REWARD POOL ITEM</summary>
              <form
                className="mt-2 grid gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const codes = String(f.get("codes") ?? "")
                    .split(/[,\n]/)
                    .map((x) => x.trim())
                    .filter(Boolean);
                  const r = await act({
                    action: "add_drop_reward",
                    drop_id: d.id,
                    type: f.get("type"),
                    title: f.get("title"),
                    description: f.get("description"),
                    quantity: f.get("quantity") || null,
                    weight: f.get("weight"),
                    xp_amount: f.get("xp"),
                    codes,
                  });
                  if (r) say("REWARD POOL UPDATED", "violet");
                }}
              >
                <div className="grid grid-cols-2 gap-2">
                  <select name="type">
                    <option value="discount">Discount</option>
                    <option value="ticket">Ticket</option>
                    <option value="upgrade">Upgrade</option>
                    <option value="xp">XP</option>
                    <option value="badge">Badge</option>
                  </select>
                  <input name="title" required placeholder="Reward title" />
                </div>
                <input name="description" placeholder="Reward details" />
                <div className="grid grid-cols-3 gap-2">
                  <input name="quantity" type="number" min="1" placeholder="Stock" />
                  <input name="weight" type="number" min="0.01" step="any" defaultValue="1" placeholder="Weight" />
                  <input name="xp" type="number" min="0" defaultValue="0" placeholder="XP" />
                </div>
                <textarea name="codes" placeholder="Unique voucher codes (one per line)" />
                <button className="btn px-3 py-2">ADD TO POOL</button>
              </form>
            </details>
          </div>
        ))}
        {!queue.drops.length && <p className="hint">No map drops yet.</p>}
      </Section>
      <SpawnerSection spawner={queue.spawner} act={act} busy={busy} loading={!loaded} />
      <Section title="Outside Score rules">
        {queue.rules.map((rule) => (
          <form
            key={rule.key}
            className="mb-2 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act({ action: "set_score_rule", key: rule.key, score: f.get("score") });
            }}
          >
            <span className="flex-1 font-mono text-[10px] uppercase">{rule.key}</span>
            <input name="score" type="number" min="0" max="10000" defaultValue={rule.score} className="max-w-24" />
            <button className="btn px-3 py-2">SAVE</button>
          </form>
        ))}
      </Section>
      {/* The classic desk draws its own cards, so this only draws the lid: the cards open under it, not inside another card. */}
      <details className="mb-4" onToggle={(e) => e.currentTarget.open && setClassicSeen(true)}>
        <summary className="card seclabel cursor-pointer p-3 text-orange">Game Time, classic desk</summary>
        <p className="hint mt-3">The old Game Time desk, kept as a fallback. Add drops from Rooms.</p>
        <div className="mt-3">{classicSeen && <GameTimeSection token={token} onLock={onLock} />}</div>
      </details>
    </>
  );
}
