"use client";

import { useEffect, useId, useState } from "react";
import { useR1Api, useR1Auth } from "@/lib/events-r1/hooks";
import type { SavedDetails } from "@/lib/events-r1/types";

/**
 * Who is paying, in the checkout sheet (design "After you pay", B4). First time: first name, last name, email and phone, tagged for the
 * phone's autofill, then one switch, "Save my details for next time", on by default. Next time: a "Paying as" card (name, email, masked
 * phone) with Edit, and Pay is one tap. Only these four are ever saved: a host's own checkout questions never are.
 *
 * The details are read from the account (api.account). When that is not available (the real function is missing) there is simply no card
 * and the fields start from the sign-in's name and email.
 */
export type Contact = {
  details: SavedDetails;
  /** Keep them on the account after this checkout. */
  save: boolean;
  /** The buyer already had saved details (the "Paying as" card, or Edit from it). */
  hadSaved: boolean;
  /** Everything needed is there. */
  complete: boolean;
};

/** sessionStorage key: the event whose checkout just saved the buyer's details for the first time ("Your details are saved" on You're going). */
export const SAVED_NOW = "hz.r1.savedNow";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const blank: SavedDetails = { first_name: "", last_name: "", email: "", phone: "" };

/** "0803 ••• 2211": the first four and last four digits. Short numbers show only the last two. */
export function maskPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  if (d.length >= 9) return `${d.slice(0, 4)} ••• ${d.slice(-4)}`;
  if (d.length >= 3) return `••• ${d.slice(-2)}`;
  return "";
}

export const fullName = (d: Pick<SavedDetails, "first_name" | "last_name">) => [d.first_name, d.last_name].map((s) => s.trim()).filter(Boolean).join(" ");

export function isComplete(d: SavedDetails): boolean {
  return !!d.first_name.trim() && !!d.last_name.trim() && EMAIL.test(d.email.trim()) && d.phone.replace(/\D/g, "").length >= 7;
}

/** The sheet's state for the block: loads saved details once per opening and keeps what the buyer types. */
export function useContact(open: boolean) {
  const api = useR1Api();
  const { user } = useR1Auth();
  const [saved, setSaved] = useState<SavedDetails | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [vals, setVals] = useState<SavedDetails>(blank);
  const [save, setSave] = useState(true);
  const [edit, setEdit] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open || !api || !user) {
      setLoaded(false);
      return;
    }
    let live = true;
    setEdit(false);
    setTried(false);
    setSave(true);
    api.account.savedDetails().then(
      (d) => {
        if (!live) return;
        setSaved(d);
        if (d) setVals(d);
        else {
          // First time: what the account knows. A made-up "Hopper" name is not a name.
          const parts = (user.name ?? "").trim().split(/\s+/).filter((x) => x && x.toLowerCase() !== "hopper");
          setVals({ first_name: parts[0] ?? "", last_name: parts.slice(1).join(" "), email: user.email ?? "", phone: "" });
        }
        setLoaded(true);
      },
      () => {
        if (!live) return;
        setSaved(null);
        setVals({ ...blank, email: user.email ?? "" });
        setLoaded(true);
      }
    );
    return () => {
      live = false;
    };
  }, [open, api, user]);

  const contact: Contact = { details: vals, save: saved ? true : save, hadSaved: !!saved, complete: isComplete(vals) };
  return { ready: loaded, saved, vals, setVals, save, setSave, edit, setEdit, card: !!saved && !edit, contact, tried, setTried };
}

export type ContactState = ReturnType<typeof useContact>;

const field =
  "!min-h-[46px] !rounded-hz !border !border-t-line !bg-t-tile !px-3 !py-[11px] font-body !text-[16px] font-medium !text-t-text outline-none focus:!border-t-accent";

export default function CheckoutContact({ c }: { c: ContactState }) {
  const uid = useId();
  const v = c.vals;
  const set = (k: keyof SavedDetails) => (e: React.ChangeEvent<HTMLInputElement>) => c.setVals((x) => ({ ...x, [k]: e.target.value }));
  const miss = (ok: boolean) => c.tried && !ok;

  if (!c.ready) return <div className="h-[72px] animate-pulse rounded-hz bg-t-tile" aria-hidden />;

  if (c.card) {
    const name = fullName(v) || "You";
    return (
      <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-hz border border-t-line bg-t-tile p-3" data-paying-as>
        <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full bg-t-soft font-display text-[15px] font-extrabold text-t-text">
          {name[0]?.toUpperCase()}
        </span>
        <div className="min-w-0">
          <span className="mb-0.5 block font-mono text-[11px] uppercase tracking-[0.06em] text-t-muted">Paying as</span>
          <b className="block truncate font-body text-[14.5px]">{name}</b>
          <small className="block truncate font-body text-[13px] text-t-muted">{[v.email, maskPhone(v.phone)].filter(Boolean).join(" · ")}</small>
        </div>
        <button
          type="button"
          onClick={() => c.setEdit(true)}
          className="inline-flex min-h-[44px] items-center font-body text-[14px] font-bold text-t-accent underline underline-offset-[3px]"
          aria-label="Edit your details"
        >
          Edit
        </button>
      </div>
    );
  }

  const label = "grid gap-1 font-body text-[12px] font-semibold text-t-muted";
  const err = "font-body text-[12px] font-semibold text-[#E5484D]";
  return (
    <div className="grid gap-3" data-contact-fields>
      <div className="grid grid-cols-2 gap-2">
        <label className={label} htmlFor={`${uid}-fn`}>
          First name
          <input id={`${uid}-fn`} type="text" name="given-name" autoComplete="given-name" placeholder="Tolu" value={v.first_name} onChange={set("first_name")} aria-invalid={miss(!!v.first_name.trim())} className={field} />
        </label>
        <label className={label} htmlFor={`${uid}-ln`}>
          Last name
          <input id={`${uid}-ln`} type="text" name="family-name" autoComplete="family-name" placeholder="Adeyemi" value={v.last_name} onChange={set("last_name")} aria-invalid={miss(!!v.last_name.trim())} className={field} />
        </label>
      </div>
      <label className={label} htmlFor={`${uid}-em`}>
        Email for your tickets
        <input id={`${uid}-em`} type="email" name="email" autoComplete="email" inputMode="email" placeholder="you@example.com" value={v.email} onChange={set("email")} aria-invalid={miss(EMAIL.test(v.email.trim()))} className={field} />
      </label>
      <label className={label} htmlFor={`${uid}-ph`}>
        Phone number
        <input id={`${uid}-ph`} type="tel" name="tel" autoComplete="tel" inputMode="tel" placeholder="0803 000 0000" value={v.phone} onChange={set("phone")} aria-invalid={miss(v.phone.replace(/\D/g, "").length >= 7)} className={field} />
      </label>
      {c.tried && !c.contact.complete && (
        <p role="alert" className={err}>
          Add your first and last name, an email and a phone number.
        </p>
      )}
      {!c.saved && (
        <label htmlFor={`${uid}-sv`} className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-hz border border-t-line bg-t-tile px-3 py-2.5">
          <span>
            <b className="block font-body text-[14px]">Save my details for next time</b>
            <small className="block font-body text-[12px] text-t-muted">Name, email and phone, kept on your Hoppaz account. Turn it off if you&apos;d rather not.</small>
          </span>
          <span className="relative h-7 w-[46px] flex-none">
            <input
              id={`${uid}-sv`}
              type="checkbox"
              role="switch"
              checked={c.save}
              onChange={(e) => c.setSave(e.target.checked)}
              className="peer absolute inset-0 z-10 !m-0 !h-full !w-full cursor-pointer !p-0 opacity-0"
            />
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-t-line transition-colors peer-checked:bg-t-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-t-text motion-reduce:transition-none after:absolute after:left-[3px] after:top-[3px] after:h-[22px] after:w-[22px] after:rounded-full after:bg-t-solid after:shadow-[0_1px_3px_rgba(0,0,0,.3)] after:transition-transform after:content-[''] peer-checked:after:translate-x-[18px] motion-reduce:after:transition-none"
            />
          </span>
        </label>
      )}
    </div>
  );
}
