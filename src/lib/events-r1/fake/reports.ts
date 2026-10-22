/** Fake reports: anyone signed in can report an event; staff see the list and mark reports reviewed. */
import type { ReportsApi } from "../api";
import type { ReportReason } from "../types";
import { canOpen, findEvent, requireViewer } from "./rules";
import { emit, now, S, viewer } from "./store";
import { clone, newId } from "./util";

const REASONS: ReportReason[] = ["fake_or_scam", "wrong_place", "offensive", "other"];

function requireStaff(): void {
  const v = viewer();
  if (!v) throw new Error("Sign in first");
  if (!v.staff) throw new Error("Not allowed");
}

export const reports: ReportsApi = {
  async report(eventId, reason, note) {
    const v = requireViewer();
    const e = findEvent(eventId);
    if (!e || !canOpen(e)) throw new Error("Event not found");
    if (!REASONS.includes(reason)) throw new Error("Pick a reason");
    const id = newId();
    S().reports[id] = {
      id, event_id: e.id, event_title: e.title, reporter_id: v.id, reason, note: (note ?? "").trim().slice(0, 1000),
      created_at: new Date(now()).toISOString(), status: "open",
    };
    emit();
  },

  async list() {
    requireStaff();
    return clone(Object.values(S().reports).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
  },

  async markReviewed(id) {
    requireStaff();
    const r = S().reports[id];
    if (!r) throw new Error("Report not found");
    r.status = "reviewed";
    emit();
  },
};
