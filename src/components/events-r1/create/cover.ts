import { toJpeg } from "@/lib/crew-room/look";
import { getSupabase } from "@/lib/supabase/client";

/** The most a phone photo may weigh before we even try (the repo's own pickers shrink anything that opens). */
const MAX_PICK_BYTES = 20 * 1024 * 1024;
/** The saved cover stays small: the fake layer keeps it in localStorage. */
const MAX_COVER_BYTES = 250 * 1024;
/** Longest side to try, widest first. 1600 px is the ceiling. */
const WIDTHS = [1600, 1280, 1024, 800, 640];

const toDataUrl = (blob: Blob) =>
  new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(new Error("That picture won't open. Try another."));
    r.readAsDataURL(blob);
  });

/**
 * A picked photo as a small JPEG data URL for cover_url. Uses the crew pictures' own shrink (toJpeg: JPEG re-encode on a
 * canvas, quality stepped down) at up to 1600 px, then narrower until it is under about 250 KB.
 * Rejects with one plain line a Hopper can act on.

 * Fake data only (it keeps the picture in localStorage). Real data uses uploadCoverFile below.
 */
export async function coverFromFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("That is not a picture. Pick a photo.");
  if (file.size > MAX_PICK_BYTES) throw new Error("That picture is too big. Pick one under 20 MB.");
  let last: Blob | null = null;
  for (const max of WIDTHS) {
    last = await toJpeg(file, { max });
    if (last.size <= MAX_COVER_BYTES) return toDataUrl(last);
  }
  throw new Error("That picture is too big. Try another.");
}

/** The existing public bucket the crew pictures live in (supabase/crew_rooms.sql); covers sit in a folder of their own (events_r1_covers.sql). */
const BUCKET = "crew-images";
/** An uploaded cover is shrunk to about this, so a cover costs little data; the bucket's own cap is 2 MB. */
const UPLOAD_TARGET_BYTES = 600 * 1024;

/**
 * Real data: the same shrink, then an upload to crew-images/event-covers/<my user id>/<fresh name>.jpg, and the FULL public link back.
 * The link is what is kept as cover_url / flyer_url, because the cards, the map and the share card use flyer_url as an image address
 * as is. The database accepts a host with an account only (a guest's upload is refused by the storage policy).
 */
export async function uploadCoverFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("That is not a picture. Pick a photo.");
  if (file.size > MAX_PICK_BYTES) throw new Error("That picture is too big. Pick one under 20 MB.");
  const sb = getSupabase();
  if (!sb) throw new Error("No connection. Try again.");
  const { data } = await sb.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error("Sign in to add a cover.");
  let blob: Blob | null = null;
  for (const max of WIDTHS) {
    blob = await toJpeg(file, { max });
    if (blob.size <= UPLOAD_TARGET_BYTES) break;
  }
  if (!blob) throw new Error("That picture won't open. Try another.");
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const path = `event-covers/${uid}/${name}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" });
  if (error) throw new Error(/row-level|policy|permission|unauthori/i.test(error.message) ? "Sign in with your email to add a cover." : "The upload didn't go through. Try again.");
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
