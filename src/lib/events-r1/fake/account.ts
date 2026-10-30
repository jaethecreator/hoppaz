/**
 * Fake saved checkout details, per user, in the fake store (so they survive a reload like everything else here).
 * Only name, email and phone are kept: the screens never pass a host's own question answers, and this refuses nothing else.
 */
import type { AccountApi } from "../api";
import type { SavedDetails } from "../types";
import { emit, S, viewer } from "./store";
import { clone } from "./util";

const clean = (d: SavedDetails): SavedDetails => ({
  first_name: String(d.first_name ?? "").trim().slice(0, 60),
  last_name: String(d.last_name ?? "").trim().slice(0, 60),
  email: String(d.email ?? "").trim().slice(0, 200),
  phone: String(d.phone ?? "").trim().slice(0, 30),
});

export const account: AccountApi = {
  async savedDetails() {
    const v = viewer();
    if (!v) return null;
    const d = S().savedDetails[v.id];
    return d ? clone(d) : null;
  },

  async saveDetails(d) {
    const v = viewer();
    if (!v) throw new Error("Sign in first");
    const c = clean(d);
    if (!c.first_name || !c.email) throw new Error("Add your name and email");
    S().savedDetails[v.id] = c;
    emit();
  },

  async deleteSavedDetails() {
    const v = viewer();
    if (!v) throw new Error("Sign in first");
    if (!S().savedDetails[v.id]) return;
    delete S().savedDetails[v.id];
    emit();
  },
};
