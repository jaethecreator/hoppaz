/**
 * Plain checks for scripts/notify-test-send.mts (the script that sends real test emails to Jae's own inbox). No network, no key, no real
 * call: the script is run in a temporary folder with a FAKE fetch preloaded, and with a clean environment. Run from the repo root:
 *   node --no-warnings scripts/notify-test-send-check.mts
 * Covers: the refusals, the dry run, a missing key, the real provider code paths with the fake fetch (what is posted, to whom, the [TEST]
 * subject, the sender), the failure messages and hints, that no fake key ever reaches the output, the key file reader, and that other env
 * files (.env.local first of all) are never read.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));

let pass = 0;
let fail = 0;
const ok = (c: unknown, what: string) => {
  if (!c) throw new Error(what);
};
const eq = (a: unknown, b: unknown, what: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
function test(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL ${name}\n     ${(e as Error).message}`);
  }
}

// ------------------------------------------------------------------ a copy of the repo layout the script can run in ---
// The script finds its keys file next to ../src, so it runs here from a temporary root that has its own scripts/ and a link to the real src/.
const root = mkdtempSync(join(tmpdir(), "notify-test-send-"));
mkdirSync(join(root, "scripts"));
cpSync(join(repo, "scripts", "notify-test-send.mts"), join(root, "scripts", "notify-test-send.mts"));
symlinkSync(join(repo, "src"), join(root, "src"));
const logFile = join(root, "requests.json");

// The fake fetch. STUB_MODE picks the answer; every request is appended to STUB_LOG (the key itself is only recorded as "was sent").
writeFileSync(
  join(root, "stub.mjs"),
  `import { appendFileSync } from "node:fs";
const mode = process.env.STUB_MODE || "ok";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (url, init) => {
  const headers = init.headers || {};
  const raw = JSON.stringify(headers);
  const entry = { url: String(url), body: JSON.parse(init.body), keyInHeaders: process.env.STUB_KEYS.split(",").some((k) => k && raw.includes(k)) || /Basic /.test(raw) };
  appendFileSync(process.env.STUB_LOG, JSON.stringify(entry) + "\\n");
  if (mode === "network") throw new Error("getaddrinfo ENOTFOUND");
  const brevo = String(url).includes("brevo");
  const mailjet = String(url).includes("mailjet");
  if (mode === "ip") return json(401, { code: "unauthorized", message: "We have detected you are using an unrecognised IP address 203.0.113.9. If you performed this action make sure to add the new IP address in this link: https://app.brevo.com/security/authorised_ips" });
  if (mode === "domain") return mailjet ? json(400, { Messages: [{ Status: "error", Errors: [{ ErrorCode: "mj-0013", ErrorMessage: "Sender domain is not verified", ErrorRelatedTo: ["From"] }] }] }) : json(400, { code: "invalid_parameter", message: "Sender is not valid, domain not verified" });
  if (mode === "review") return json(403, { code: "permission_denied", message: "Your account is under review, sending is not activated yet" });
  if (mode === "echo") return json(400, { code: "invalid_parameter", message: "rejected " + process.env.STUB_KEYS.split(",")[0] });
  if (brevo) return json(201, { messageId: "<fake-brevo-id@test>" });
  if (mailjet) return json(200, { Messages: [{ Status: "success", To: [{ Email: init.body && JSON.parse(init.body).Messages[0].To[0].Email, MessageID: 4242, MessageUUID: "u" }] }] });
  return json(200, { success: true, message_ids: ["fake-trap-id"] });
};
`,
);

const FAKE = { brevo: "xkeysib-FAKEBREVO1234567890", mjPub: "FAKEMJPUBLIC1234567", mjSec: "FAKEMJSECRET7654321", trap: "FAKETRAPTOKEN9988776655" };
const ALL_FAKE = Object.values(FAKE);
const FULL_FILE = `# test keys\nBREVO_API_KEY=${FAKE.brevo}\nMAILJET_API_KEY="${FAKE.mjPub}"\nexport MAILJET_SECRET_KEY='${FAKE.mjSec}'  \nMAILTRAP_API_KEY=${FAKE.trap} # trailing note\n`;

type Run = { code: number; out: string; reqs: { url: string; body: any; keyInHeaders: boolean }[] };
function run(args: string[], opts: { file?: string | null; env?: Record<string, string>; mode?: string; stub?: boolean } = {}): Run {
  rmSync(logFile, { force: true });
  const keysFile = join(root, ".env.notify-test");
  rmSync(keysFile, { force: true });
  if (opts.file != null) writeFileSync(keysFile, opts.file);
  const stub = opts.stub !== false;
  const res = spawnSync(process.execPath, ["--no-warnings", ...(stub ? ["--import", join(root, "stub.mjs")] : []), join(root, "scripts", "notify-test-send.mts"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", STUB_LOG: logFile, STUB_MODE: opts.mode ?? "ok", STUB_KEYS: ALL_FAKE.join(","), ...(opts.env ?? {}) },
    timeout: 30_000,
  });
  const reqs = existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { code: res.status ?? -1, out: `${res.stdout}${res.stderr}`, reqs };
}
const noKeyShown = (r: Run) => ALL_FAKE.every((k) => !r.out.includes(k) && !r.out.includes(k.slice(0, 8)));
const TO = "jae@example.com";

// ------------------------------------------------------------------ refusals ---
test("refuses anything that is not one valid address, a missing or unknown provider, unknown flags; sends nothing", () => {
  const bad: string[][] = [
    [],
    ["--provider", "brevo"],
    ["--to", TO],
    ["--to", TO, "--provider", "sendgrid"],
    ["--to", "a@example.com,b@example.com", "--provider", "brevo", "--send"],
    ["--to", "a@example.com;b@example.com", "--provider", "brevo", "--send"],
    ["--to", "a@example.com b@example.com", "--provider", "brevo", "--send"],
    ["--to", "Jae <jae@example.com>", "--provider", "brevo", "--send"],
    ["--to", "not-an-address", "--provider", "brevo", "--send"],
    ["--to", "jae@example", "--provider", "brevo", "--send"],
    ["--to", "--send", "--provider", "brevo"],
    ["--to", TO, "--provider", "brevo", "--send", "--everyone"],
    ["--to", TO, "--provider", "brevo", "extra@example.com"],
  ];
  for (const args of bad) {
    const r = run(args, { file: FULL_FILE });
    eq(r.code, 2, `exit code for ${JSON.stringify(args)}`);
    eq(r.reqs.length, 0, `requests for ${JSON.stringify(args)}`);
    ok(/Nothing was sent/.test(r.out), `says nothing was sent for ${JSON.stringify(args)}`);
    ok(noKeyShown(r), "no key shown");
  }
});

// ------------------------------------------------------------------ dry run ---
test("dry run (default): prints from, to, provider, subjects and key yes/no; sends nothing; works with no fetch at all", () => {
  for (const [provider, n] of [["brevo", 2], ["mailjet", 3], ["mailtrap", 1]] as const) {
    const r = run(["--to", TO, "--provider", provider], { file: FULL_FILE, stub: false });
    eq(r.code, 0, `${provider} exit`);
    ok(/DRY RUN/.test(r.out) && /Dry run done/.test(r.out), "says it is a dry run");
    ok(r.out.includes(`Provider: ${provider}`) && r.out.includes(`To: ${TO}`), "provider and to");
    ok(/Key present: yes/.test(r.out), `${provider} key yes`);
    eq((r.out.match(/^ {2}\d\. \[TEST\] /gm) ?? []).length, n, `${provider} number of emails`);
    ok(/from Hoppaz <(tickets@mail|codes@auth)\.hoppaz\.fun>/.test(r.out), "from shown");
    ok(!/Sent:|Failed:/.test(r.out), "no send lines");
    ok(noKeyShown(r), "no key shown");
  }
});

test("dry run says no when the key is missing, and names only the variable", () => {
  const r = run(["--to", TO, "--provider", "mailjet"], { file: `MAILJET_API_KEY=${FAKE.mjPub}\n`, stub: false });
  eq(r.code, 0, "exit");
  ok(/Key present: no \(missing MAILJET_SECRET_KEY\)/.test(r.out), "says what is missing");
  ok(noKeyShown(r), "no key shown");
});

// ------------------------------------------------------------------ missing key with --send ---
test("--send with the key missing: no request, plain message, exit 1", () => {
  const r = run(["--to", TO, "--provider", "brevo", "--send"], { file: null });
  eq(r.code, 1, "exit");
  eq(r.reqs.length, 0, "requests");
  ok(/Failed: Brevo key missing/.test(r.out) && /\.env\.notify-test/.test(r.out), "message");
});

// ------------------------------------------------------------------ the real provider code, fake fetch ---
test("--send brevo: the ticket confirmation and the 24 hour reminder through the real Brevo code, [TEST] subject, one recipient", () => {
  const r = run(["--to", TO, "--provider", "brevo", "--send"], { file: FULL_FILE });
  eq(r.code, 0, "exit");
  eq(r.reqs.length, 2, "requests");
  for (const q of r.reqs) {
    eq(q.url, "https://api.brevo.com/v3/smtp/email", "url");
    eq(q.body.to, [{ email: TO }], "one recipient");
    eq(q.body.sender.email, "tickets@mail.hoppaz.fun", "sender");
    ok(q.body.subject.startsWith("[TEST] "), "subject prefix");
    ok(q.keyInHeaders, "the key went in the request");
    ok(q.body.htmlContent.length > 500 && q.body.textContent.length > 50, "html and text rendered");
  }
  eq(r.reqs.map((q) => q.body.subject), ["[TEST] You're going to Afro Soirée", "[TEST] Tomorrow: Afro Soirée"], "subjects");
  ok(r.reqs[0].body.htmlContent.includes("/api/notify/qr?t="), "the confirmation carries the QR picture");
  ok(r.reqs[1].body.headers["List-Unsubscribe"].includes("/unsubscribe/preview-only"), "reminder has the made-up unsubscribe link");
  eq((r.out.match(/^Sent: .* via brevo, check your inbox and spam folder$/gm) ?? []).length, 2, "sent lines");
  ok(/QR/.test(r.out), "says the QR picture needs the deploy");
  ok(noKeyShown(r), "no key shown");
});

test("--send mailjet: confirmation, reminder and the sign-in code email (from the codes address), 3 requests", () => {
  const r = run(["--to", TO, "--provider", "mailjet", "--send"], { file: FULL_FILE });
  eq(r.code, 0, "exit");
  eq(r.reqs.length, 3, "requests");
  for (const q of r.reqs) {
    eq(q.url, "https://api.mailjet.com/v3.1/send", "url");
    eq(q.body.Messages.length, 1, "one message");
    eq(q.body.Messages[0].To, [{ Email: TO }], "one recipient");
    ok(q.body.Messages[0].Subject.startsWith("[TEST] "), "subject prefix");
    ok(q.keyInHeaders, "the key went in the request");
  }
  eq(r.reqs.map((q) => q.body.Messages[0].From.Email), ["tickets@mail.hoppaz.fun", "tickets@mail.hoppaz.fun", "codes@auth.hoppaz.fun"], "senders");
  eq(r.reqs[2].body.Messages[0].Subject, "[TEST] Your Hoppaz code is 482913", "code subject");
  eq((r.out.match(/^Sent: /gm) ?? []).length, 3, "sent lines");
  ok(noKeyShown(r), "no key shown");
});

test("--send mailtrap: only the sign-in code email", () => {
  const r = run(["--to", TO, "--provider", "mailtrap", "--send"], { file: FULL_FILE });
  eq(r.code, 0, "exit");
  eq(r.reqs.length, 1, "requests");
  eq(r.reqs[0].url, "https://send.api.mailtrap.io/api/send", "url");
  eq(r.reqs[0].body.to, [{ email: TO }], "one recipient");
  eq(r.reqs[0].body.from.email, "codes@auth.hoppaz.fun", "sender");
  eq(r.reqs[0].body.subject, "[TEST] Your Hoppaz code is 482913", "subject");
  ok(r.reqs[0].keyInHeaders, "the key went in the request");
  ok(!/QR/.test(r.out), "no QR note without the confirmation");
  ok(noKeyShown(r), "no key shown");
});

test("never more than 3 emails in a run, and the --to=value form works", () => {
  for (const provider of ["brevo", "mailjet", "mailtrap"]) {
    const r = run([`--to=${TO}`, `--provider=${provider}`, "--send"], { file: FULL_FILE });
    ok(r.reqs.length >= 1 && r.reqs.length <= 3, `${provider} sent ${r.reqs.length}`);
  }
});

// ------------------------------------------------------------------ failures ---
test("Brevo unknown IP: Failed line with the provider's words, a plain hint, exit 1", () => {
  const r = run(["--to", TO, "--provider", "brevo", "--send"], { file: FULL_FILE, mode: "ip" });
  eq(r.code, 1, "exit");
  ok((r.out.match(/^Failed: \[TEST\] .* via brevo: brevo 401/gm) ?? []).length === 2, "two Failed lines");
  ok(/Authorised IPs/.test(r.out), "hint");
  ok(!/^Sent:/m.test(r.out), "no Sent line");
  ok(noKeyShown(r), "no key shown");
});

test("domain not verified, and account under review: the right hints", () => {
  const d = run(["--to", TO, "--provider", "mailjet", "--send"], { file: FULL_FILE, mode: "domain" });
  eq(d.code, 1, "exit");
  ok(/not verified at Mailjet yet/.test(d.out), "domain hint");
  const u = run(["--to", TO, "--provider", "brevo", "--send"], { file: FULL_FILE, mode: "review" });
  eq(u.code, 1, "exit");
  ok(/may still be under review/.test(u.out), "review hint");
  ok(noKeyShown(d) && noKeyShown(u), "no key shown");
});

test("network failure and a provider that quotes the key back: exit 1, key hidden", () => {
  const n = run(["--to", TO, "--provider", "mailtrap", "--send"], { file: FULL_FILE, mode: "network" });
  eq(n.code, 1, "exit");
  ok(/Failed: .* via mailtrap: mailtrap: network error/.test(n.out) && /internet connection/.test(n.out), "network message and hint");
  const e = run(["--to", TO, "--provider", "brevo", "--send"], { file: FULL_FILE, mode: "echo" });
  eq(e.code, 1, "exit");
  ok(e.out.includes("[hidden]"), "key replaced");
  ok(noKeyShown(n) && noKeyShown(e), "no key shown");
});

// ------------------------------------------------------------------ keys ---
test("keys: quotes, comments and export are read; the terminal's environment is the fallback; the file wins", () => {
  const a = run(["--to", TO, "--provider", "mailjet", "--send"], { file: FULL_FILE });
  eq(a.code, 0, "file with quotes, export and comments");
  const b = run(["--to", TO, "--provider", "brevo", "--send"], { file: null, env: { BREVO_API_KEY: FAKE.brevo } });
  eq(b.code, 0, "environment only");
  const c = run(["--to", TO, "--provider", "brevo", "--send"], { file: "BREVO_API_KEY=\n", env: { BREVO_API_KEY: FAKE.brevo } });
  eq(c.code, 0, "empty value in the file falls back to the environment");
  const d = run(["--to", TO, "--provider", "mailtrap", "--send"], { file: `MAILTRAP_API_KEY=${FAKE.trap}\n`, env: { MAILTRAP_API_KEY: "FROMENVNOTFILE" }, mode: "echo" });
  ok(d.reqs.length === 1 && !d.out.includes("FROMENVNOTFILE"), "the file value is used");
});

test("keys: .env.local, .env and every other env file are never read", () => {
  writeFileSync(join(root, ".env.local"), `BREVO_API_KEY=${FAKE.brevo}\nMAILJET_API_KEY=${FAKE.mjPub}\nMAILJET_SECRET_KEY=${FAKE.mjSec}\nMAILTRAP_API_KEY=${FAKE.trap}\n`);
  writeFileSync(join(root, ".env"), `BREVO_API_KEY=${FAKE.brevo}\n`);
  writeFileSync(join(root, ".env.production"), `BREVO_API_KEY=${FAKE.brevo}\n`);
  for (const provider of ["brevo", "mailjet", "mailtrap"]) {
    const r = run(["--to", TO, "--provider", provider, "--send"], { file: null });
    eq(r.code, 1, `${provider} exit`);
    eq(r.reqs.length, 0, `${provider} requests`);
    ok(/key missing/.test(r.out), `${provider} says the key is missing`);
  }
  const src = readFileSync(join(repo, "scripts", "notify-test-send.mts"), "utf8");
  ok(!/\.env\.local/.test(src.replace(/\/\*\*[\s\S]*?\*\//, "").replace(/\/\/.*$/gm, "")), "the code never names .env.local");
});

// ------------------------------------------------------------------ the repo itself ---
test("git ignores .env.notify-test and not the example", () => {
  const ignored = spawnSync("git", ["check-ignore", "-q", ".env.notify-test"], { cwd: repo });
  eq(ignored.status, 0, ".env.notify-test is ignored");
  const example = spawnSync("git", ["check-ignore", "-q", ".env.notify-test.example"], { cwd: repo });
  eq(example.status, 1, ".env.notify-test.example is not ignored");
  const text = readFileSync(join(repo, ".env.notify-test.example"), "utf8");
  eq(text.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.trim()), ["BREVO_API_KEY=", "MAILJET_API_KEY=", "MAILJET_SECRET_KEY=", "MAILTRAP_API_KEY="], "the example has the four empty keys");
});

test("no em dashes in the script, the check or the example", () => {
  for (const f of ["scripts/notify-test-send.mts", "scripts/notify-test-send-check.mts", ".env.notify-test.example"]) {
    ok(!readFileSync(join(repo, f), "utf8").includes(String.fromCharCode(0x2014)), `${f} has an em dash`);
  }
});

rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
