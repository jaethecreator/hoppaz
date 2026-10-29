"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { useR1Api, useR1Query } from "@/lib/events-r1/hooks";
import type { Registration } from "@/lib/events-r1/types";

const msg = (e: unknown) => (e instanceof Error ? e.message : "That did not work. Try again");

/**
 * Door staff for one event: the people who only scan at the door. The list, Remove, and "Add door staff" (pick from the people going).
 * Shown to whoever manages the event (the host, a room's owner or admins); a door person asking gets "Not allowed" and sees nothing.
 * Used on the Guests tab (tinted, `plain` off) and on the door page (dark, `plain`).
 */
export default function DoorStaffCard({ eventId, plain }: { eventId: string; plain?: boolean }) {
  const api = useR1Api();
  const staff = useR1Query((a) => a.door.staff(eventId), [eventId]);
  const guests = useR1Query((a) => a.registrations.list(eventId), [eventId]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const people = staff.data ?? [];
  const taken = useMemo(() => new Set(people.map((p) => p.user_id)), [people]);
  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const seen = new Set<string>();
    const out: Registration[] = [];
    for (const r of guests.data ?? []) {
      if ((r.status !== "going" && r.status !== "checked_in") || taken.has(r.user_id) || seen.has(r.user_id)) continue;
      if (needle && !r.name.toLowerCase().includes(needle)) continue;
      seen.add(r.user_id);
      out.push(r);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8);
  }, [guests.data, taken, q]);

  // Door staff and everyone else who may not manage: nothing to show.
  if (staff.error?.message === "Not allowed") return null;
  if (!api || (staff.loading && !staff.data)) return null;

  const set = async (userId: string, on: boolean) => {
    setBusy(userId);
    setError("");
    try {
      await api.door.setStaff(eventId, userId, on);
      await staff.reload();
      if (on) setQ("");
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy("");
    }
  };

  const muted = plain ? "text-dim" : "text-t-muted";
  const line = plain ? "border-line" : "border-t-line";
  const ghost = plain ? "btn btn-ghost min-h-[40px] flex-none px-4 normal-case" : "lip-ghost flex-none !min-h-[40px] !px-4";
  const main = plain ? "btn min-h-[40px] flex-none px-4 normal-case" : "lip flex-none !min-h-[40px] !px-4 !py-2";

  return (
    <section aria-label="Door staff" data-door-staff className={plain ? "rounded-hz border border-line bg-ink-2 p-4" : "t-card p-4 lg:p-5"}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <h3 className={clsx("font-body text-[16px] font-extrabold", plain && "text-cream")}>Door staff</h3>
          <p className={clsx("font-body text-[13.5px]", muted)}>People who only scan at the door. They can&apos;t see sales or change anything.</p>
        </div>
        <button type="button" className={main} aria-expanded={open} onClick={() => setOpen(!open)} data-add-door-staff>
          {open ? "Done" : "Add door staff"}
        </button>
      </div>

      {people.length > 0 && (
        <ul className="mt-3">
          {people.map((p) => (
            <li key={p.user_id} className={clsx("flex items-center gap-3 border-t py-2.5", line)}>
              <span className={clsx("min-w-0 flex-1 truncate font-body text-[15px] font-semibold", plain && "text-cream")}>{p.name}</span>
              <button type="button" className={ghost} disabled={busy === p.user_id} onClick={() => void set(p.user_id, false)} aria-label={`Remove ${p.name} from door staff`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {people.length === 0 && !open && <p className={clsx("mt-3 font-body text-[13.5px]", muted)}>No one yet. Add a friend who will stand at the door with a phone.</p>}

      {open && (
        <div className={clsx("mt-3 border-t pt-3", line)}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the people going by name" aria-label="Search the people going by name" autoComplete="off" className="w-full" />
          <ul className="mt-1">
            {options.map((r) => (
              <li key={r.user_id} className={clsx("flex items-center gap-3 border-b py-2.5", line)}>
                <span className={clsx("min-w-0 flex-1 truncate font-body text-[15px]", plain && "text-cream")}>{r.name}</span>
                <button type="button" className={ghost} disabled={busy === r.user_id} onClick={() => void set(r.user_id, true)}>
                  Add
                </button>
              </li>
            ))}
          </ul>
          {options.length === 0 && (
            <p className={clsx("pt-3 font-body text-[13.5px]", muted)}>{(guests.data ?? []).length ? "No one matches. Door staff are picked from the people going." : "Door staff are picked from the people going. Nobody has registered yet."}</p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 font-body text-[14px] text-fireant">
          {error}
        </p>
      )}
    </section>
  );
}
