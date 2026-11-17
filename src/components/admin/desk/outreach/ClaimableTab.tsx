"use client";

import { useState } from "react";
import CopyClaimLink from "./CopyClaimLink";
import { ago, when } from "./format";
import { LoadFail } from "./ReviewTab";
import { Btn, Fail, Loading, Tag } from "./ui";
import { wentToBuy } from "./taps";
import { useOutreach } from "./useOutreach";

/**
 * Claimable: the listings Hoppaz hosts that nobody has claimed, and the asks from people without a link. Staff copy a claim link for a listing
 * (it works once, needs no email) or approve or decline an ask (an approve hands the room over now). Only while the event_claims flag is on.
 */
export default function ClaimableTab({ onOpen }: { onOpen: (organiserId: string) => void }) {
  const { data, api, by, say } = useOutreach();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const list = data.claimable;
  const asks = (data.asks ?? []).filter((a) => a.status === "new");

  if (!list || !data.asks) return data.errors.claims ? <LoadFail text={data.errors.claims} retry={data.reloadClaims} /> : <Loading text="Loading claimable listings" />;

  const decide = async (id: string, approve: boolean, who: string, title: string) => {
    setBusy(id);
    setErr("");
    try {
      const out = await api.decideClaimAsk(id, approve, by);
      say(approve ? `Handed ${title} to ${who}. ${out.moved_events} upcoming ${out.moved_events === 1 ? "event" : "events"} moved.` : `Declined ${who}'s ask about ${title}.`);
      void data.reloadClaims();
      void data.reloadOrganisers();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That did not work");
    }
    setBusy("");
  };

  return (
    <div>
      {data.errors.claims && <Fail>{data.errors.claims}</Fail>}
      <section aria-label="Asks to claim" className="card mb-4 !p-3" data-claim-asks>
        <h2 className="seclabel mb-2 text-orange">Asks to claim ({asks.length})</h2>
        {asks.length === 0 && <p className="hint">No one is waiting. People ask from the strip on a listing, after signing in.</p>}
        {asks.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-0">
            <div className="min-w-0 flex-1 basis-[220px]">
              <p className="font-display text-sm font-bold">{a.event_title}</p>
              <p className="font-body text-[14px]">{a.name}</p>
              {a.note && <p className="font-body text-[14px] text-dim">“{a.note}”</p>}
              <p className="hint">
                {a.organiser_name ?? "Organiser not matched"} · {ago(a.created_at)}
              </p>
            </div>
            <Btn solid disabled={busy === a.id} onClick={() => void decide(a.id, true, a.name, a.event_title)}>
              Approve
            </Btn>
            <Btn disabled={busy === a.id} onClick={() => void decide(a.id, false, a.name, a.event_title)}>
              Decline
            </Btn>
          </div>
        ))}
        <Fail>{err}</Fail>
      </section>

      <p className="seclabel mb-2">Listings nobody has claimed ({list.length})</p>
      {list.length === 0 && <p className="hint">Nothing to claim right now.</p>}
      {list.map((c) => (
        <section key={c.event_id} aria-label={c.title} className="card mb-2 !p-3" data-claimable-row>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1 basis-[200px]">
              <span className="flex flex-wrap items-center gap-2">
                <span className="break-words font-display text-[15px] font-bold">{c.title}</span>
                {c.link_open && <Tag tone="pill-violet">Link open</Tag>}
                {c.asks > 0 && <Tag tone="pill-danfo">{c.asks} asked to claim</Tag>}
              </span>
              <span className="hint mt-0.5 block">
                {when(c.starts_at)}
                {c.organiser_name ? ` · ${c.organiser_name}` : ""}
                {wentToBuy(c.went_to_buy) ? ` · ${wentToBuy(c.went_to_buy)}` : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <CopyClaimLink target={{ eventId: c.event_id }} name={c.title} solid />
              {c.organiser_id && <Btn onClick={() => onOpen(c.organiser_id as string)}>Organiser</Btn>}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
