/**
 * Saved checkout details on the real side: supabase/events_r1_saved_details.sql (a draft for Ola). Until that file is run every call
 * degrades quietly: nothing is saved, nothing is read, and checkout simply asks for the details each time.
 */
import type { AccountApi } from "../api";
import type { SavedDetails } from "../types";
import { emit, failText, who } from "./core";
import { soft } from "./roomProfile";

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export const account: AccountApi = {
  async savedDetails() {
    if (!who()) return null;
    const r = await soft<Row | null>("ev_saved_details");
    if (r.missing || r.error || !r.data) return null;
    const d: SavedDetails = { first_name: str(r.data.first_name), last_name: str(r.data.last_name), email: str(r.data.email), phone: str(r.data.phone) };
    return d.first_name || d.email ? d : null;
  },

  async saveDetails(d) {
    if (!who()) throw new Error("Sign in first");
    const r = await soft<string>("ev_save_details", {
      p_first: d.first_name.trim(), p_last: d.last_name.trim(), p_email: d.email.trim(), p_phone: d.phone.trim(),
    });
    if (r.missing) return;
    if (r.error) throw new Error(failText(r.error));
    if (r.data === "not_open" || r.data === "need_account") return;
    if (r.data === "bad_details") throw new Error("Add your name and email");
    if (r.data !== "ok") throw new Error(failText(String(r.data)));
    emit();
  },

  async deleteSavedDetails() {
    if (!who()) throw new Error("Sign in first");
    const r = await soft<string>("ev_delete_saved_details");
    if (r.missing) return;
    if (r.error) throw new Error(failText(r.error));
    emit();
  },
};
