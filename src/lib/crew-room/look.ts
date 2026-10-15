"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { CrewCard, CrewEvent } from "./hub";
import { crewImagePath } from "./images";

/**
 * The look of a crew, and the owner's tools to change it (MANAGE CREW on the hub): header pictures, the round logo,
 * the featured event with its ribbon, the room template. The server is the judge of every one of them
 * (supabase/crew_rooms.sql: crew_update_look, crew_room_set_featured, crew_room_set_template, the crew-images bucket);
 * this file shrinks pictures on the phone, talks to those calls and turns their errors into short lines a Hopper can act on.
 */

/**
 * The owner's picture and room tools (header pictures, the logo, the meeting room template) are OFF for launch: the owner
 * dashboard is more than the first night needs. The code is all here. Set NEXT_PUBLIC_CREW_OWNER_UPLOADS=1 at build time to
 * show them again. The featured event with its ribbon and the invite link stay on either way.
 */
export const OWNER_UPLOADS = process.env.NEXT_PUBLIC_CREW_OWNER_UPLOADS === "1";

export const MAX_HEADERS = 5;
/** Longest ribbon text under the fountain's sticker (the column's own check). */
export const RIBBON_MAX = 14;
/** The crew-images bucket's cap. A picture is squeezed until it fits. */
const MAX_BYTES = 2 * 1024 * 1024;
const BUCKET = "crew-images";

/** The call's error, as one line for a toast or a form. */
export function lookError(error: { message?: string } | null | undefined, fallback = "Couldn't save that. Try again."): string {
  const m = error?.message ?? "";
  if (m.includes("owner_only")) return "Only the crew owner can change this.";
  if (m.includes("too_many_images")) return `${MAX_HEADERS} pictures is the most. Remove one first.`;
  if (m.includes("invalid_image")) return "That picture isn't allowed. Pick another one.";
  if (m.includes("invalid_event")) return "That event isn't on any more. Pick another.";
  if (m.includes("invalid_ribbon")) return `Keep the ribbon to ${RIBBON_MAX} letters, on one line.`;
  if (m.includes("invalid_template")) return "That room isn't ready yet.";
  if (m.includes("hunt_in_progress")) return "A Game Time is on or about to start. Change the room after it.";
  if (m.includes("need_account")) return "Make an account first.";
  return fallback;
}

/** Shrinks a picture before it leaves the phone: a JPEG no wider than `max`, squeezed until it is under the bucket's cap. */
export async function toJpeg(file: File, opts: { max?: number; square?: boolean } = {}): Promise<Blob> {
  // 1080 px wide at JPEG quality about 0.72 is a crisp header on a phone and 100 to 250 KB on Lagos data (1600 px was 4 times that).
  const max = opts.max ?? 1080;
  let img: ImageBitmap;
  try {
    img = await createImageBitmap(file);
  } catch {
    throw new Error("That picture won't open. Try a JPEG or a PNG.");
  }
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  if (opts.square) {
    // The middle square: a logo is drawn in a circle.
    const side = Math.min(sw, sh);
    sx = Math.floor((sw - side) / 2);
    sy = Math.floor((sh - side) / 2);
    sw = sh = side;
  }
  const k = Math.min(1, max / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * k));
  canvas.height = Math.max(1, Math.round(sh * k));
  const g = canvas.getContext("2d");
  if (!g) throw new Error("This phone can't shrink pictures.");
  // A JPEG has no see-through: a PNG with gaps lands on the app's own ground, not black.
  g.fillStyle = "#0E0B0A";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.imageSmoothingQuality = "high";
  g.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  img.close();
  for (const q of [0.72, 0.62, 0.5, 0.4]) {
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", q));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error("That picture is too big even after shrinking. Try another.");
}

/** Puts a shrunk picture in this crew's folder of the crew-images bucket and returns the PATH to keep (images.ts adds our host back). */
export async function uploadCrewImage(crewId: string, blob: Blob): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("No connection. Try again.");
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const path = `${crewId}/${name}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" });
  if (error) throw new Error(/row-level|policy|permission|unauthori/i.test(error.message) ? "Only the crew owner can add pictures." : "The upload didn't go through. Try again.");
  return crewImagePath(sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
}

/** Takes a picture we hold out of the bucket once nothing shows it. Quiet when it is not ours (a /brands/ path) or the call fails. */
export async function forgetCrewImage(url: string): Promise<void> {
  const sb = getSupabase();
  const at = url.indexOf(`/${BUCKET}/`);
  if (!sb || at < 0) return;
  const path = url.slice(at + BUCKET.length + 2);
  if (!/^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i.test(path)) return;
  await sb.storage.from(BUCKET).remove([path]);
}

/** Saves the logo and the header pictures, in order. Returns the crew's new card. */
export async function saveLook(crewId: string, logo: string | null, headers: string[]): Promise<{ card: CrewCard | null; error: string }> {
  const sb = getSupabase();
  if (!sb) return { card: null, error: "No connection. Try again." };
  const { data, error } = await sb.rpc("crew_update_look", { p_crew: crewId, p_logo_url: logo ?? "", p_header_images: headers });
  if (error) return { card: null, error: lookError(error) };
  return { card: data as CrewCard, error: "" };
}

/** Features an event on the fountain's sticker with a ribbon under it (null: no event, the room finds the crew's next one). */
export async function saveFeatured(crewId: string, eventId: string | null, ribbon: string): Promise<string> {
  const sb = getSupabase();
  if (!sb) return "No connection. Try again.";
  const { error } = await sb.rpc("crew_room_set_featured", { p_crew: crewId, p_event: eventId, p_ribbon: ribbon.trim() });
  return error ? lookError(error) : "";
}

/** Chooses the room template that holds the crew's meeting. */
export async function saveTemplate(crewId: string, template: string): Promise<string> {
  const sb = getSupabase();
  if (!sb) return "No connection. Try again.";
  const { error } = await sb.rpc("crew_room_set_template", { p_crew: crewId, p_template: template });
  return error ? lookError(error) : "";
}

/** Live events from six hours ago to six weeks ahead, soonest first: the featured event picker's list. */
export function useUpcomingEvents(enabled: boolean) {
  const [events, setEvents] = useState<CrewEvent[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sb = getSupabase();
    if (!enabled || !sb) return;
    let live = true;
    const from = new Date(Date.now() - 6 * 3600_000).toISOString();
    const to = new Date(Date.now() + 42 * 86400_000).toISOString();
    void sb
      .from("events")
      .select("id,title,venue_name,area,starts_at,flyer_url")
      .eq("status", "live")
      .gte("starts_at", from)
      .lte("starts_at", to)
      .order("starts_at")
      .limit(60)
      .then(({ data }) => {
        if (!live) return;
        setEvents((data ?? []) as CrewEvent[]);
        setReady(true);
      });
    return () => {
      live = false;
    };
  }, [enabled]);
  return { events, ready };
}
