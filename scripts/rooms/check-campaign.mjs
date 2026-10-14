import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const file = "src/lib/campaign/layout.ts";
const source = fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { exports: {}, URL };
vm.runInNewContext(js, context, { filename: file });
const { CLUBHOUSE: layout, clubhouseWidth, sceneSize, sceneBlocks, canWalkScene, scenePath, privateAreaAt, validCampaignUrl, EMPTY_CAMPAIGN } = context.exports;
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
  assert.equal(EMPTY_CAMPAIGN.brand, "360 Playlist");
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
console.log(`${passed} campaign checks passed.`);
