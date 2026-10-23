"use client";

import type { R1Event, ViewerState } from "@/lib/events-r1/types";
import { linkLabel } from "./link";
import { endOf } from "./time";

const OPENS_BEFORE = 15 * 60_000;

/**
 * The online part of a registered person's card (and the host's): what kind of link it is, and Join call, which opens
 * from 15 minutes before the start. Before that a disabled button and one quiet line.
 */
export default function JoinCall({ event, viewer, now }: { event: R1Event; viewer: ViewerState; now: number }) {
  const start = Date.parse(event.starts_at);
  const over = now > endOf(event);
  const open = !over && !!event.online_link && (viewer.joinCallOpen || (viewer.canSeeOnlineLink && now >= start - OPENS_BEFORE));

  return (
    <div>
      <p className="font-display text-[15px] font-black">{linkLabel(event)}</p>
      {event.link_type === "whatsapp" && <p className="hint mt-0.5">Opens in WhatsApp, or in a browser</p>}
      {open ? (
        <a href={event.online_link ?? "#"} target="_blank" rel="noreferrer noopener" className="btn mt-2.5 w-full normal-case">
          Join call
        </a>
      ) : (
        <>
          <button type="button" disabled className="btn mt-2.5 w-full normal-case">
            Join call
          </button>
          {!over && <p className="hint mt-1.5">The link works from 15 minutes before</p>}
        </>
      )}
    </div>
  );
}
