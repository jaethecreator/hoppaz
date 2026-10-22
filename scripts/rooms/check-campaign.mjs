import assert from "node:assert/strict";
import fs from "node:fs";
import { loadCampaign, loadFile } from "./load-campaign.mjs";
import { placeLayoutsSql } from "./place-layouts-sql.mjs";

const { CLUBHOUSE: layout, clubhouseWidth, sceneSize, sceneBlocks, canWalkScene, scenePath, privateAreaAt, validCampaignUrl, EMPTY_CAMPAIGN,
  ROOM_TEMPLATES, ROOM_WIDTHS, TEMPLATE_KEYS, roomTemplate, templateFor, PLACE_ROOMS, EVENT_ROOMS, HOTSPOT_ROOMS, placeRoom, hotspotRoom, eventRoom } = loadCampaign();
const { HOTSPOT_ROOM_DATA } = loadFile("src/lib/rooms/hotspotRooms.ts");
let passed = 0;
const failures = [];
// A failing check is reported and the run goes on, so one room still being drawn never hides the rest.
function check(label, run) {
  try { run(); passed++; console.log(`PASS ${label}`); } catch (error) { failures.push(label); console.log(`FAIL ${label}\n     ${String(error.message).split("\n")[0]}`); }
}
function connected(from, to) {
  const path = scenePath(layout, from, to);
  assert.ok(path, `No path to ${JSON.stringify(to)}`);
  let previous = from;
  for (const point of path) {
    assert.ok(canWalkScene(layout, point));
    assert.equal(Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y), 1);
    previous = point;
  }
  assert.equal(previous.x, to.x); assert.equal(previous.y, to.y);
}
check("All six sections connect to the entrance", () => {
  assert.equal(layout.zones.length, 6);
  for (const zone of layout.zones) connected(layout.spawn, zone.stop);
});
check("Visitors can walk between every pair of sections", () => {
  for (const a of layout.zones) for (const b of layout.zones) connected(a.stop, b.stop);
});
check("Solid furniture and architectural walls block movement", () => {
  for (const block of sceneBlocks(layout)) assert.equal(canWalkScene(layout, { x: block.x, y: block.y }), false);
});
check("Navigation rejects invalid and outside tiles", () => {
  for (const tile of [{ x: 0, y: 4 }, { x: 30, y: 4 }, { x: 15, y: 20 }, { x: 1.5, y: 9 }]) assert.equal(scenePath(layout, layout.spawn, tile), null);
});
check("All geometry is bounded, with unique asset and zone identifiers", () => {
  assert.equal(new Set(layout.zones.map((z) => z.id)).size, layout.zones.length);
  assert.equal(new Set(layout.props.map((p) => p.id)).size, layout.props.length);
  for (const item of [...layout.zones, ...layout.props, ...layout.walls]) {
    assert.ok(item.x >= 0 && item.y >= 0 && item.w > 0 && item.h > 0);
    assert.ok(item.x + item.w <= layout.grid.width && item.y + item.h <= layout.grid.height);
  }
});
check("World dimensions derive from the layout definition", () => {
  assert.equal(sceneSize(layout).width, 960); assert.equal(sceneSize(layout).height, 640);
  const wider = { ...layout, grid: { ...layout.grid, width: 40, height: 24 } };
  assert.equal(sceneSize(wider).width, 1280); assert.equal(sceneSize(wider).height, 768);
  assert.equal(canWalkScene(wider, { x: 35, y: 21 }), true);
});
check("Roomy preset preserves reachable sections and furniture size", () => {
  const roomy = clubhouseWidth(36);
  assert.equal(sceneSize(roomy).width, 1152);
  for (const zone of roomy.zones) {
    assert.ok(scenePath(roomy, roomy.spawn, zone.stop), `Roomy ${zone.id} unreachable`);
    for (const other of roomy.zones) assert.ok(scenePath(roomy, zone.stop, other.stop));
  }
  for (const prop of roomy.props) {
    const original = layout.props.find((p) => p.id === prop.id);
    assert.equal(prop.w, original.w); assert.equal(prop.h, original.h);
  }
});
check("Defaults contain no invented artists, music or awards", () => {
  assert.equal(EMPTY_CAMPAIGN.brand, "360Playlist");
  assert.equal(EMPTY_CAMPAIGN.musicUrl, ""); assert.equal(EMPTY_CAMPAIGN.audioUrl, "");
  assert.equal(EMPTY_CAMPAIGN.artistTitle, ""); assert.equal(EMPTY_CAMPAIGN.awards.length, 0);
});
check("Campaign links reject executable and malformed URLs", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "file:///tmp/test", "not a link", ""]) assert.equal(validCampaignUrl(value), null);
  assert.equal(validCampaignUrl("https://example.com/music"), "https://example.com/music");
});
check("Conversation areas are reachable, separate and keep main gathering spaces public", () => {
  for (const width of [30,36]) {
    const room=clubhouseWidth(width);
    assert.equal(room.privateAreas.length,4);
    for(const area of room.privateAreas) {
      assert.ok(scenePath(room,room.spawn,area.stop), `${area.id} must be reachable`);
      assert.equal(privateAreaAt(room,area.stop)?.id,area.id);
    }
    for(let y=1;y<room.grid.height-1;y++) for(let x=1;x<room.grid.width-1;x++) {
      assert.ok(room.privateAreas.filter(a=>x>=a.x&&x<a.x+a.w&&y>=a.y&&y<a.y+a.h).length<=1,'private areas must not overlap');
    }
    for(const id of ['stage','courtyard','awards','campaign']) assert.equal(privateAreaAt(room,room.zones.find(z=>z.id===id).stop),null);
  }
});
// Other features find props by id (the map table, Game Time's hiding places): an id is never renamed or dropped.
const STABLE_IDS = ["mixing-desk", "studio-speaker-l", "studio-speaker-r", "listening-chair-l", "listening-chair-r", "studio-plant",
  "stage-console", "stage-speaker-l", "stage-speaker-r", "gallery-display-1", "gallery-display-2", "gallery-display-3", "gallery-plant",
  "courtyard-tree-l", "courtyard-tree-r", "courtyard-fountain", "courtyard-bench-l", "courtyard-bench-r", "courtyard-plant-l",
  "courtyard-plant-r", "record-wall", "record-wall-r", "record-rug", "record-sofa-l", "record-sofa-r", "record-table",
  "record-sofa-bottom", "record-lamp", "record-plant", "artist-poster-1", "artist-poster-2", "artist-poster-3", "artist-counter",
  "artist-plant", "entry-plant-l", "entry-plant-r", "entry-map-table"];
check("Prop ids stay stable in both widths, and the map table by the door is reachable", () => {
  for (const width of [30, 36]) {
    const room = clubhouseWidth(width);
    const ids = room.props.map((p) => p.id);
    for (const id of STABLE_IDS) assert.ok(ids.includes(id), `${id} missing at width ${width}`);
    const table = room.props.find((p) => p.id === "entry-map-table");
    assert.ok(scenePath(room, room.spawn, { x: table.x, y: table.y + 1 }), "the map table must be reachable from the entrance");
    assert.ok(scenePath(room, room.spawn, room.zones.find((z) => z.id === "courtyard").stop), "the table must not block the way in");
  }
});
// ---- Templates: every one the registry ships must be a room a crew can meet in. ----
check("The registry is data a picker can draw, and the clubhouse is in it", () => {
  assert.ok(ROOM_TEMPLATES.length >= 1);
  assert.deepEqual(TEMPLATE_KEYS, ROOM_TEMPLATES.map((t) => t.key));
  assert.equal(new Set(TEMPLATE_KEYS).size, TEMPLATE_KEYS.length, "template keys must be unique");
  assert.ok(TEMPLATE_KEYS.includes("clubhouse"));
  for (const t of ROOM_TEMPLATES) {
    assert.match(t.key, /^[a-z][a-z0-9-]{1,30}$/);
    assert.ok(t.name.length >= 3 && t.name.length <= 30, `${t.key} needs a short name`);
    assert.ok(t.description.length >= 20 && t.description.length <= 140, `${t.key} needs a one line description`);
    assert.ok(!/ \u2014 |\u2014|360 Playlist/.test(`${t.name} ${t.description}`), `${t.key} copy has an em dash or "360 Playlist"`);
    assert.ok(t.thumbnail.startsWith("/") && /\.(jpg|png|webp)$/.test(t.thumbnail), `${t.key} thumbnail must be a /public path`);
    assert.ok(fs.existsSync(new URL(`../../public${t.thumbnail}`, import.meta.url)), `${t.key} thumbnail file is missing: public${t.thumbnail}`);
  }
});
check("An unknown or missing template opens the clubhouse", () => {
  for (const key of [undefined, null, "", "nope", "Clubhouse "]) {
    assert.equal(templateFor(key).key, "clubhouse");
    assert.equal(roomTemplate(key).id, layout.id);
  }
  assert.equal(roomTemplate("clubhouse", 36).grid.width, 36);
  assert.equal(roomTemplate("clubhouse", 99).grid.width, 30);
});
for (const t of ROOM_TEMPLATES) {
  check(`Template ${t.key}: both widths have stable unique ids, valid walls, a reachable spawn, the door and the fountain`, () => {
    for (const width of ROOM_WIDTHS) {
      const room = t.layout(width);
      assert.equal(room.grid.width, width);
      assert.ok(canWalkScene(room, room.spawn), `${t.key} spawn must be walkable at ${width}`);
      assert.equal(new Set(room.props.map((p) => p.id)).size, room.props.length, `${t.key} prop ids must be unique`);
      assert.equal(new Set(room.zones.map((z) => z.id)).size, room.zones.length);
      assert.equal(new Set(room.privateAreas.map((a) => a.id)).size, room.privateAreas.length);
      for (const item of [...room.zones, ...room.props, ...room.walls, ...room.privateAreas]) {
        assert.ok(item.x >= 0 && item.y >= 0 && item.w > 0 && item.h > 0 && item.x + item.w <= room.grid.width && item.y + item.h <= room.grid.height, `${t.key} geometry out of bounds`);
      }
      for (const zone of room.zones) assert.ok(scenePath(room, room.spawn, zone.stop), `${t.key} ${zone.id} unreachable at ${width}`);
      for (const area of room.privateAreas) assert.ok(scenePath(room, room.spawn, area.stop), `${t.key} ${area.id} unreachable at ${width}`);
      const door = room.props.find((p) => p.id === "entry-map-table");
      assert.ok(door, `${t.key} needs the entry-map-table door prop`);
      assert.ok(scenePath(room, room.spawn, { x: door.x, y: door.y + 1 }), `${t.key} door must be reachable from the spawn`);
      const fountain = room.props.find((p) => p.id === "courtyard-fountain");
      assert.ok(fountain, `${t.key} needs the courtyard-fountain prop`);
      assert.equal(fountain.kind, "fountain");
    }
  });
}

// ---- Place rooms: the five event templates and the hotspot rooms (src/lib/campaign/rooms, src/lib/rooms/hotspotRooms.ts). ----
const EVENT_KEYS = ["event-theatre", "event-pool", "event-outdoor", "event-indoor", "event-tech"];
const WAVE_1 = ["yaba", "lekki", "victoria-island", "ikeja"];
const zoneSql = fs.readFileSync(new URL("../../supabase/hotspot_zones.sql", import.meta.url), "utf8");
// The 13 zone slugs are the top-level rows of the insert (two-space indent), not the split hints inside the jsonb.
const ZONE_SLUGS = [...zoneSql.matchAll(/^  \('([a-z-]+)', '[^']+', '/gm)].map((m) => m[1]);
const artSource = fs.readFileSync(new URL("../../src/components/campaign/roomArt.tsx", import.meta.url), "utf8");
const copyOk = (text) => !/\u2014|\u2013| -- |360 Playlist|Hoppas|Hopaz/.test(text);

check("Event and hotspot rooms are not crew templates: the MANAGE picker never lists them", () => {
  for (const room of PLACE_ROOMS) {
    assert.ok(!TEMPLATE_KEYS.includes(room.key), `${room.key} is in the crew picker`);
    assert.equal(templateFor(room.key).key, "clubhouse", `a crew row pointing at ${room.key} must open the clubhouse`);
  }
  assert.equal(new Set(PLACE_ROOMS.map((r) => r.key)).size, PLACE_ROOMS.length, "place room keys must be unique");
  for (const room of PLACE_ROOMS) assert.equal(placeRoom(room.key)?.key, room.key);
  assert.equal(placeRoom("clubhouse"), null, "placeRoom never answers with the clubhouse");
});
check("The five event templates are registered, in the registry and in the art switch", () => {
  assert.deepEqual([...EVENT_ROOMS.map((r) => r.key)].sort(), [...EVENT_KEYS].sort());
  for (const key of EVENT_KEYS) { assert.equal(eventRoom(key)?.key, key); assert.ok(artSource.includes(`"${key}":`), `${key} has no entry in roomArt.tsx`); }
  assert.equal(eventRoom("event-nope"), null);
});
check("There are 13 hotspot zones, and every hotspot room belongs to one", () => {
  assert.equal(ZONE_SLUGS.length, 13, `expected 13 zones, read ${ZONE_SLUGS.length}`);
  for (const room of HOTSPOT_ROOMS) {
    assert.ok(ZONE_SLUGS.includes(room.slug), `${room.key} has no zone ${room.slug}`);
    assert.equal(room.key, `hotspot-${room.slug}`);
    assert.equal(hotspotRoom(room.slug).key, room.key);
    assert.ok(artSource.includes(`"${room.key}":`), `${room.key} has no entry in roomArt.tsx`);
  }
  assert.equal(hotspotRoom("nope"), null);
  for (const slug of WAVE_1) assert.ok(hotspotRoom(slug), `wave 1 hotspot ${slug} has no room`);
});
check("The place layout SQL seed is exactly what the rooms generate (never hand-merged: regenerate it)", () => {
  const file = new URL("../../supabase/place_room_layouts.sql", import.meta.url);
  const onDisk = fs.readFileSync(file, "utf8");
  const keys = [...onDisk.matchAll(/^  \('([a-z0-9-]+)', '(?:event|hotspot)'/gm)].map((m) => m[1]).sort();
  assert.equal(JSON.stringify(keys), JSON.stringify(PLACE_ROOMS.map((r) => r.key).sort()), "the SQL seed's keys differ from PLACE_ROOMS: run node scripts/rooms/export-place-layouts.mjs");
  assert.ok(onDisk === placeLayoutsSql(), "supabase/place_room_layouts.sql is out of date: run node scripts/rooms/export-place-layouts.mjs");
});
for (const room of PLACE_ROOMS) {
  check(`Room ${room.key}: size, spawn, unique ids, in bounds, door, stops and the whole floor are reachable`, () => {
    const l = room.layout;
    assert.equal(l.id, room.key, "layout.id must equal the key");
    assert.equal(JSON.stringify(l.grid), JSON.stringify({ width: 30, height: 20, tile: 32 }));
    assert.ok(canWalkScene(l, l.spawn), "spawn must be walkable");
    assert.equal(new Set(l.props.map((p) => p.id)).size, l.props.length, "prop ids must be unique");
    assert.equal(new Set(l.zones.map((z) => z.id)).size, l.zones.length, "zone ids must be unique");
    assert.ok(l.zones.length >= 3 && l.zones.length <= 7, "3 to 7 zones (each is a name tag in the room)");
    for (const item of [...l.zones, ...l.props, ...l.walls]) assert.ok(item.x >= 0 && item.y >= 0 && item.w > 0 && item.h > 0 && item.x + item.w <= 30 && item.y + item.h <= 20, "geometry out of bounds");
    for (const z of l.zones) {
      assert.ok(scenePath(l, l.spawn, z.stop), `zone ${z.id} stop is not reachable`);
      assert.ok(z.stop.x >= z.x && z.stop.x < z.x + z.w && z.stop.y >= z.y && z.stop.y < z.y + z.h, `zone ${z.id} stop is outside it`);
      assert.ok(z.name.length >= 3 && z.name.length <= 26 && copyOk(z.name + z.subtitle), `zone ${z.id} copy`);
    }
    const door = l.props.find((p) => p.id === "entry-map-table");
    assert.ok(door && door.w >= 2, "needs the entry-map-table exit, 2 tiles wide");
    for (let dx = 0; dx < door.w; dx++) assert.ok(canWalkScene(l, { x: door.x + dx, y: door.y + door.h }), "the tile in front of the exit must be walkable");
    assert.ok(scenePath(l, l.spawn, { x: door.x, y: door.y + door.h }), "the exit must be reachable from the spawn");
    assert.ok(!(l.spawn.x >= door.x && l.spawn.x < door.x + door.w && l.spawn.y >= door.y && l.spawn.y < door.y + door.h));
    // No pockets: every walkable tile is reachable from the spawn.
    let walkable = 0; let reached = 0;
    for (let y = 1; y < 19; y++) for (let x = 1; x < 29; x++) if (canWalkScene(l, { x, y })) { walkable++; if (scenePath(l, l.spawn, { x, y })) reached++; }
    assert.ok(walkable >= 120, `only ${walkable} walkable tiles: the room is too full to walk`);
    assert.ok(walkable - reached <= 2, `${walkable - reached} walkable tiles are sealed off from the spawn`);
  });
}
for (const room of EVENT_ROOMS) {
  check(`Event room ${room.key}: the flyer and the line-up hang on the walls`, () => {
    const l = room.layout;
    for (const id of ["event-flyer", "event-lineup"]) {
      const p = l.props.find((q) => q.id === id);
      assert.ok(p, `${id} missing`);
      assert.equal(p.kind, id === "event-flyer" ? "flyer" : "lineup");
      assert.ok(p.solid && p.w >= 2 && p.h >= 2, `${id} must be a solid prop at least 2 by 2`);
    }
    assert.ok(room.name.length >= 3 && room.name.length <= 30 && room.description.length >= 20 && room.description.length <= 140 && copyOk(room.name + room.description), "name and description copy");
  });
}
for (const data of HOTSPOT_ROOM_DATA) {
  check(`Hotspot data ${data.slug}: sign, colours, lines and four real venues`, () => {
    assert.ok(ZONE_SLUGS.includes(data.slug), `${data.slug} is not a zone`);
    assert.ok([1, 2, 3, 4].includes(data.wave));
    assert.ok(data.sign === data.sign.toUpperCase() && data.sign.length >= 3 && data.sign.length <= 18, "sign: upper case, 3 to 18 characters");
    for (const c of Object.values(data.palette)) assert.match(c, /^#[0-9A-Fa-f]{6}$/);
    for (const t of [data.welcome, data.paz, data.hero.name, data.hero.blurb]) assert.ok(t.length >= 8 && t.length <= 120 && copyOk(t), `copy: ${t}`);
    assert.ok(data.paz.length <= 60, "Paz speaks in a short line");
    assert.equal(data.landmarks.length, 4);
    assert.equal(new Set(data.landmarks.map((m) => m.id)).size, 4);
    assert.equal(new Set(data.landmarks.map((m) => m.name)).size, 4);
    for (const m of data.landmarks) {
      assert.ok(m.name.length >= 3 && m.name.length <= 26 && copyOk(m.name + m.blurb), `landmark ${m.id}`);
      assert.ok(m.blurb.length >= 10 && m.blurb.length <= 120, `blurb ${m.id}`);
      if (m.source) assert.match(m.source, /^https?:\/\//);
    }
    assert.ok(data.local.length >= 3);
  });
}
for (const room of HOTSPOT_ROOMS) {
  check(`Hotspot room ${room.key}: a hero, four venue corners named for the real venues`, () => {
    const data = HOTSPOT_ROOM_DATA.find((d) => d.slug === room.slug);
    assert.ok(data, `no place data for ${room.slug}`);
    const l = room.layout;
    const hero = l.props.find((p) => p.id === "hero");
    assert.ok(hero && hero.w * hero.h >= 12, "the hero landmark must be a big prop (12 tiles or more)");
    for (let i = 0; i < 4; i++) {
      const venue = l.props.find((p) => p.id === `venue-${i + 1}`);
      assert.ok(venue && venue.w * venue.h >= 8, `venue-${i + 1} must be a prop of 8 tiles or more`);
      const zone = l.zones.find((z) => z.id === `venue-${i + 1}`);
      assert.ok(zone, `zone venue-${i + 1} missing`);
      assert.equal(zone.name, data.landmarks[i].name, `zone venue-${i + 1} must be named ${data.landmarks[i].name}`);
    }
    const heroZone = l.zones.find((z) => z.id === "hero");
    assert.ok(heroZone, "a hero zone is needed");
    assert.ok(room.name.length >= 3 && room.name.length <= 30 && data.junction.toLowerCase().includes(room.name.toLowerCase()), `room name "${room.name}" must be the junction's name`);
  });
}
// ---- The Emergency Room crew template (src/lib/campaign/rooms/emergencyRoom.ts): both widths, the contract and the Instagram link. ----
const ER_STABLE_IDS = ["main-stage", "tickets-desk", "brand-page", "merch", "doctors-on-duty", "hall-of-fame", "courtyard-fountain", "entry-map-table"];
check("Zone links are data the engine can trust: https only, a short label, no em dash", () => {
  const all = [...ROOM_TEMPLATES.flatMap((t) => ROOM_WIDTHS.map((w) => t.layout(w))), ...PLACE_ROOMS.map((r) => r.layout)];
  for (const l of all) for (const z of l.zones) {
    if (!z.link) continue;
    assert.match(z.link.url, /^https:\/\/[^\s]+$/, `${l.id} zone ${z.id}: link must be an https address`);
    assert.equal(validCampaignUrl(z.link.url), z.link.url);
    assert.ok(z.link.label.length >= 3 && z.link.label.length <= 24 && z.link.label === z.link.label.toUpperCase() && copyOk(z.link.label), `${l.id} zone ${z.id}: link label`);
  }
});
const erTemplate = ROOM_TEMPLATES.find((t) => t.key === "emergency-room");
check("The Emergency Room is a crew template with a picker card", () => {
  assert.ok(erTemplate, "emergency-room is not in ROOM_TEMPLATES");
  assert.equal(templateFor("emergency-room").key, "emergency-room");
  assert.equal(roomTemplate("emergency-room", 36).grid.width, 36);
  assert.equal(roomTemplate("emergency-room", 99).grid.width, 30);
  assert.ok(TEMPLATE_KEYS.includes("emergency-room"));
});
for (const width of ROOM_WIDTHS) {
  check(`Emergency Room at ${width}: stable ids, the stage zone, open floor, every stop and tag tile walkable, the door and the Instagram link`, () => {
    const l = erTemplate.layout(width);
    assert.equal(l.id, "emergency-room");
    assert.equal(l.grid.width, width);
    assert.equal(l.spawn.x, width / 2, "the spawn is the middle of the room");
    for (const id of ER_STABLE_IDS) assert.ok(l.props.some((p) => p.id === id), `${id} missing`);
    assert.ok(l.zones.some((z) => z.id === "stage"), "the deck's zone id must be stage (stage voice)");
    assert.ok(l.zones.length >= 3 && l.zones.length <= 7);
    const door = l.props.find((p) => p.id === "entry-map-table");
    assert.ok(door.x + 2 === l.spawn.x && door.y === 16 && door.w === 2 && door.h === 1, "the door sits two tiles left of the spawn");
    const fountain = l.props.find((p) => p.id === "courtyard-fountain");
    assert.equal(fountain.kind, "fountain");
    // Not solid: the admin of a Game Time lists the solid props as places to hide a box, so the featured event's plinth never hides one.
    assert.ok(!fountain.solid && fountain.w * fountain.h >= 2, "the fountain plinth is a floor prop of at least 2 tiles");
    assert.ok(!l.props.some((p) => p.solid && p.kind === "fountain"), "no solid fountain");
    for (const z of l.zones) {
      assert.ok(canWalkScene(l, z.stop) && scenePath(l, l.spawn, z.stop), `${z.id} stop is not walkable or reachable`);
      assert.ok(canWalkScene(l, z.plaque), `${z.id} tag tile is not on open floor`);
      assert.ok(z.stop.x >= z.x && z.stop.x < z.x + z.w && z.stop.y >= z.y && z.stop.y < z.y + z.h, `${z.id} stop is outside it`);
    }
    for (const a of l.zones) for (const b of l.zones) if (a.id < b.id) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `zones ${a.id} and ${b.id} overlap`);
    let walkable = 0; let reached = 0;
    for (let y = 1; y < l.grid.height - 1; y++) for (let x = 1; x < width - 1; x++) if (canWalkScene(l, { x, y })) { walkable++; if (scenePath(l, l.spawn, { x, y })) reached++; }
    assert.ok(walkable >= 120 && walkable - reached <= 2, `${walkable} walkable, ${walkable - reached} sealed off`);
    // The Experiences zone offers its Instagram link through the room's action pill, and nothing else has a link.
    const linked = l.zones.filter((z) => z.link);
    assert.equal(linked.length, 1);
    assert.equal(linked[0].id, "experiences");
    assert.equal(JSON.stringify(linked[0].link), JSON.stringify({ label: "OPEN INSTAGRAM", url: "https://www.instagram.com/emergencyroombysos/" }));
    // Nothing is solid in the lane between the gate and the deck, so a crowd can walk it.
    for (let y = 13; y <= 17; y++) assert.ok(canWalkScene(l, { x: l.spawn.x, y }), `the lane at ${l.spawn.x},${y} is blocked`);
  });
}
check("The Emergency Room's wide layout keeps every section of the narrow one and only adds floor", () => {
  const a = erTemplate.layout(30);
  const b = erTemplate.layout(36);
  assert.equal(JSON.stringify(a.props.map((p) => [p.id, p.kind, p.w, p.h]).sort()), JSON.stringify(b.props.map((p) => [p.id, p.kind, p.w, p.h]).sort()));
  assert.equal(JSON.stringify(a.zones.map((z) => z.id)), JSON.stringify(b.zones.map((z) => z.id)));
  for (const z of a.zones) assert.equal(z.name, b.zones.find((q) => q.id === z.id).name);
});
if (failures.length) {
  console.log(`\n${passed} campaign checks passed, ${failures.length} FAILED:`);
  for (const label of failures) console.log(`  - ${label}`);
  process.exit(1);
}
console.log(`${passed} campaign checks passed.`);
