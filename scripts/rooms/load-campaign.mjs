// Loads the room's TypeScript data files (layout.ts, templates.ts) in a bare vm for the scripts that check or export
// them: no Next.js, no bundler. templates.ts imports "./layout", which is handed over here.
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../../", import.meta.url);

function load(file, modules = {}) {
  const source = fs.readFileSync(new URL(file, root), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const context = {
    exports: module.exports,
    module,
    URL,
    require: (name) => {
      if (name in modules) return modules[name];
      throw new Error(`${file} imports ${name}, which the room scripts cannot load`);
    },
  };
  vm.runInNewContext(js, context, { filename: file });
  return module.exports;
}

/** Everything layout.ts and templates.ts export, in one object. */
export function loadCampaign() {
  const layout = load("src/lib/campaign/layout.ts");
  const templates = load("src/lib/campaign/templates.ts", { "./layout": layout });
  return { ...layout, ...templates };
}
