// Makes the "360 Playlist" crew on the LOCAL database: open, verified, owned by local test account A, with its room
// set up (banner, welcome line, event words "360 Playlist, Dave"). Safe to run again: it finds the crew it made and
// leaves the owner's later room settings alone. Refuses any database that is not on this machine.
//   node scripts/crew-room/seed-local.mjs [path/to/test_users.env]
// The test accounts file defaults to ../localdb/test_users.env (beside the repo). Nothing secret is printed.
import { createClient } from "@supabase/supabase-js";
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

const usersFile = process.argv[2] ?? fileURLToPath(new URL("../../../localdb/test_users.env", import.meta.url));
const users = {};
for (const line of (await readFile(usersFile, "utf8")).split("\n")) {
  const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) users[m[1]] = m[2].trim();
}
const owner = users.E2E_A_ID;
if (!owner) throw new Error("E2E_A_ID is missing from the test accounts file");

const NAME = "360 Playlist";
let crew = checked(await admin.from("crews").select("id").eq("name", NAME).eq("verified", true).limit(1).maybeSingle());
if (!crew) {
  crew = checked(await admin.from("crews").insert({ name: NAME, created_by: owner, visibility: "open", verified: true }).select("id").single());
  console.log("Made the 360 Playlist crew.");
} else {
  checked(await admin.from("crews").update({ visibility: "open", verified: true }).eq("id", crew.id));
  console.log("The 360 Playlist crew is already here.");
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
        eventKeywords: "360 Playlist, Dave",
        awards: [],
      },
    },
    { onConflict: "crew_id", ignoreDuplicates: true }
  )
);
console.log(`Crew page: /crew/${crew.id}`);
console.log(`Room:      /crew/${crew.id}/room`);
console.log("Owner: local test account A (E2E_A in the test accounts file).");
