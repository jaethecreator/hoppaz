"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { CalendarPlus, Check, Flag, MoreHorizontal, Share2 } from "lucide-react";
import { useR1Api, useViewerState } from "@/lib/events-r1/hooks";
import type { R1Event, ReportReason } from "@/lib/events-r1/types";
import SignInSheet from "../SignInSheet";
import { downloadIcs } from "./calendar";
import { eventUrl, shareOrCopy } from "./share";
import { useFreshEvent } from "./useFreshEvent";

const REASONS: Array<{ id: ReportReason; text: string }> = [
  { id: "fake_or_scam", text: "Fake or scam" },
  { id: "wrong_place", text: "Wrong place" },
  { id: "offensive", text: "Offensive" },
  { id: "other", text: "Other" },
];

const ITEM = "flex min-h-[48px] w-full items-center gap-3 px-4 text-left font-body text-[15px] text-cream hover:bg-ink-2";

/**
 * The top of the event page: Event | Room side by side, and the "..." menu (Share, Add to calendar, Report this event).
 * The menu and the report form open in the page itself, not over it.
 * Room goes to the host's room; with no room it stays, greyed out, so the row does not jump between events.
 */
export default function EventTabs({ event: given }: { event: R1Event }) {
  const event = useFreshEvent(given);
  const api = useR1Api();
  const { data: viewer } = useViewerState(event.id);
  const room = event.host.roomId;
  const [menu, setMenu] = useState(false);
  const [said, setSaid] = useState("");
  const [reporting, setReporting] = useState(false);
  const [signin, setSignin] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!said) return;
    const t = window.setTimeout(() => setSaid(""), 2200);
    return () => window.clearTimeout(t);
  }, [said]);

  const closeMenu = () => {
    setMenu(false);
    setReporting(false);
    setSent(false);
    setError("");
  };

  const share = async () => {
    const res = await shareOrCopy({ title: event.title, text: event.title, url: eventUrl(event) });
    if (res === "copied") setSaid("Copied");
    else if (res === "failed") setSaid("Could not copy");
  };

  const openReport = () => {
    setError("");
    if (viewer && !viewer.signedIn) setSignin(true);
    else setReporting(true);
  };

  const send = async () => {
    if (!api || !reason || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.reports.report(event.id, reason, note);
      setSent(true);
      setReporting(false);
      setReason(null);
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const tab = "flex min-h-[44px] flex-1 items-center justify-center px-3 font-display text-[14px] font-black";

  return (
    <div className="px-5 pt-1">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 overflow-hidden rounded-hz border border-line" role="group" aria-label="Event or room">
          <span aria-current="page" className={clsx(tab, "bg-orange text-brand-ink")}>
            Event
          </span>
          {room ? (
            <Link href={`/rooms/${encodeURIComponent(room)}`} className={clsx(tab, "text-cream")}>
              Room
            </Link>
          ) : (
            <span aria-disabled="true" title="This host has no room yet" className={clsx(tab, "text-dim/60")}>
              Room
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => (menu ? closeMenu() : setMenu(true))}
          aria-expanded={menu}
          aria-label="More"
          className={clsx("grid h-11 w-11 flex-none place-items-center rounded-hz border text-cream", menu ? "border-orange" : "border-line")}
        >
          <MoreHorizontal size={20} aria-hidden />
        </button>
      </div>

      {menu && (
        <div className="mt-2 overflow-hidden rounded-hz border border-line bg-ink-3">
          {reporting ? (
            <div className="p-4">
              <p className="font-display text-[16px] font-black">Report this event</p>
              <div role="radiogroup" aria-label="Reason" className="mt-2.5 space-y-1.5">
                {REASONS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={reason === r.id}
                    onClick={() => setReason(r.id)}
                    className="flex min-h-[44px] w-full items-center gap-3 rounded-hz border border-line px-3 text-left font-body text-[15px] aria-checked:border-orange"
                  >
                    <span className={clsx("grid h-[18px] w-[18px] flex-none place-items-center rounded-full border", reason === r.id ? "border-orange" : "border-dim")}>
                      {reason === r.id && <span className="h-2.5 w-2.5 rounded-full bg-orange" />}
                    </span>
                    {r.text}
                  </button>
                ))}
              </div>
              <label htmlFor="report-note" className="mb-1.5 mt-3 block font-body text-[13px] text-dim">
                Add a note (optional)
              </label>
              <textarea id="report-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
              {error && (
                <p role="alert" className="mt-2 font-body text-[13px] text-fireant">
                  {error}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => void send()} disabled={!reason || busy} aria-busy={busy} className="btn flex-1 normal-case">
                  Send report
                </button>
                <button type="button" onClick={() => setReporting(false)} className="btn btn-ghost normal-case">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              <li>
                <button type="button" onClick={() => void share()} className={ITEM}>
                  <Share2 size={16} className="text-orange" aria-hidden /> Share
                  {said && <span className="ml-auto text-[13px] text-dim">{said}</span>}
                </button>
              </li>
              <li>
                <button type="button" onClick={() => downloadIcs(event)} className={ITEM}>
                  <CalendarPlus size={16} className="text-orange" aria-hidden /> Add to calendar
                </button>
              </li>
              {!viewer?.isHost && (
                <li>
                  {sent ? (
                    <p className="flex min-h-[48px] items-center gap-3 px-4 font-body text-[14px] text-dim" role="status">
                      <Check size={16} aria-hidden /> Thanks. We&apos;ll look at it.
                    </p>
                  ) : (
                    <button type="button" onClick={openReport} className={ITEM}>
                      <Flag size={16} className="text-orange" aria-hidden /> Report this event
                    </button>
                  )}
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      <SignInSheet
        open={signin}
        reason="Report this event"
        onClose={() => setSignin(false)}
        onSignedIn={() => {
          setSignin(false);
          setReporting(true);
        }}
      />
    </div>
  );
}
