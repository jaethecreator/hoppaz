// Writes the walkable grid of every event and hotspot room (PLACE_ROOMS) to its OWN file, supabase/place_room_layouts.sql.
// It never touches supabase/crew_rooms.sql (scripts/crew-room/export-layouts.mjs does, and must not run for this branch):
// the crew tables hold crew templates only, so a crew can never be pointed at an event or hotspot room.
//   node scripts/rooms/export-place-layouts.mjs            -> writes supabase/place_room_layouts.sql
//   node scripts/rooms/export-place-layouts.mjs --check    -> exits 1 when the file is out of date (no write)
// Regenerate after every merge and every room change: the file is never merged by hand (check-campaign.mjs fails when stale).
import fs from "node:fs";
import { placeLayoutsSql } from "./place-layouts-sql.mjs";

const file = new URL("../../supabase/place_room_layouts.sql", import.meta.url);
const sql = placeLayoutsSql();

if (process.argv.includes("--check")) {
  const same = fs.existsSync(file) && fs.readFileSync(file, "utf8") === sql;
  console.log(same ? "place_room_layouts.sql is up to date." : "place_room_layouts.sql is out of date: run scripts/rooms/export-place-layouts.mjs");
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(file, sql);
console.log(`Wrote ${sql.split("\n").filter((l) => /^  \('/.test(l)).length} place room layouts to supabase/place_room_layouts.sql`);
