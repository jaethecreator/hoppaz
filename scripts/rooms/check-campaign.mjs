import assert from "node:assert/strict";
import fs from "node:fs";
import { loadCampaign } from "./load-campaign.mjs";

const { CLUBHOUSE: layout, clubhouseWidth, sceneSize, sceneBlocks, canWalkScene, scenePath, privateAreaAt, validCampaignUrl, EMPTY_CAMPAIGN,
  ROOM_TEMPLATES, ROOM_WIDTHS, TEMPLATE_KEYS, roomTemplate, templateFor } = loadCampaign();
let passed = 0;
function check(label, run) { run(); passed++; console.log(`PASS ${label}`); }
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
console.log(`${passed} campaign checks passed.`);
