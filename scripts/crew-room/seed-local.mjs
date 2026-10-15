// Makes the "360Playlist" crew on the LOCAL database: open, verified, owned by local test account A, with its room set
// up (banner, welcome line, event words "360Playlist, Dave") and its look: the round logo (public/brands/360playlist.jpg)
// and two header pictures in the crew-images bucket. Safe to run again: it finds the crew it made (also under its old
// spelling, which it renames), leaves the owner's later room settings and pictures alone, and only fills in what is
// missing. Refuses any database that is not on this machine.
//   node scripts/crew-room/seed-local.mjs [path/to/test_users.env] [--reset-look]
// The test accounts file defaults to ../localdb/test_users.env (beside the repo). --reset-look draws the two header
// pictures again (after the room art or the Dave flyer changed). Nothing secret is printed.
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("LOCAL database required");
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const checked = (result) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

const args = process.argv.slice(2);
const resetLook = args.includes("--reset-look");
const usersFile = args.find((a) => !a.startsWith("--")) ?? fileURLToPath(new URL("../../../localdb/test_users.env", import.meta.url));
const users = {};
for (const line of (await readFile(usersFile, "utf8")).split("\n")) {
  const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) users[m[1]] = m[2].trim();
}
const owner = users.E2E_A_ID;
if (!owner) throw new Error("E2E_A_ID is missing from the test accounts file");

const NAME = "360Playlist";
const OLD_NAME = "360 Playlist";
const KEYWORDS = "360Playlist, Dave";
const DAVE_EVENT = "9e733b14-e5c3-41ac-9e10-c2a4b5b8640c";

let crew =
  checked(await admin.from("crews").select("id,name").eq("name", NAME).eq("verified", true).limit(1).maybeSingle()) ??
  checked(await admin.from("crews").select("id,name").eq("name", OLD_NAME).eq("verified", true).limit(1).maybeSingle());
if (!crew) {
  crew = checked(await admin.from("crews").insert({ name: NAME, created_by: owner, visibility: "open", verified: true }).select("id,name").single());
  console.log(`Made the ${NAME} crew.`);
} else {
  checked(await admin.from("crews").update({ name: NAME, visibility: "open", verified: true }).eq("id", crew.id));
  console.log(`The ${NAME} crew is already here.`);
}
checked(await admin.from("crew_members").upsert({ crew_id: crew.id, user_id: owner, role: "owner" }, { onConflict: "crew_id,user_id" }));
checked(
  await admin.from("crew_rooms").upsert(
    {
      crew_id: crew.id,
      width: 30,
      content: {
        brand: NAME,
        strapline: "A space for music, discovery & good company.",
        musicTitle: "",
        musicUrl: "",
        audioUrl: "",
        artistTitle: "",
        artistNote: "",
        eventKeywords: KEYWORDS,
        awards: [],
      },
    },
    { onConflict: "crew_id", ignoreDuplicates: true }
  )
);

// A room made before the brand was written as one word: fix only that, keep everything else the owner set.
const room = checked(await admin.from("crew_rooms").select("content,version").eq("crew_id", crew.id).single());
const content = { ...room.content };
if (content.brand === OLD_NAME) content.brand = NAME;
if (typeof content.eventKeywords === "string") content.eventKeywords = content.eventKeywords.replaceAll(OLD_NAME, NAME);
if (JSON.stringify(content) !== JSON.stringify(room.content)) {
  checked(await admin.from("crew_rooms").update({ content, version: room.version + 1 }).eq("crew_id", crew.id));
  console.log("Wrote the brand as one word in the room.");
}

// The look. A logo and pictures the owner already set are never replaced (unless --reset-look asks for the pictures).
const look = checked(await admin.from("crews").select("logo_url,header_images").eq("id", crew.id).single());
const patch = {};
if (!look.logo_url) patch.logo_url = "/brands/360playlist.jpg";
if (resetLook || look.header_images.length === 0) {
  const W = 1600;
  const H = 900;
  const jpeg = (img) => img.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  const pictures = [];

  // 1: the Dave flyer, standing on its own blurred backdrop.
  const dave = checked(await admin.from("events").select("flyer_url").eq("id", DAVE_EVENT).maybeSingle());
  if (dave?.flyer_url) {
    const flyer = Buffer.from(await (await fetch(dave.flyer_url)).arrayBuffer());
    const back = await sharp(flyer).resize(W, H, { fit: "cover" }).blur(28).modulate({ brightness: 0.5 }).toBuffer();
    // The poster sits high, so the dots under the picture never cover it.
    const front = await sharp(flyer).resize({ height: 680, fit: "inside" }).toBuffer();
    const meta = await sharp(front).metadata();
    pictures.push(await jpeg(sharp(back).composite([{ input: front, left: Math.round((W - meta.width) / 2), top: 70 }])));
  }
  // 2: the room itself, from above.
  const art = await readFile(fileURLToPath(new URL("../../public/templates/clubhouse.jpg", import.meta.url)));
  pictures.push(await jpeg(sharp(art).resize(W, H, { fit: "cover", position: "centre", kernel: "lanczos3" })));

  const urls = [];
  for (const [i, buf] of pictures.entries()) {
    const path = `${crew.id}/seed-${i + 1}.jpg`;
    checked(await admin.storage.from("crew-images").upload(path, buf, { contentType: "image/jpeg", upsert: true, cacheControl: "60" }));
    // The database keeps the path (the app adds its storage address), never a link to a host.
    urls.push(`/storage/v1/object/public/crew-images/${path}`);
  }
  patch.header_images = urls;
}
if (Object.keys(patch).length) {
  checked(await admin.from("crews").update(patch).eq("id", crew.id));
  console.log(`Set the look: ${patch.logo_url ? "logo" : ""}${patch.logo_url && patch.header_images ? " and " : ""}${patch.header_images ? `${patch.header_images.length} header pictures` : ""}.`);
}

// The fountain's sticker: Jae asked for the Dave event with a FREE ribbon. Only set when the room has no featured event yet,
// so an owner who picked another one (or cleared it) is left alone.
const fountain = checked(await admin.from("crew_rooms").select("featured_event_id,featured_ribbon,version").eq("crew_id", crew.id).single());
if (!fountain.featured_event_id && !fountain.featured_ribbon) {
  const live = checked(await admin.from("events").select("id").eq("id", DAVE_EVENT).eq("status", "live").maybeSingle());
  if (live) {
    checked(await admin.from("crew_rooms").update({ featured_event_id: DAVE_EVENT, featured_ribbon: "FREE", version: fountain.version + 1 }).eq("crew_id", crew.id));
    console.log("Put the Dave event on the fountain with a FREE ribbon.");
  }
}

console.log(`Crew page: /crew/${crew.id}`);
console.log(`Room:      /crew/${crew.id}/room`);
console.log("Owner: local test account A (E2E_A in the test accounts file).");
