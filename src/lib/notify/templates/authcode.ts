import { oneLine, siteBase } from "./format";
import { renderHtml, renderText, type Doc } from "./layout";
import type { RenderedEmail } from "./index";

/**
 * The account emails Supabase Auth hands to the Send Email Hook (src/lib/notify/authhook.ts), in the design of
 * supabase/email-templates/confirm-signup.html on main: the six digit code big in the orange block, a code and never a link. The app
 * signs people in by typing the code (src/lib/events-r1/real/auth.ts), so a code email must not carry the ConfirmationURL link: the
 * link would sign them in on whatever device opens the mail, and the code in the app would sit unused.
 *
 * These are not in BUILDERS (copy.ts): the queue never sends them. A code is sent directly and at once, and never stored.
 *
 * One variant for each thing Supabase can ask for (https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook, email_action_type):
 *   sign_in         magiclink, email      a code
 *   sign_up         signup                a code, the welcome wording of Ola's confirm-signup
 *   email_change    email_change          a code to the new address; with Secure email change on, a second code to the current address
 *   reauth          reauthentication      a code
 *   code_other      anything new that arrives with a code
 *   invite          invite                the one link: an invite is accepted from the mail (Ola's invite-user.html does the same)
 *   recovery        recovery              no code and no link: Hoppaz has no password to reset, so it says how to get in
 *   the "_notification" kinds              short security notices with no code and no link
 */

export type AuthVariant =
  | "sign_in"
  | "sign_up"
  | "email_change_new"
  | "email_change_current"
  | "reauth"
  | "code_other"
  | "invite"
  | "recovery"
  | "password_changed"
  | "email_changed"
  | "phone_changed"
  | "identity_linked"
  | "identity_unlinked"
  | "mfa_enrolled"
  | "mfa_unenrolled";

/** What the planner (authhook.ts) decided to send. Everything here is already checked; nothing is read from the request again. */
export type AuthMail = {
  variant: AuthVariant;
  /** Supabase's email_action_type, kept for the send log. */
  action: string;
  to: string;
  /** The six digits. Set for every code variant, never for the others. */
  code?: string;
  /** Set for invite only: the Supabase verify link. */
  link?: string;
  /** First name, for the welcome line. */
  name?: string;
  /** email_change_current: the address the change is to (shown masked). */
  newEmail?: string;
  /** identity_linked, identity_unlinked: "google". mfa_*: the factor type. */
  provider?: string;
};

export const CODE_VARIANTS: readonly AuthVariant[] = ["sign_in", "sign_up", "email_change_new", "email_change_current", "reauth", "code_other"];
export const isCodeVariant = (v: AuthVariant): boolean => CODE_VARIANTS.includes(v);

/** How long a code lasts: Supabase's Email OTP Expiration (Authentication > Providers > Email) must stay at 3600 for these words to be true. */
const HOURS = "It works for one hour. Never share it: Hoppaz will never ask you for it.";

const CODE_NOT_YOU = "Not you? Ignore this email and nothing happens.";

/** a***@example.com, the same masking as the logs. Used where an address is shown to someone who is not the owner of that address. */
function mask(address: string): string {
  const at = address.lastIndexOf("@");
  return at < 1 ? "that address" : `${address[0]}***${address.slice(at)}`;
}

const word = (v: string | undefined, fallback: string) => {
  const s = oneLine(v ?? "", 40).replace(/[_-]+/g, " ").trim();
  return s ? s : fallback;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Built = { subject: string; doc: Doc };

function codeDoc(m: AuthMail, o: { eyebrow: string; headline: string; paragraphs: string[]; reason: string }): Built {
  const code = m.code ?? "";
  return {
    subject: `Your Hoppaz code is ${code}`,
    doc: {
      preheader: `Your code is ${code}. Type it into Hoppaz and you're on the bus.`,
      eyebrow: o.eyebrow,
      headline: o.headline,
      paragraphs: o.paragraphs,
      code: { value: code, note: HOURS },
      reason: o.reason,
      unsubscribeUrl: null,
    },
  };
}

function notice(subject: string, headline: string, paragraphs: string[]): Built {
  return {
    subject,
    doc: {
      preheader: headline,
      eyebrow: "Account security",
      headline,
      paragraphs: [...paragraphs, "If this was not you, reply to this email and we will help you secure your account."],
      reason: "You are getting this because of a change on your Hoppaz account.",
      unsubscribeUrl: null,
    },
  };
}

function build(m: AuthMail, site: string): Built {
  switch (m.variant) {
    case "sign_in":
      return codeDoc(m, {
        eyebrow: "Your sign-in code",
        headline: "Six digits and you're on the bus.",
        paragraphs: ["Type this code into Hoppaz to sign in."],
        reason: `You got this because someone asked to sign in to Hoppaz with this email. ${CODE_NOT_YOU}`,
      });
    case "sign_up": {
      const name = oneLine(m.name ?? "", 40);
      return codeDoc(m, {
        eyebrow: "Your sign-in code",
        headline: "Six digits and you're on the bus.",
        paragraphs: [
          `${name ? `Hey ${name}, welcome` : "Welcome"} to Hoppaz. Type this code into Hoppaz to confirm your email, so we can keep your WE OUTSIDE list, your crews and your rewards safe.`,
        ],
        reason: `You got this because someone signed up to Hoppaz with this email. ${CODE_NOT_YOU}`,
      });
    }
    case "email_change_new":
      return codeDoc(m, {
        eyebrow: "Save this email",
        headline: "Almost in.",
        paragraphs: ["Type this code into Hoppaz to save this email to your account. Everything you have done on Hoppaz stays with you."],
        reason: "You got this because someone asked to add this email to a Hoppaz account. Not you? Ignore this email and nothing changes.",
      });
    case "email_change_current":
      return codeDoc(m, {
        eyebrow: "Change your email",
        headline: "Confirm the change.",
        paragraphs: [
          `Someone asked to change the email on your Hoppaz account to ${mask(m.newEmail ?? "")}. If that was you, type this code into Hoppaz.`,
          "A second code goes to the new address. Hoppaz needs both.",
        ],
        reason: "You got this because of a change on your Hoppaz account. If it was not you, ignore this email and nothing changes.",
      });
    case "reauth":
      return codeDoc(m, {
        eyebrow: "Confirm it's you",
        headline: "One more check.",
        paragraphs: ["Type this code into Hoppaz to confirm a change to your account."],
        reason: "You got this because you are changing something on your Hoppaz account. Not you? Ignore this email and nothing changes.",
      });
    case "code_other":
      return codeDoc(m, {
        eyebrow: "Your code",
        headline: "Here's your code.",
        paragraphs: ["Type this code into Hoppaz to carry on."],
        reason: `You got this because of a request on your Hoppaz account. ${CODE_NOT_YOU}`,
      });
    case "invite":
      return {
        subject: "You're invited to Hoppaz",
        doc: {
          preheader: "There's a seat for you on the bus. Accept the invite to make your account.",
          eyebrow: "You're invited",
          headline: "There's a seat for you on the bus.",
          paragraphs: [
            "You've been invited to Hoppaz: every party, rave and night out in Lagos in one deck. Swipe what you like, see who's going, join the crews and earn rewards for showing up.",
            "Accept the invite to make your account. It takes a minute.",
          ],
          button: m.link ? { label: "Accept the invite", url: m.link } : undefined,
          reason: "This invite was sent to you by Hoppaz. Weren't expecting it? Ignore this email and no account is made.",
          unsubscribeUrl: null,
        },
      };
    case "recovery":
      return {
        subject: "Signing in to Hoppaz",
        doc: {
          preheader: "Hoppaz has no password to reset. Here is how to get in.",
          eyebrow: "Password reset",
          headline: "No password needed.",
          paragraphs: [
            "Someone asked to reset the password for this Hoppaz account. Hoppaz signs you in with a six digit code sent to your email, so there is no password to reset.",
            "To get in, open Hoppaz, enter this email and ask for a sign-in code.",
          ],
          button: { label: "Open Hoppaz", url: site },
          reason: "You got this because someone asked to reset the password on this account. Not you? Ignore this email and nothing changes.",
          unsubscribeUrl: null,
        },
      };
    case "password_changed":
      return notice("Your Hoppaz password was changed", "Your password was changed.", ["The password on your Hoppaz account was just changed."]);
    case "email_changed":
      return notice("The email on your Hoppaz account was changed", "Your email was changed.", [
        "The email on your Hoppaz account was just changed. Hoppaz now sends your codes to the new address.",
      ]);
    case "phone_changed":
      return notice("The phone on your Hoppaz account was changed", "Your phone number was changed.", ["The phone number on your Hoppaz account was just changed."]);
    case "identity_linked":
      return notice(`${cap(word(m.provider, "A new"))} sign-in was added to Hoppaz`, "A new way to sign in was added.", [
        `${cap(word(m.provider, "Another sign-in method"))} can now be used to sign in to your Hoppaz account.`,
      ]);
    case "identity_unlinked":
      return notice(`${cap(word(m.provider, "A"))} sign-in was removed from Hoppaz`, "A way to sign in was removed.", [
        `${cap(word(m.provider, "A sign-in method"))} can no longer be used to sign in to your Hoppaz account.`,
      ]);
    case "mfa_enrolled":
      return notice("A new security step was added to your Hoppaz account", "A security step was added.", [
        `A new ${word(m.provider, "extra")} security step was added to your Hoppaz account.`,
      ]);
    case "mfa_unenrolled":
      return notice("A security step was removed from your Hoppaz account", "A security step was removed.", [
        `A ${word(m.provider, "extra")} security step was removed from your Hoppaz account.`,
      ]);
  }
}

export type AuthRenderOptions = { site?: string };

/** The finished email. Throws if a code variant has no code or an invite has no link, so a blank mail is never sent. */
export function renderAuthEmail(m: AuthMail, opts: AuthRenderOptions = {}): RenderedEmail {
  if (isCodeVariant(m.variant) && !/^\d{6}$/.test(m.code ?? "")) throw new Error(`no six digit code for ${m.variant}`);
  if (m.variant === "invite" && !m.link) throw new Error("no link for invite");
  const site = siteBase(opts.site);
  const built = build(m, site);
  const ctx = { site, to: oneLine(m.to, 320) };
  return { subject: built.subject, html: renderHtml(built.doc, ctx), text: renderText(built.doc, ctx), headers: {} };
}

/** Made-up samples of each variant for /dev/emails and the checks. The codes are obviously fake. */
export type AuthSample = { label: string; kind: string; mail: AuthMail };

const to = "ada@example.com";
export const AUTH_SAMPLES: AuthSample[] = [
  { label: "Sign-in code", kind: "auth:magiclink", mail: { variant: "sign_in", action: "magiclink", to, code: "482913" } },
  { label: "Sign-up code (new person)", kind: "auth:signup", mail: { variant: "sign_up", action: "signup", to, code: "507316", name: "Ada" } },
  { label: "Email change code (new address)", kind: "auth:email_change", mail: { variant: "email_change_new", action: "email_change", to, code: "731605" } },
  { label: "Email change code (current address, Secure email change)", kind: "auth:email_change", mail: { variant: "email_change_current", action: "email_change", to: "ada.old@example.com", code: "264058", newEmail: to } },
  { label: "Reauthentication code", kind: "auth:reauthentication", mail: { variant: "reauth", action: "reauthentication", to, code: "918270" } },
  { label: "Invite (the one link)", kind: "auth:invite", mail: { variant: "invite", action: "invite", to, link: "https://example.supabase.co/auth/v1/verify?token=sample-not-real&type=invite&redirect_to=https%3A%2F%2Fhoppaz.fun" } },
  { label: "Password reset asked (no password here)", kind: "auth:recovery", mail: { variant: "recovery", action: "recovery", to } },
  { label: "Notice: password changed", kind: "auth:password_changed_notification", mail: { variant: "password_changed", action: "password_changed_notification", to } },
  { label: "Notice: email changed", kind: "auth:email_changed_notification", mail: { variant: "email_changed", action: "email_changed_notification", to } },
  { label: "Notice: phone changed", kind: "auth:phone_changed_notification", mail: { variant: "phone_changed", action: "phone_changed_notification", to } },
  { label: "Notice: Google sign-in added", kind: "auth:identity_linked_notification", mail: { variant: "identity_linked", action: "identity_linked_notification", to, provider: "google" } },
  { label: "Notice: Google sign-in removed", kind: "auth:identity_unlinked_notification", mail: { variant: "identity_unlinked", action: "identity_unlinked_notification", to, provider: "google" } },
  { label: "Notice: security step added", kind: "auth:mfa_factor_enrolled_notification", mail: { variant: "mfa_enrolled", action: "mfa_factor_enrolled_notification", to, provider: "totp" } },
  { label: "Notice: security step removed", kind: "auth:mfa_factor_unenrolled_notification", mail: { variant: "mfa_unenrolled", action: "mfa_factor_unenrolled_notification", to, provider: "totp" } },
  { label: "Awkward name (escaping)", kind: "auth:signup", mail: { variant: "sign_up", action: "signup", to, code: "100200", name: `<script>alert(1)</script> & "Ada"` } },
];

export function renderAuthSamples(opts: AuthRenderOptions = {}) {
  return AUTH_SAMPLES.map((s) => ({ label: s.label, kind: s.kind, to: s.mail.to, email: renderAuthEmail(s.mail, opts) }));
}
