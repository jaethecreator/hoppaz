/**
 * Real sign-in: an email and a six digit code, or Google. A person on the app's guest session keeps their progress: the
 * email is added to that same user (updateUser, confirmed with the "email_change" code). Someone with no session, or an
 * email that already has an account, signs in with a magic-link code ("email" code) instead.
 */
import type { AuthApi } from "../api";
import type { AuthUser } from "../types";
import { client, emit, isAnonymous, ready, setMyName, watchSession, who } from "./core";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Which kind of code is out for this email: the verify step must name it. */
let pending: { email: string; type: "email" | "email_change" } | null = null;

const clean = (email: string) => email.trim().toLowerCase();

/** The sign-in errors people can act on, in plain words. */
function authText(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("expired") || m.includes("invalid")) return "That code did not work. Check it, or ask for a new one.";
  if (m.includes("rate limit") || m.includes("too many") || m.includes("seconds")) return "Wait a minute, then ask for a new code.";
  if (m.includes("fetch") || m.includes("network")) return "No connection. Try again";
  return "That did not work. Try again";
}

export const auth: AuthApi = {
  current() {
    return who();
  },

  async sendCode(email) {
    const e = clean(email);
    if (!EMAIL.test(e)) throw new Error("Enter a valid email");
    watchSession();
    await ready();
    const sb = client();
    if (isAnonymous()) {
      // A guest becomes this email, keeping everything they did as a guest. An email with an account already is a log in.
      const { error } = await sb.auth.updateUser({ email: e });
      if (!error) {
        pending = { email: e, type: "email_change" };
        return;
      }
      if (!/already|registered|exists|taken/i.test(error.message)) throw new Error(authText(error.message));
    }
    const { error } = await sb.auth.signInWithOtp({ email: e, options: { shouldCreateUser: true } });
    if (error) throw new Error(authText(error.message));
    pending = { email: e, type: "email" };
  },

  async verifyCode(email, code, name) {
    const digits = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(digits)) throw new Error("Enter the 6 digit code");
    const e = clean(email);
    if (!EMAIL.test(e)) throw new Error("Enter a valid email");
    watchSession();
    await ready();
    const sb = client();
    const type = pending && pending.email === e ? pending.type : isAnonymous() ? "email_change" : "email";
    let { data, error } = await sb.auth.verifyOtp({ email: e, token: digits, type });
    // A page that was reloaded between the two steps has forgotten which code it sent: try the other kind once.
    if (error && !(pending && pending.email === e)) {
      const other = await sb.auth.verifyOtp({ email: e, token: digits, type: type === "email" ? "email_change" : "email" });
      if (!other.error) ({ data, error } = other);
    }
    if (error || !data.user) throw new Error(authText(error?.message ?? ""));
    pending = null;
    const id = data.user.id;
    const given = (name ?? "").trim();
    if (given) {
      // The name goes to the profile, like the app's own sign-up and the Google callback.
      const { error: nameError } = await sb.from("profiles").update({ display_name: given.slice(0, 24) }).eq("id", id);
      if (!nameError) setMyName(given.slice(0, 24));
    }
    await ready();
    emit();
    const user = who();
    if (!user) throw new Error("That did not work. Try again");
    return user;
  },

  async google(): Promise<AuthUser> {
    watchSession();
    await ready();
    // The existing Google flow (links the guest so their progress stays). The page leaves for Google and comes back signed in.
    const { continueWithGoogle } = await import("../../account");
    const back = typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;
    const problem = await continueWithGoogle(back, true);
    if (problem) throw new Error(problem);
    return new Promise<AuthUser>((_resolve, reject) => {
      setTimeout(() => reject(new Error("Google sign-in did not start. Try again")), 15_000);
    });
  },

  async signOut() {
    const sb = client();
    await sb.auth.signOut();
    pending = null;
    emit();
  },
};
