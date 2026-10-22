/** Fake sign-in: no email is sent. Any six digits are the right code. Google signs in as Ada Obi. */
import type { AuthApi } from "../api";
import type { AuthUser } from "../types";
import { emit, S, toAuthUser, viewer } from "./store";
import type { UserRec } from "./store";
import { newId, seedId } from "./util";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** "ada.obi@gmail.com" -> "Ada Obi" */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0].replace(/[0-9]+/g, " ").replace(/[._-]+/g, " ").trim();
  return (
    local
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ") || "Hopper"
  );
}

export function signInUser(u: UserRec): AuthUser {
  S().viewerId = u.id;
  S().pendingEmail = null;
  emit();
  return toAuthUser(u);
}

export const auth: AuthApi = {
  current() {
    const v = viewer();
    return v ? toAuthUser(v) : null;
  },

  async sendCode(email) {
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e)) throw new Error("Enter a valid email");
    S().pendingEmail = e;
    emit();
  },

  async verifyCode(email, code, name) {
    if (!/^\d{6}$/.test(code.replace(/\s/g, ""))) throw new Error("Enter the 6 digit code");
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e)) throw new Error("Enter a valid email");
    let u = Object.values(S().users).find((x) => x.email.toLowerCase() === e);
    if (!u) {
      u = { id: newId(), name: (name ?? "").trim() || nameFromEmail(e), email: e };
      S().users[u.id] = u;
    }
    return signInUser(u);
  },

  async google() {
    const u = S().users[seedId("user:ada")];
    return signInUser(u);
  },

  async signOut() {
    S().viewerId = null;
    S().pendingEmail = null;
    emit();
  },
};
