"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Share2, X } from "lucide-react";
import m from "@/components/today/today.module.css";
import { inviteLink, type CrewCard } from "@/lib/crew-room/hub";
import { getSupabase } from "@/lib/supabase/client";
import { useToast } from "@/lib/store";
import { brandName, renderTicketStory, ticketShareText } from "./ticketStory";

/**
 * SHARE TO STORY for a Game Time winner: draws the 9:16 picture ("I'm going to <title>, ticket from <brand>, powered by
 * Hoppaz") and shows it in a sheet, the twin of the event story sheet (components/today/StorySheet.tsx). SHARE TO STORY hands
 * the picture itself to the phone's share sheet where it can take a file; SAVE IMAGE downloads the PNG; SHARE LINK sends the
 * plain link with the same words.
 *
 * THE TICKET CODE IS NEVER SHARED. This sheet is not given the code, and neither the picture, the share text nor the link
 * carries it: whoever holds the code can claim the ticket.
 *
 * The link is the crew's invite page when the Hopper can see the invite code, else the crew's page, else the site itself.
 * It mounts only while it is open (the parent renders it on demand) and draws in a portal over everything, so it can rise
 * over the full-screen win card as well as over Me.
 */

type Made = { url: string; file: File; link: string };

/** Longest wait for the crew's logo and invite code before the picture is drawn without them. */
const FACTS_WAIT_MS = 3000;

/** The crew's round logo and invite code, from crew_card(). Never throws and never waits longer than FACTS_WAIT_MS. */
async function crewFacts(crewId: string | null): Promise<{ logo: string | null; code: string | null }> {
  const none = { logo: null, code: null };
  const sb = getSupabase();
  if (!crewId || !sb) return none;
  const ask = (async () => {
    const { data, error } = await sb.rpc("crew_card", { p_crew: crewId, p_code: null });
    if (error || !data) return none;
    const card = data as Pick<CrewCard, "logo_url" | "invite_code">;
    return { logo: card.logo_url || null, code: card.invite_code || null };
  })().catch(() => none);
  const wait = new Promise<typeof none>((resolve) => setTimeout(() => resolve(none), FACTS_WAIT_MS));
  return Promise.race([ask, wait]);
}

export default function TicketStorySheet({
  title,
  brand,
  crewId,
  onClose,
}: {
  /** The Game Time's title. */
  title: string;
  /** The game's brand. */
  brand: string;
  /** The crew that gave the ticket: its logo and link come from here. */
  crewId: string | null;
  onClose: () => void;
}) {
  const say = useToast((s) => s.say);
  const [made, setMade] = useState<Made | null>(null);
  const [failed, setFailed] = useState(false);
  const [canFile, setCanFile] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  // The parent passes a fresh onClose on every render; the key listener and the focus must not restart for that.
  const closeNow = useRef(onClose);
  useEffect(() => {
    closeNow.current = onClose;
  });

  const shownTitle = title.trim() || "Game Time";
  const shownBrand = brandName(brand) || "Hoppaz";
  const text = ticketShareText(shownTitle, shownBrand);

  useEffect(() => {
    let dead = false;
    let url = "";
    (async () => {
      const facts = await crewFacts(crewId);
      const { blob } = await renderTicketStory({ title: shownTitle, brand: shownBrand, logo: facts.logo, link: window.location.host });
      if (dead) return;
      url = URL.createObjectURL(blob);
      const file = new File([blob], `hoppaz-${slug(shownTitle)}-ticket-story.png`, { type: "image/png" });
      setCanFile(typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }));
      const link = facts.code ? inviteLink(facts.code) : crewId ? `${window.location.origin}/crew/${encodeURIComponent(crewId)}` : window.location.origin;
      setMade({ url, file, link });
    })().catch(() => {
      if (!dead) setFailed(true);
    });
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
    // One picture per opening: the sheet mounts when it opens and is gone when it closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Escape closes this sheet only. It listens first (capture) and stops the event, so the win card under it stays.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeNow.current();
    };
    window.addEventListener("keydown", onKey, true);
    close.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (typeof document === "undefined") return null;

  const share = async () => {
    if (!made) return;
    try {
      await navigator.share({ files: [made.file], title: shownTitle, text, url: made.link });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) say("Could not open the share sheet. Save the image instead.", "error");
    }
  };
  const link = async () => {
    const url = made?.link ?? window.location.origin;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: shownTitle, text, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      say("Link copied.", "ok");
    } catch {
      say("Could not copy the link.", "error");
    }
  };

  return createPortal(
    // z-[49]: over the win card and every sheet, under the toast (z-50) so "Link copied." can still be seen.
    <div className="fixed inset-0 z-[49]">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 animate-fade bg-brand-ink/65" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Share to story"
        className="hz-night absolute inset-x-0 bottom-0 mx-auto flex max-h-[96%] w-full max-w-[460px] animate-rise flex-col overflow-hidden rounded-t-[26px] border-t border-line bg-ink-2 text-cream shadow-sheet"
      >
        <span aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-line" />
        <button
          ref={close}
          type="button"
          onClick={onClose}
          aria-label="Close story preview"
          className="absolute right-2 top-2 z-10 grid h-11 w-11 place-items-center text-dim hover:text-cream"
        >
          <X size={18} />
        </button>

        <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pb-5 pt-9">
          <div className="self-start">
            <h2 className="font-display text-[22px] font-black leading-none tracking-[-0.02em]">Share to story</h2>
            <p className="mt-1.5 font-body text-[13px] text-dim">Show them where you are going. 9:16, ready for Instagram and TikTok.</p>
          </div>

          <div className={`${m.stage} mt-4`}>
            {made ? (
              // eslint-disable-next-line @next/next/no-img-element -- a blob URL made a moment ago
              <img src={made.url} alt={`The story picture for ${shownTitle}`} />
            ) : (
              <div role="status" className={m.stageLd}>
                {failed ? "COULD NOT DRAW IT. CLOSE AND TRY AGAIN." : "DRAWING YOUR STORY"}
              </div>
            )}
          </div>

          <div className="mt-4 flex w-full flex-col gap-2">
            {canFile && (
              <button type="button" onClick={() => void share()} disabled={!made} className="btn w-full" data-gt-story-share>
                <Share2 size={16} strokeWidth={2.6} aria-hidden /> SHARE TO STORY
              </button>
            )}
            <div className="flex gap-2">
              {made ? (
                <a
                  href={made.url}
                  download={made.file.name}
                  onClick={() => say("Saving your story image.", "ok")}
                  className={`btn flex-1 ${canFile ? "btn-ghost" : ""}`}
                >
                  <Download size={16} strokeWidth={2.6} aria-hidden /> SAVE IMAGE
                </a>
              ) : (
                <span aria-disabled="true" className="btn flex-1 pointer-events-none opacity-50">
                  <Download size={16} strokeWidth={2.6} aria-hidden /> SAVE IMAGE
                </span>
              )}
              <button type="button" onClick={() => void link()} className="btn btn-ghost flex-1">
                SHARE LINK
              </button>
            </div>
          </div>
          <p className="mt-3 text-center font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-dim">
            1080 x 1920 PNG · your code stays private
          </p>
        </div>
      </section>
    </div>,
    document.body,
  );
}

const slug = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "game-time";
