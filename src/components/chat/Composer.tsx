"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ImagePlus, X } from "lucide-react";
import { MAX_TAGS, countTags, encodeTags, type Mentionable } from "@/lib/mentions";

/**
 * The message box for rooms and DMs: text, an optional picture, send.
 * onSend returns an error line (shown by the caller) or null when sent.
 * `safeArea` pads for the phone's home bar: leave it on where no tab bar sits
 * underneath (a private chat), turn it off where one does (the tab bar pads itself).
 *
 * `mentionables` (a hotspot room: the aliases in the room) turns on tags: typing "@" lists up to 5 matching aliases, a tap
 * writes "@alias ", at most 3 tags per message, and on send each one becomes its token (src/lib/mentions.ts). Without it
 * nothing about the box changes.
 */
export default function Composer({
  placeholder,
  maxLength,
  onSend,
  safeArea = true,
  images = true,
  mentionables,
}: {
  placeholder: string;
  maxLength: number;
  onSend: (body: string, image: File | null) => Promise<string | null>;
  safeArea?: boolean;
  /** False for a text-only room (a hotspot): no picture button. */
  images?: boolean;
  /** The aliases that can be tagged here. Leave it out and "@" is just a character. */
  mentionables?: Mentionable[];
}) {
  const [body, setBody] = useState("");
  const [caret, setCaret] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!image) return setPreview(null);
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = body.trim();
    const text = mentionables?.length ? encodeTags(typed, mentionables) : typed;
    if ((!text && !image) || sending) return;
    setSending(true);
    const error = await onSend(text, image);
    setSending(false);
    if (!error) {
      setBody("");
      setImage(null);
    }
  };

  // "@" plus up to 24 letters right before the caret, at the start or after a space: offer the aliases that match.
  const open = mentionables?.length ? /(^|\s)@([^@\n]{0,24})$/.exec(body.slice(0, caret)) : null;
  const room = mentionables ? countTags(body, mentionables) < MAX_TAGS : false;
  const matches =
    open && room && mentionables
      ? mentionables.filter((m) => m.alias.toLowerCase().includes(open[2].trim().toLowerCase())).slice(0, 5)
      : [];
  const pick = (alias: string) => {
    if (!open) return;
    const at = caret - open[2].length - 1;
    const next = `${body.slice(0, at)}@${alias} ${body.slice(caret)}`;
    const pos = at + alias.length + 2;
    setBody(next);
    setCaret(pos);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(pos, pos);
    });
  };

  return (
    <form onSubmit={submit} className={clsx("relative flex flex-none flex-col gap-2 border-t border-line pt-2.5", safeArea ? "pad-bottom" : "pb-3")}>
      {matches.length > 0 && (
        <ul role="listbox" aria-label="Tag someone" className="absolute inset-x-0 bottom-full z-10 mb-1 divide-y divide-line overflow-hidden rounded-hz border border-line bg-ink-2 shadow-sheet">
          {matches.map((m) => (
            <li key={m.key}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                // keep the box focused, so the phone's keyboard stays up
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(m.alias)}
                className="flex min-h-[44px] w-full items-center px-3 text-left font-body text-[15px] font-semibold text-cream active:bg-ink-3"
              >
                @{m.alias}
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <div className="relative w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview blob */}
          <img src={preview} alt="Picture to send" className="h-20 rounded-hz border border-line object-cover" />
          <button
            type="button"
            onClick={() => setImage(null)}
            aria-label="Remove picture"
            className="absolute -right-3 -top-3 grid h-8 w-8 place-items-center rounded-full border border-line bg-ink-2 text-cream"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        {images && (
          <>
            <button
              type="button"
              onClick={() => file.current?.click()}
              aria-label="Add a picture"
              className="btn btn-ghost w-11 flex-none px-0"
            >
              <ImagePlus size={17} />
            </button>
            <input
              ref={file}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                setImage(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </>
        )}
        <input
          ref={field}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? body.length)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart ?? body.length)}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete="off"
          aria-label="Message"
          className="min-h-[44px]"
        />
        <button type="submit" className="btn flex-none px-4" disabled={sending || (!body.trim() && !image)}>
          {sending ? "..." : "SEND"}
        </button>
      </div>
    </form>
  );
}
