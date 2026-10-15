"use client";

import { useAnnouncementFeed, useAnnouncements } from "@/lib/crew-room/announcements";

/**
 * The only sign of an announcement: while this member has one they have not seen, the owner's logo (the room header's round
 * badge, `data-room-logo`) beats twice and rests, and carries a small orange "!". No toast, no banner, no push. It stops the
 * moment the panel the logo opens is opened (ExplorePopover marks them seen).
 *
 * The badge itself belongs to the room header, so this draws on it from outside: it also keeps the room's announcements
 * fresh (useAnnouncementFeed) and, only while there is something unseen, adds one style rule for that button.
 */
/** The rule that makes the logo beat and wear its "!". Exported so the dev page can draw the same thing. */
export const BEAM_CSS = `
      [data-room-logo] > span:first-child { animation: hz-beam 3.2s ease-out infinite; }
      [data-room-logo]::after {
        content: "!";
        position: absolute;
        top: -1px;
        right: -1px;
        width: 17px;
        height: 17px;
        border-radius: 50%;
        border: 2px solid rgb(var(--raised));
        box-sizing: border-box;
        background: #ff4d00;
        color: #0e0b0a;
        font: 900 10px/13px var(--font-poppins), system-ui, sans-serif;
        text-align: center;
        pointer-events: none;
      }
      @keyframes hz-beam {
        0% { box-shadow: 0 0 0 0 rgb(255 77 0 / 0.75); }
        18% { box-shadow: 0 0 0 12px rgb(255 77 0 / 0); }
        26% { box-shadow: 0 0 0 0 rgb(255 77 0 / 0.75); }
        44% { box-shadow: 0 0 0 12px rgb(255 77 0 / 0); }
        100% { box-shadow: 0 0 0 0 rgb(255 77 0 / 0); }
      }
      @media (prefers-reduced-motion: reduce) {
        [data-room-logo] > span:first-child { animation: none; }
      }
    `;

export default function AnnouncementBeam({ crewId }: { crewId: string }) {
  useAnnouncementFeed(crewId);
  const { unseen, supported } = useAnnouncements(crewId);
  if (!supported || unseen <= 0) return null;
  return <style>{BEAM_CSS}</style>;
}
