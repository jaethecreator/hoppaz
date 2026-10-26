"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { useR1Api } from "@/lib/events-r1/hooks";
import { useDialogFocus } from "../signin/useDialogFocus";
import { hostPayError } from "./words";

/**
 * Get paid: the host's bank details, inside Hoppaz. Hoppaz collects every payment, so a host only receives money: Bachs needs their name,
 * date of birth, address and a bank account, nothing else (no ID, no BVN). The account number is checked with the bank as it is typed,
 * so the host sees the name on it before saving. A bottom sheet on a phone, a centred card on a wide screen, like SignInSheet.
 */
const STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
  "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun",
  "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
];

const field = "mb-1.5 block font-body text-[13px] text-dim";
const btn = "btn w-full text-[15px] font-bold normal-case tracking-normal";

export default function PayoutSetupSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (saved: { ready: boolean; bank_label: string }) => void }) {
  const api = useR1Api();
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [banks, setBanks] = useState<{ name: string; code: string }[]>([]);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [dob, setDob] = useState("");
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("Lagos");
  const [bank, setBank] = useState("");
  const [number, setNumber] = useState("");
  const [holder, setHolder] = useState<{ name: string } | { error: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const show = open && mounted;

  useEffect(() => setMounted(true), []);
  useDialogFocus(show, box, onClose);

  useEffect(() => {
    if (!open || !api || banks.length) return;
    api.pay
      .banks()
      .then(setBanks)
      .catch((e) => setError(hostPayError(e)));
  }, [open, api, banks.length]);

  // The name on the account, as soon as the bank and all ten digits are in.
  useEffect(() => {
    setHolder(null);
    if (!api || !bank || !/^\d{10}$/.test(number)) return;
    let live = true;
    setChecking(true);
    api.pay
      .checkAccount(bank, number)
      .then((r) => live && setHolder({ name: r.account_name }))
      .catch((e) => live && setHolder({ error: hostPayError(e) }))
      .finally(() => live && setChecking(false));
    return () => {
      live = false;
    };
  }, [api, bank, number]);

  if (!show) return null;

  const ready = !!first.trim() && !!last.trim() && !!dob && !!line1.trim() && !!city.trim() && !!state && !!holder && "name" in holder;

  const save = async () => {
    if (!api || busy || !ready) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api.pay.setupPayout({ firstName: first, lastName: last, dob, line1, city, state, bankCode: bank, accountNumber: number });
      onSaved(saved);
    } catch (e) {
      setError(hostPayError(e));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[94dvh] w-full max-w-[420px] animate-rise overflow-y-auto rounded-t-[12px] border border-b-0 border-line bg-ink-2 px-4 pt-3 text-cream shadow-sheet sm:animate-none sm:rounded-hz sm:border-b"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" />
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-2 top-2 grid h-11 w-11 place-items-center text-dim">
          <X size={18} aria-hidden />
        </button>
        <h2 id={titleId} className="pr-10 font-display text-[20px] font-black leading-tight">
          Get paid
        </h2>
        <p className="mt-1 font-body text-[14px] text-dim">Where your ticket money goes. Use your own details, as they are on your bank account.</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block min-w-0">
            <span className={field}>First name</span>
            <input value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="given-name" maxLength={50} />
          </label>
          <label className="block min-w-0">
            <span className={field}>Last name</span>
            <input value={last} onChange={(e) => setLast(e.target.value)} autoComplete="family-name" maxLength={50} />
          </label>
        </div>
        <label className="mt-3 block">
          <span className={field}>Date of birth</span>
          <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} autoComplete="bday" />
        </label>
        <label className="mt-3 block">
          <span className={field}>Home address</span>
          <input value={line1} onChange={(e) => setLine1(e.target.value)} autoComplete="street-address" maxLength={120} placeholder="Street and number" />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block min-w-0">
            <span className={field}>City</span>
            <input value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" maxLength={60} />
          </label>
          <label className="block min-w-0">
            <span className={field}>State</span>
            <select value={state} onChange={(e) => setState(e.target.value)} autoComplete="address-level1">
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-4 block">
          <span className={field}>Bank</span>
          <select value={bank} onChange={(e) => setBank(e.target.value)}>
            <option value="">{banks.length ? "Pick your bank" : "Loading banks"}</option>
            {banks.map((b) => (
              <option key={`${b.code}-${b.name}`} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block">
          <span className={field}>Account number</span>
          <input value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" autoComplete="off" placeholder="10 digits" />
        </label>
        <p className="mt-1.5 min-h-[20px] font-body text-[13px]" aria-live="polite">
          {checking && <span className="text-dim">Checking with your bank</span>}
          {!checking && holder && "name" in holder && (
            <span className="flex items-center gap-1.5 text-cream">
              <Check size={14} strokeWidth={3} className="text-keke" aria-hidden /> {holder.name}
            </span>
          )}
          {!checking && holder && "error" in holder && <span className="text-fireant">{holder.error}</span>}
        </p>

        <button type="button" onClick={() => void save()} disabled={!ready || busy || !api} className={`${btn} mt-3`}>
          {busy ? "Saving" : "Save"}
        </button>
        {error && (
          <p role="alert" className="mt-2 font-body text-[14px] text-fireant">
            {error}
          </p>
        )}
        <p className="mt-3 font-body text-[12px] leading-snug text-dim">Kept by Bachs, our payment partner. No ID or BVN needed.</p>
      </div>
    </div>,
    document.body
  );
}
