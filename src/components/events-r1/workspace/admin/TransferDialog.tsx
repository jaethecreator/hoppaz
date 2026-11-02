"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { copyText } from "@/components/events-r1/page/share";
import { useDialogFocus } from "@/components/events-r1/signin/useDialogFocus";
import { looksLikeEmail } from "@/components/events-r1/signin/helpers";
import { dayLagos, reasonText } from "@/components/events-r1/claim/words";
import { useR1Api } from "@/lib/events-r1/hooks";
import type {
  RoomSummary,
  Transfer,
  TransferStatus,
} from "@/lib/events-r1/types";
import { Err, useFlashLine } from "./ui";

const STATUS: Record<TransferStatus, string> = {
  pending: "Open",
  accepted: "Accepted",
  revoked: "Cancelled",
  expired: "Expired",
};

/** Open means pending and not past its date (the data layer may not have flipped it to expired yet). */
export const isOpen = (t: Transfer, now: number) =>
  t.status === "pending" && Date.parse(t.expires_at) > now;

/**
 * Owner only: hand the room to someone else. Type their email, get a link, send it yourself. They sign in with that exact email and
 * accept; you stay owner until they do. Below: every link made for this room, with Revoke on the open ones.
 */
export default function TransferDialog({
  room,
  transfers,
  now,
  onChanged,
  onClose,
}: {
  room: RoomSummary;
  transfers: Transfer[];
  now: number;
  onChanged: () => Promise<void> | void;
  onClose: () => void;
}) {
  const api = useR1Api();
  const box = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState<{ url: string; to: string } | null>(null);
  const [said, say] = useFlashLine();
  // Drawn into the page body so it sits above the tab bar; it wears the page's tint by taking over the shell's colour variables.
  const anchor = useRef<HTMLSpanElement>(null);
  const [vars, setVars] = useState<CSSProperties | null>(null);
  useEffect(() => {
    const shell = anchor.current?.closest<HTMLElement>(".tint-ui");
    const v: Record<string, string> = {};
    if (shell)
      for (let i = 0; i < shell.style.length; i++)
        if (shell.style[i].startsWith("--"))
          v[shell.style[i]] = shell.style.getPropertyValue(shell.style[i]);
    setVars(v as CSSProperties);
  }, []);

  useDialogFocus(true, box, onClose);
  useEffect(() => {
    if (vars) emailRef.current?.focus({ preventScroll: true });
  }, [vars]);

  const clean = email.trim();
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!api || busy) return;
    if (!looksLikeEmail(clean)) return setError(reasonText("bad_email"));
    setBusy(true);
    setError("");
    try {
      const made = await api.claims.startHandover(room.id, clean);
      setLink({ url: made.link, to: made.transfer.to_email });
      setEmail("");
      await onChanged();
    } catch (err) {
      setError(reasonText(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    say(
      (await copyText(link.url))
        ? "Link copied"
        : "Could not copy. Select it and copy by hand",
    );
  };

  const revoke = async (t: Transfer) => {
    if (!api) return;
    setError("");
    try {
      await api.claims.revoke(t.id);
      if (link && t.to_email === link.to) setLink(null);
      await onChanged();
    } catch (err) {
      setError(reasonText(err));
    }
  };

  return (
    <>
      <span ref={anchor} hidden />
      {vars &&
        createPortal(
          <div
            className="tint-ui fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4"
            style={{ ...vars, background: "rgba(0,0,0,0.6)" }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) onClose();
            }}
          >
            <div
              ref={box}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="relative max-h-[94dvh] w-full max-w-[460px] overflow-y-auto rounded-t-[12px] border border-b-0 border-t-line bg-t-solid px-4 pt-5 text-t-text shadow-xl sm:rounded-hz sm:border-b sm:px-6 sm:pb-6"
              style={{
                paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
              }}
            >
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute right-1.5 top-1.5 grid h-11 w-11 place-items-center text-t-muted"
              >
                <X size={20} aria-hidden />
              </button>
              <h2
                id={titleId}
                className="t-title pr-10 text-[20px] font-extrabold leading-tight"
              >
                Transfer ownership
              </h2>
              <p className="mt-1.5 font-body text-[14px] text-t-muted">
                Give {room.name} to someone else. They open the link, sign in
                with the exact email you type here and accept. You stay owner
                until they do. It will not go through while the room has paid
                sales.
              </p>

              <form
                onSubmit={(e) => void create(e)}
                className="mt-4 flex flex-col gap-2"
                noValidate
              >
                <label
                  className="font-body text-[13px] text-t-muted"
                  htmlFor={`${titleId}-email`}
                >
                  Their email
                </label>
                <input
                  ref={emailRef}
                  id={`${titleId}-email`}
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError("");
                  }}
                  autoComplete="off"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="name@email.com"
                />
                <button
                  type="submit"
                  className="lip mt-1 w-full"
                  disabled={busy || !api || !clean}
                >
                  {busy ? "Creating" : "Create link"}
                </button>
              </form>
              <Err>{error}</Err>

              {link && (
                <div
                  className="mt-4 rounded-hz border border-t-line bg-t-tile p-3"
                  data-transfer-link
                >
                  <p className="font-body text-[13px] text-t-muted">
                    Link for {link.to}. It shows once, so copy it now and send
                    it to them yourself.
                  </p>
                  <div className="mt-2 flex items-stretch gap-2">
                    <input
                      readOnly
                      value={link.url}
                      aria-label="Transfer link"
                      onFocus={(e) => e.currentTarget.select()}
                      className="min-w-0 flex-1 !font-mono !text-[13px]"
                    />
                    <button
                      type="button"
                      className="lip-ghost flex-none !px-4"
                      onClick={() => void copy()}
                    >
                      Copy link
                    </button>
                  </div>
                  <p
                    className="mt-2 h-4 font-body text-[13px] font-bold text-t-muted"
                    aria-live="polite"
                  >
                    {said}
                  </p>
                </div>
              )}

              {transfers.length > 0 && (
                <div className="mt-5" data-transfer-list>
                  <h3 className="font-body text-[14px] font-extrabold">
                    Transfers for this room
                  </h3>
                  <ul className="mt-2 flex flex-col divide-y divide-t-line">
                    {transfers.map((t) => {
                      const open = isOpen(t, now);
                      const word =
                        t.status === "pending" && !open
                          ? STATUS.expired
                          : STATUS[t.status];
                      return (
                        <li
                          key={t.id}
                          className="flex items-center gap-3 py-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-body text-[14.5px] font-bold">
                              {t.to_email}
                            </p>
                            <p className="font-body text-[13px] text-t-muted">
                              {word}
                              {open
                                ? `, expires ${dayLagos(t.expires_at)}`
                                : t.accepted_at
                                  ? ` ${dayLagos(t.accepted_at)}`
                                  : ` · made ${dayLagos(t.created_at)}`}
                            </p>
                          </div>
                          {open && (
                            <button
                              type="button"
                              className="lip-ghost flex-none"
                              onClick={() => void revoke(t)}
                              aria-label={`Revoke the link for ${t.to_email}`}
                            >
                              Revoke
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
