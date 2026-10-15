// Loads the room's TypeScript data files (layout.ts, templates.ts and the room files they import) in a bare vm for the
// scripts that check or export them: no Next.js, no bundler. A data file may import its sibling data files by a relative
// path (templates.ts imports ./rooms/eventIndoor and ./layout); anything else it imports must be a type.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = new URL("../../", import.meta.url);
const rootPath = fileURLToPath(root);

const cache = new Map();

function load(file) {
  const abs = path.isAbsolute(file) ? file : path.join(rootPath, file);
  if (cache.has(abs)) return cache.get(abs).exports;
  const source = fs.readFileSync(abs, "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  cache.set(abs, mod);
  const context = {
    exports: mod.exports,
    module: mod,
    URL,
    require: (name) => {
      if (name.startsWith("@/")) return load(resolve(path.join(rootPath, "src", name.slice(2))));
      if (name.startsWith(".")) return load(resolve(path.join(path.dirname(abs), name)));
      throw new Error(`${path.relative(rootPath, abs)} imports ${name}, which the room scripts cannot load`);
    },
  };
  vm.runInNewContext(js, context, { filename: abs });
  return mod.exports;
}

function resolve(base) {
  for (const ext of ["", ".ts", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error(`Cannot find ${base}`);
}

/** Everything layout.ts and templates.ts export, in one object. */
export function loadCampaign() {
  const layout = load("src/lib/campaign/layout.ts");
  const templates = load("src/lib/campaign/templates.ts");
  return { ...layout, ...templates };
}

/** One data file by repo path, for the scripts that read a single module (src/lib/rooms/hotspotRooms.ts). */
export const loadFile = (file) => load(file);
