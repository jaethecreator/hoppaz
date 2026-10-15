// Draws a room's art to a PNG with no browser, so a room can be looked at (and checked) while it is being written.
//   node scripts/rooms/render-room.mjs event-indoor            -> <out>/event-indoor.png
//   node scripts/rooms/render-room.mjs all                     -> every registered room
//   node scripts/rooms/render-room.mjs event-indoor --props    -> also outlines every prop box and the walkable grid
// Output goes to $ROOM_OUT or ./.room-renders (git-ignored); ROOM_DENSITY=192 gives a 1920 px wide image (default 96, 1280 px). It loads the TSX with TypeScript's transpiler and
// renders to static SVG with react-dom/server, then rasterises with sharp: fonts are the system's, so type is only roughly
// right; the shapes are exact.
import Module, { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(root, "src", request.slice(2));
  return origResolve.call(this, request, ...rest);
};
for (const ext of [".ts", ".tsx"]) {
  Module._extensions[ext] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const out = ts.transpileModule(source, { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
    module._compile(out.outputText, filename);
  };
}

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { default: RoomArt } = require(path.join(root, "src/components/campaign/roomArt.tsx"));
const { ALL_PLACE_ROOMS } = require(path.join(root, "src/lib/campaign/templates.ts"));

const args = process.argv.slice(2);
const outDir = process.env.ROOM_OUT || path.join(root, ".room-renders");
fs.mkdirSync(outDir, { recursive: true });
const wanted = args.filter((a) => !a.startsWith("--"));
const withProps = args.includes("--props");
const sample = { title: "Sample Night", line: "Fri 16 Oct · 8pm", flyerUrl: null, lineup: [{ name: "DJ One", time: "9PM" }, { name: "DJ Two", time: "11PM" }, { name: "Headliner", time: "1AM" }] };

const rooms = ALL_PLACE_ROOMS.filter((r) => wanted.includes("all") || wanted.includes(r.key));
if (!rooms.length) {
  console.error(`No room matches ${wanted.join(", ") || "(nothing)"}. Known: ${ALL_PLACE_ROOMS.map((r) => r.key).join(", ")}`);
  process.exit(1);
}
for (const room of rooms) {
  const layout = room.layout;
  const art = renderToStaticMarkup(React.createElement(RoomArt, { layout, uid: "r", brand: room.name, content: sample }));
  let svg = art;
  if (withProps) {
    const t = layout.grid.tile;
    const boxes = layout.props.map((p) => `<rect x="${p.x * t}" y="${p.y * t}" width="${p.w * t}" height="${p.h * t}" fill="${p.solid ? "rgba(255,0,0,.18)" : "rgba(0,160,255,.18)"}" stroke="${p.solid ? "#f00" : "#09f"}" stroke-width="1"/><text x="${p.x * t + 2}" y="${p.y * t + 9}" font-size="8" fill="#fff" stroke="#000" stroke-width=".4">${p.id}</text>`).join("");
    const walls = layout.walls.map((w) => `<rect x="${w.x * t}" y="${w.y * t}" width="${w.w * t}" height="${w.h * t}" fill="rgba(255,255,0,.18)" stroke="#ff0" stroke-width="1"/>`).join("");
    const zones = layout.zones.map((z) => `<circle cx="${(z.stop.x + 0.5) * t}" cy="${(z.stop.y + 0.5) * t}" r="6" fill="#0f0" stroke="#000"/><text x="${z.plaque.x * t}" y="${z.plaque.y * t + 10}" font-size="9" fill="#fff" stroke="#000" stroke-width=".5">${z.name}</text>`).join("");
    const spawn = `<circle cx="${(layout.spawn.x + 0.5) * t}" cy="${(layout.spawn.y + 0.5) * t}" r="7" fill="#f0f" stroke="#000"/>`;
    svg = art.replace(/<\/svg>\s*$/, `${walls}${boxes}${zones}${spawn}</svg>`);
  }
  const file = path.join(outDir, `${room.key}${withProps ? "-boxes" : ""}.png`);
  await sharp(Buffer.from(svg), { density: Number(process.env.ROOM_DENSITY) || 96 }).png().toFile(file);
  console.log(file);
}
