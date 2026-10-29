"use client";

import clsx from "clsx";
import { useState } from "react";
import { copyText } from "@/components/events-r1/page/share";
import { useR1Api, useR1Now, useR1Query, useRoomEvents } from "@/lib/events-r1/hooks";
import type { RoomMember, RoomSummary } from "@/lib/events-r1/types";
import { roleLabel } from "../words";
import { Card, Err, errText, initials } from "./ui";
import { useInviteLink } from "./useInviteLink";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "admin", label: "Admins" },
  { id: "new", label: "New" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

const WEEK = 7 * 864e5;
const DAY = 864e5;

/** "Joined today", "Joined yesterday", "Joined 4 days ago", "Joined 3 weeks ago". */
function joinedWord(iso: string, now: number): string {
  const d = Math.max(0, Math.floor((now - Date.parse(iso)) / DAY));
  return d === 0 ? "Joined today" : d === 1 ? "Joined yesterday" : d < 14 ? `Joined ${d} days ago` : `Joined ${Math.floor(d / 7)} weeks ago`;
}

/**
 * Members: "N people went but haven't joined" with Invite all, join requests (Approve, Decline), search and filters, and a role
 * choice on every row (Admin, Member or Remove). The Host role is hidden for launch. Pick people and Export have no backend and are left out.
 */
export default function MembersTab({ room }: { room: RoomSummary }) {
  const api = useR1Api();
  const now = useR1Now();
  const guests = useR1Query((a) => a.rooms.guestsNotJoined(room.id), [room.id]);
  const requests = useR1Query((a) => a.rooms.requests(room.id), [room.id]);
  const members = useR1Query((a) => a.rooms.members(room.id), [room.id]);
  const events = useRoomEvents(room.id);
  const link = useInviteLink(room);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [sent, setSent] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  const tell = (s: string) => {
    setNote(s);
    window.setTimeout(() => setNote(""), 2200);
  };
  const run = async (key: string, fn: () => Promise<void>, done?: string) => {
    if (busy) return;
    setBusy(key);
    setError("");
    try {
      await fn();
      if (done) tell(done);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy("");
    }
  };

  const n = guests.data?.count ?? 0;
  // One tap: a Pop to the people of the room's latest event, with the room's link (the same as the done sheet).
  const live = (events.data ?? []).filter((e) => e.status !== "cancelled");
  const latest = [...live].sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))[0] ?? null;
  const inviteAll = () =>
    run("invite", async () => {
      if (!api || !latest) throw new Error("Post an event first. Invites go to the people who came to it");
      await api.pops.send({ eventId: latest.id, body: `Join ${room.name} on Hoppaz: ${link.url}`, audience: "everyone", alsoRoom: false });
      setSent(true);
    }, `Invited ${n} ${n === 1 ? "guest" : "guests"}`);

  const me = api?.auth.current()?.id;
  const all = members.data ?? [];
  const list = all.filter((m) => {
    if (q.trim() && !m.name.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (filter === "admin") return m.role === "admin" || m.role === "owner";
    if (filter === "new") return now - Date.parse(m.joined_at) < WEEK;
    return true;
  });

  const setRole = (m: RoomMember, v: string) => {
    if (v === "remove") return setConfirm(m.user_id);
    if (!api) return;
    void run(m.user_id, () => api.rooms.setRole(room.id, m.user_id, v === "admin" ? "admin" : "member"), `${m.name.split(" ")[0]} is now ${v === "admin" ? "an admin" : "a member"}`);
  };

  return (
    <div className="flex flex-col gap-4">
      {n > 0 && (
        <Card title={`${n.toLocaleString("en-NG")} ${n === 1 ? "person" : "people"} went but haven't joined`} aside={latest ? `From ${latest.title}` : undefined} label="Went but haven't joined">
          <p className="font-body text-[14px] text-t-muted">{latest ? `They get one Pop from ${latest.title}: "Join ${room.name} on Hoppaz".` : "They went to your events and are not in the room yet."}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className="lip !px-5" disabled={busy === "invite" || sent || !latest} onClick={() => void inviteAll()} data-invite-all>
              {sent ? "Invited" : busy === "invite" ? "Sending" : `Invite all ${n.toLocaleString("en-NG")}`}
            </button>
          </div>
        </Card>
      )}

      {(requests.data ?? []).length > 0 && (
        <Card title="Asking to join" aside={`${requests.data!.length} waiting`} label="Join requests">
          <ul className="divide-y divide-t-line">
            {requests.data!.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5 first:pt-0" data-request={r.id}>
                <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-t-soft font-display text-[13px] font-black text-t-accent" aria-hidden>
                  {initials(r.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-body text-[15px] font-semibold">{r.name}</span>
                  {r.ticket_event && (
                    <span className="block truncate font-body text-[13px] text-t-muted" data-request-ticket>
                      Bought a ticket for {r.ticket_event.title}
                    </span>
                  )}
                </span>
                <button type="button" className="lip !min-h-[40px] flex-none !px-4 !py-2" disabled={!!busy} onClick={() => api && void run(r.id, () => api.rooms.decideRequest(r.id, true), "Approved. They get a notice in the app")}>
                  Approve
                </button>
                <button type="button" className="lip-ghost flex-none !min-h-[40px] !px-4" disabled={!!busy} onClick={() => api && void run(r.id, () => api.rooms.decideRequest(r.id, false))}>
                  Decline
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members" aria-label="Search members" autoComplete="off" className="min-w-0 flex-1 basis-48" />
        <button type="button" className="lip-ghost flex-none !min-h-[44px] !px-4" onClick={async () => tell((await copyText(link.url)) ? "Invite link copied" : "Could not copy")}>
          Copy invite link
        </button>
      </div>
      <div role="radiogroup" aria-label="Filter" className="flex gap-2">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="radio" aria-checked={filter === f.id} onClick={() => setFilter(f.id)} className="chip min-h-[40px] flex-none px-4 font-body text-[14px] normal-case tracking-normal">
            {f.label}
          </button>
        ))}
      </div>

      <section className="t-card px-4 lg:px-5" aria-label="Members">
        {members.loading && !members.data && <p className="py-4 font-body text-[14px] text-t-muted">Loading</p>}
        {members.data && list.length === 0 && <p className="py-4 font-body text-[14px] text-t-muted">No members match.</p>}
        <ul className="divide-y divide-t-line">
          {list.map((m) => {
            const mine = m.user_id === me;
            const lockedAdmin = room.my_role === "admin" && m.role === "admin";
            const value = m.role === "admin" ? "admin" : "member";
            return (
              <li key={m.user_id} className="py-3" data-member={m.user_id}>
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-t-soft font-display text-[14px] font-black text-t-accent" aria-hidden>
                    {initials(m.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate font-body text-[16px]">{m.name}</b>
                    <span className="block truncate font-body text-[13px] text-t-muted">{mine ? "You · " : ""}{joinedWord(m.joined_at, now)}</span>
                  </span>
                  {m.role === "owner" ? (
                    <span className="flex-none rounded-hz bg-t-soft px-2.5 py-1 font-body text-[13px] font-bold">{roleLabel("owner")}</span>
                  ) : mine || lockedAdmin ? (
                    <span className="flex-none rounded-hz bg-t-soft px-2.5 py-1 font-body text-[13px] font-bold">{roleLabel(m.role)}</span>
                  ) : (
                    <select value={value} disabled={busy === m.user_id} onChange={(e) => setRole(m, e.target.value)} aria-label={`Role for ${m.name}`} className="!w-auto flex-none" data-role>
                      <option value="admin" disabled={room.my_role === "admin"}>
                        Admin
                      </option>
                      <option value="member">Member</option>
                      <option value="remove">Remove</option>
                    </select>
                  )}
                </div>
                {confirm === m.user_id && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-hz border border-t-line bg-t-bg p-3" role="alertdialog" aria-label={`Remove ${m.name}`}>
                    <span className="min-w-0 flex-1 basis-48 font-body text-[14px]">Remove {m.name} from {room.name}? They can join again if the room lets them.</span>
                    <button type="button" className="lip !min-h-[40px] flex-none !px-4 !py-2" onClick={() => api && void run(m.user_id, async () => { await api.rooms.removeMember(room.id, m.user_id); setConfirm(null); }, "Removed from the room")}>
                      Remove
                    </button>
                    <button type="button" className="lip-ghost flex-none !min-h-[40px] !px-4" onClick={() => setConfirm(null)}>
                      Keep
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <Err>{error}</Err>
      <p className={clsx("-mt-2 min-h-[18px] font-body text-[13px] font-bold text-t-muted")} aria-live="polite">
        {note}
      </p>

      <Card title="Roles">
        <ul className="divide-y divide-t-line font-body text-[14px]">
          <li className="flex gap-4 py-2 first:pt-0">
            <span className="w-16 flex-none font-mono text-[13px] text-t-accent">Owner</span>
            <span>Everything, including payouts and deleting the room</span>
          </li>
          <li className="flex gap-4 py-2">
            <span className="w-16 flex-none font-mono text-[13px] text-t-accent">Admin</span>
            <span>Runs every event, the guests and the door. Everything except payouts and deleting the room</span>
          </li>
          <li className="flex gap-4 py-2">
            <span className="w-16 flex-none font-mono text-[13px] text-t-accent">Member</span>
            <span>Gets events first, chats and joins the room</span>
          </li>
        </ul>
        <p className="mt-2 font-body text-[13px] text-t-muted">Door staff are added for one event only, from that event&apos;s Guests tab.</p>
      </Card>
    </div>
  );
}
