/**
 * Real reports. Reporting is a signed-in function (ev_report_event). The staff list and "reviewed" are service-role only
 * in the database, so they go through the staff route /api/admin/event-reports with the desk's staff token.
 */
import type { ReportsApi } from "../api";
import type { Report } from "../types";
import { emit, reasonText, rpc } from "./core";
import { eventIdOf } from "./ids";
import { mapReport } from "./map";

/** The same key the staff desk keeps its token under (src/app/admin/page.tsx). */
const TOKEN_KEY = "hoppaz-admin-token";

function staffToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

async function desk<T>(init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const token = staffToken();
  if (!token) throw new Error("Sign in first");
  const base = process.env.EVENTS_R1_API_BASE ?? "";
  const { json, ...rest } = init;
  const res = await fetch(`${base}/api/admin/event-reports`, {
    ...rest,
    headers: { authorization: `Bearer ${token}`, ...(json !== undefined ? { "content-type": "application/json" } : {}) },
    body: json !== undefined ? JSON.stringify(json) : undefined,
    cache: "no-store",
  });
  const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
  if (res.status === 401) throw new Error("Not allowed");
  if (!res.ok || out.ok === false) throw new Error(out.message || "That did not work. Try again");
  return out as T;
}

export const reports: ReportsApi = {
  async report(eventId, reason, note) {
    const out = await rpc<string | null>("ev_report_event", { p_event: await eventIdOf(eventId), p_reason: reason, p_note: (note ?? "").trim().slice(0, 1000) });
    // Reporting the same event twice is not an error for the person: it is already in front of staff.
    if (out === "ok" || out === "already_reported") {
      emit();
      return;
    }
    throw new Error(reasonText(out));
  },

  async list() {
    const out = await desk<{ reports: Record<string, unknown>[] }>();
    return out.reports.map(mapReport) as Report[];
  },

  /** Marking a report reviewed also puts back an event the reports hid (the desk has no other way to), like the fake layer. */
  async markReviewed(id) {
    await desk({ method: "POST", json: { action: "review", id, restore: true } });
    emit();
  },
};
