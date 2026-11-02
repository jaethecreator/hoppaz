"use client";

import { useEffect, useMemo, useState } from "react";
import ClaimRequests from "./ClaimRequests";
import { BUCKET_ORDER, BUCKET_TITLE, STAGE_LABEL, bucketOf, sortInBucket, type Bucket } from "./format";
import OrganiserRow from "./OrganiserRow";
import { LoadFail } from "./ReviewTab";
import { FilterChip, Loading } from "./ui";
import { useOutreach, type FocusRequest } from "./useOutreach";
import type { OrganiserStage } from "@/lib/events-r1/types";

const STAGES: OrganiserStage[] = ["pulled", "listed", "offered", "claimed", "declined"];

/** The tracker: who is next at the top, Claimed and Declined folded away at the bottom. */
export default function OrganisersTab({ focus }: { focus: FocusRequest | null }) {
  const { data } = useOutreach();
  const [stage, setStage] = useState<OrganiserStage | "all">("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  // The open row stays in the group it was opened in, so it does not jump (and lose what is typed) when its stage changes.
  const [pinned, setPinned] = useState<Bucket | null>(null);
  const [folded, setFolded] = useState<Record<string, boolean>>({ claimed: true, declined: true });

  const list = data.organisers;

  const open = (id: string | null) => {
    setOpenId(id);
    const o = id ? list?.find((x) => x.id === id) : undefined;
    setPinned(o ? bucketOf(o) : null);
  };

  // Someone asked to open an organiser: show it, whatever the filter and folds say.
  useEffect(() => {
    if (!focus) return;
    setOpenId(focus.id);
    const o = list?.find((x) => x.id === focus.id);
    setPinned(o ? bucketOf(o) : null);
    setStage("all");
    setQ("");
    setFolded({});
    // only when a new request arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const groups = useMemo(() => {
    const now = Date.now();
    const needle = q.trim().toLowerCase().replace(/^@/, "");
    const by = new Map<Bucket, NonNullable<typeof list>>();
    for (const o of list ?? []) {
      if (stage !== "all" && o.stage !== stage) continue;
      if (needle && ![o.name, o.ig_handle ?? "", o.email ?? "", o.phone ?? ""].some((v) => v.toLowerCase().includes(needle))) continue;
      const b = o.id === openId && pinned ? pinned : bucketOf(o, now);
      by.set(b, [...(by.get(b) ?? []), o]);
    }
    return BUCKET_ORDER.filter((b) => by.has(b)).map((b) => ({ bucket: b, items: sortInBucket(b, by.get(b)!) }));
  }, [list, stage, q, openId, pinned]);

  if (!list) return data.errors.organisers ? <LoadFail text={data.errors.organisers} retry={data.reloadOrganisers} /> : <Loading text="Loading organisers" />;

  const count = (s: OrganiserStage) => list.filter((o) => o.stage === s).length;
  const searching = q.trim() !== "";

  return (
    <div>
      <ClaimRequests />
      <div className="mb-3 space-y-3">
        <input type="search" aria-label="Search organisers" placeholder="Search name, Instagram, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by stage">
          <FilterChip on={stage === "all"} onClick={() => setStage("all")}>
            All {list.length}
          </FilterChip>
          {STAGES.map((s) => (
            <FilterChip key={s} on={stage === s} onClick={() => setStage(s)}>
              {STAGE_LABEL[s]} {count(s)}
            </FilterChip>
          ))}
        </div>
      </div>
      {data.errors.organisers && <p role="alert" className="mb-2 font-body text-[14px] text-fireant">{data.errors.organisers}</p>}

      {groups.map(({ bucket, items }) => {
        const fold = (bucket === "claimed" || bucket === "declined") && !searching && stage === "all" && folded[bucket] !== false && !items.some((o) => o.id === openId);
        const canFold = bucket === "claimed" || bucket === "declined";
        return (
          <section key={bucket} aria-label={BUCKET_TITLE[bucket]} className="mb-4">
            {canFold ? (
              <button type="button" aria-expanded={!fold} onClick={() => setFolded((f) => ({ ...f, [bucket]: !fold ? true : false }))} className="mb-2 flex min-h-[44px] w-full items-center justify-between text-left">
                <span className="seclabel">
                  {BUCKET_TITLE[bucket]} ({items.length})
                </span>
                <span className="font-body text-[13px] text-orange">{fold ? "Show" : "Hide"}</span>
              </button>
            ) : (
              <h2 className="seclabel mb-2">
                {BUCKET_TITLE[bucket]} ({items.length})
              </h2>
            )}
            {!fold && items.map((o) => <OrganiserRow key={o.id} org={o} open={openId === o.id} onToggle={(v) => open(v ? o.id : null)} focus={focus ?? undefined} />)}
          </section>
        );
      })}
      {!groups.length && <p className="hint">{list.length ? "No organiser matches." : "No organisers yet. They appear when you approve pulled events."}</p>}
    </div>
  );
}
