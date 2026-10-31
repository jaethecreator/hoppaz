/**
 * Submits the four WhatsApp templates to Meta for review. Jae runs this himself, on his own machine, from the repo root:
 *
 *   node --no-warnings scripts/whatsapp-setup.mts              dry run (the default): prints what it would send, sends nothing, needs no keys
 *   node --no-warnings scripts/whatsapp-setup.mts --send       really submits them
 *
 * Needs, for --send only, in the environment of the terminal (never in a file in git, never in chat):
 *   WHATSAPP_TOKEN    the system user token from Business settings (permission whatsapp_business_management)
 *   WHATSAPP_WABA_ID  the WhatsApp Business Account id, from WhatsApp Manager
 *
 * Safe to run again: for each template it asks Meta whether one with that name and language already exists, and leaves it alone if so (it
 * prints the status Meta gives it). It never edits or deletes a template. It prints no key, no token and no number: only which variables are set.
 * The templates are in src/lib/notify/watemplates.ts; all four are category UTILITY, English, with a "View ticket" URL button.
 * Meta's endpoint (checked 31 Oct 2026): POST https://graph.facebook.com/v26.0/{WABA_ID}/message_templates, and GET on the same path with ?name=.
 * Review takes up to 24 hours; watch the status in WhatsApp Manager, then switch notify_whatsapp on (docs/reminders-whatsapp-plan.md).
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
      for (const cand of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(fileURLToPath(cand))) return nextResolve(cand, context);
    }
    if (specifier.startsWith(".") && context.parentURL && !/\.[mc]?[jt]s$/.test(specifier)) {
      const base = new URL(specifier, context.parentURL).href;
      for (const cand of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(fileURLToPath(cand))) return nextResolve(cand, context);
    }
    return nextResolve(specifier, context);
  },
});

const { WA_TEMPLATES, creationPayload, templateProblems } = await import("../src/lib/notify/watemplates.ts");
const { GRAPH_BASE, GRAPH_VERSION, scrub } = await import("../src/lib/notify/whatsapp.ts");

const args = process.argv.slice(2);
const known = new Set(["--dry-run", "--send"]);
const unknown = args.filter((a) => !known.has(a));
if (unknown.length || (args.includes("--send") && args.includes("--dry-run"))) {
  console.error("Use --dry-run (the default) or --send, not both. Nothing was sent.");
  process.exit(2);
}
const send = args.includes("--send");

const token = process.env.WHATSAPP_TOKEN?.trim() ?? "";
const waba = process.env.WHATSAPP_WABA_ID?.trim() ?? "";
console.log(send ? "SEND MODE: the templates will be submitted to Meta." : "DRY RUN: nothing is sent, no network is used.");
console.log(`WHATSAPP_TOKEN: ${token ? "set" : "not set"}   WHATSAPP_WABA_ID: ${/^\d{5,30}$/.test(waba) ? "set" : waba ? "set but not digits" : "not set"}`);

let problems = 0;
for (const t of WA_TEMPLATES) {
  const issues = templateProblems(t);
  console.log(`\n${t.name}  (${t.category}, ${t.language})`);
  console.log(`  body: ${t.body}`);
  console.log(`  samples: ${t.samples.map((s) => `"${s}"`).join(", ")}`);
  console.log(`  button: "View ticket" -> https://hoppaz.fun/event/{{1}}  (sample "${t.buttonSample}")`);
  for (const i of issues) {
    problems++;
    console.log(`  WARNING: ${i}`);
  }
  if (!send) console.log(`  would send: POST ${GRAPH_BASE}/${GRAPH_VERSION}/<WHATSAPP_WABA_ID>/message_templates (after asking Meta whether ${t.name} exists)\n  ${JSON.stringify(creationPayload(t))}`);
}
if (problems) console.log(`\n${problems} warning(s) above: Meta's documentation says it will refuse a body that starts or ends with a variable. Nothing is changed by the warning.`);

if (!send) {
  console.log("\nDry run done. Add --send to submit.");
  process.exit(0);
}
if (!token || !/^\d{5,30}$/.test(waba)) {
  console.error("\nWHATSAPP_TOKEN and WHATSAPP_WABA_ID (digits) must be set in this terminal. Nothing was sent.");
  process.exit(1);
}

const base = `${GRAPH_BASE}/${GRAPH_VERSION}/${waba}/message_templates`;
const auth = { Authorization: `Bearer ${token}` };

async function call(url: string, init: RequestInit): Promise<{ status: number; json: Record<string, unknown> }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

const why = (json: Record<string, unknown>) => {
  const e = (json.error ?? {}) as Record<string, unknown>;
  return scrub(`${e.code ?? "?"}${e.error_subcode ? `/${e.error_subcode}` : ""}: ${e.error_user_msg ?? e.message ?? "no message"}`);
};

let failed = 0;
for (const t of WA_TEMPLATES) {
  try {
    const found = await call(`${base}?name=${encodeURIComponent(t.name)}&fields=name,status,language`, { headers: auth });
    if (found.status !== 200) {
      failed++;
      console.log(`${t.name}: could not check if it exists (${why(found.json)}). Not submitted.`);
      continue;
    }
    const existing = (Array.isArray(found.json.data) ? (found.json.data as Record<string, unknown>[]) : []).find((d) => d.name === t.name && String(d.language).startsWith("en"));
    if (existing) {
      console.log(`${t.name}: already exists, status ${String(existing.status)}. Left alone.`);
      continue;
    }
    const made = await call(base, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(creationPayload(t)) });
    if (made.status >= 200 && made.status < 300) console.log(`${t.name}: submitted (status ${String(made.json.status ?? "sent for review")}).`);
    else {
      failed++;
      console.log(`${t.name}: Meta refused it (${made.status}) ${why(made.json)}`);
    }
  } catch (e) {
    failed++;
    console.log(`${t.name}: ${(e as Error).name === "AbortError" ? "timed out" : "network error"}. Run again to retry; templates already submitted are left alone.`);
  }
}
console.log(failed ? `\n${failed} template(s) not submitted.` : "\nAll four are submitted or already there.");
process.exit(failed ? 1 : 0);
