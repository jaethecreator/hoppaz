import { createLogProvider } from "./log";
import type { EmailProvider } from "./provider";

/**
 * Which providers this deployment can use, in the order they are tried.
 *
 * NOTIFY_PROVIDERS is a comma list of names, for example "brevo,mailjet". Only "log" exists so far (the real ones are later steps).
 * With nothing set, fake mode (NEXT_PUBLIC_EVENTS_R1_FAKE=1) uses "log" and everything else uses none, and the run route then
 * answers 503 without claiming a row. "log" sends nothing at all, so it is refused in production unless fake mode is on.
 */
type Env = Record<string, string | undefined>;

const FACTORIES: Record<string, () => EmailProvider> = {
  log: () => createLogProvider(),
};

export function buildProviders(env: Env = process.env, warn: (line: string) => void = (line) => console.warn(line)): EmailProvider[] {
  const fake = env.NEXT_PUBLIC_EVENTS_R1_FAKE === "1";
  const wanted = (env.NOTIFY_PROVIDERS ?? (fake ? "log" : ""))
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const out: EmailProvider[] = [];
  for (const name of wanted) {
    if (out.some((p) => p.name === name)) continue;
    if (name === "log" && env.NODE_ENV === "production" && !fake) {
      warn("[hoppaz] notify: the log provider sends nothing and is not allowed in production; ignored");
      continue;
    }
    const make = FACTORIES[name];
    if (!make) {
      warn(`[hoppaz] notify: unknown provider "${name}" in NOTIFY_PROVIDERS; ignored`);
      continue;
    }
    out.push(make());
  }
  return out;
}
