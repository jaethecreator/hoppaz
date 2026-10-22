import { toJpeg } from "@/lib/crew-room/look";

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
 *
 * TODO(Ola storage): in real mode this should upload the blob to the events cover bucket and return its public URL.
 * The field stays cover_url either way; until the bucket exists the data URL is sent as is.
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
