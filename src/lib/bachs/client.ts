// Server only (it reads BACHS_SECRET_KEY). The `server-only` package is not installed here, so never import this from a client component.
import type { BachsErrorKind } from "./types";

/**
 * The one fetch wrapper for Bachs. Base URL and key come from the environment (BACHS_API_BASE, BACHS_SECRET_KEY).
 *  - Idempotency-Key on every POST (the caller gives a stable one; a retry after a timeout or 5xx reuses it, never a new one).
 *  - x-request-id of every response is logged with the method, path and status. The Authorization header is never logged.
 *  - Errors are mapped on `error_code` into a BachsError with a `kind` the routes can branch on.
 *  - 429: waits Retry-After (at most 5 s) and tries again, up to 2 times. Timeouts and 5xx are retried once, but only when the
 *    call is safe to repeat (a GET, or a POST that carries an Idempotency-Key).
 *  - HARD GUARD: a call that creates a charge (checkout session) without an X-Account-Id that starts with acct_ is refused
 *    before anything leaves the building. Bachs silently ignores a misspelled header and would charge Hoppaz's own balance.
 */

const ACCOUNT_ID = /^acct_[A-Za-z0-9_]{6,64}$/;
/** POSTs that create a charge or move money for a host. They must name the host account. */
const NEEDS_ACCOUNT = [/^\/v1\/checkout-sessions\/?$/];

export class BachsError extends Error {
  readonly kind: BachsErrorKind;
  readonly status: number;
  readonly errorCode: string | null;
  readonly requestId: string | null;
  readonly fieldErrors: unknown;
  // No constructor parameter properties: the checks run this file under Node's type stripping, which does not allow them.
  constructor(kind: BachsErrorKind, message: string, status: number, errorCode: string | null = null, requestId: string | null = null, fieldErrors: unknown = null) {
    super(message);
    this.name = "BachsError";
    this.kind = kind;
    this.status = status;
    this.errorCode = errorCode;
    this.requestId = requestId;
    this.fieldErrors = fieldErrors;
  }
  /** Worth trying again later with the same idempotency key. */
  get retryable() {
    return this.kind === "unavailable" || this.kind === "rate_limited";
  }
}

export type BachsConfig = { apiBase: string; secretKey: string };

export function bachsConfig(env: Record<string, string | undefined> = process.env): BachsConfig | null {
  const secretKey = env.BACHS_SECRET_KEY;
  if (!secretKey) return null;
  return { apiBase: (env.BACHS_API_BASE || "https://sandbox-api.bachs.io").replace(/\/+$/, ""), secretKey };
}

export const isAccountId = (v: unknown): v is string => typeof v === "string" && ACCOUNT_ID.test(v);

export type RequestOptions = {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** The host's Bachs account: sent as X-Account-Id (acts as that account, direct charge). */
  accountId?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
};

export type ClientDeps = {
  config?: BachsConfig | null;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function kindFor(status: number, code: string | null): BachsErrorKind {
  if (code === "PAYMENT_METHOD_NOT_ALLOWED" || code === "PAYMENT_METHOD_NOT_ENABLED" || code === "ACCOUNT_PAYMENT_METHODS_RESTRICTED" || code === "CONNECTED_ACCOUNT_PLATFORM_SUSPENDED" || code === "CONNECTED_ACCOUNT_NOT_ELIGIBLE_FOR_LINK") return "host_not_ready";
  if (code === "IDEMPOTENCY_CONFLICT" || code === "IDEMPOTENCY_IN_PROGRESS") return "conflict";
  if (code === "INSUFFICIENT_BALANCE") return "insufficient_balance";
  if (code === "INVALID_PLATFORM_FEE" || code === "CONTRADICTORY_CHARGE_TYPE") return "invalid";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "invalid";
}

/** Throws before any network call when the request breaks the account rules. Exported so tests can show the guard. */
export function guardRequest(method: string, path: string, accountId: string | undefined): void {
  if (accountId !== undefined && !isAccountId(accountId)) {
    throw new BachsError("guard", "X-Account-Id must be a host account id (acct_...)", 0);
  }
  if (method === "POST" && !accountId && NEEDS_ACCOUNT.some((re) => re.test(path.split("?")[0]))) {
    throw new BachsError("guard", `Refusing ${method} ${path}: a charge needs X-Account-Id (acct_...)`, 0);
  }
}

export async function bachsRequest<T>(method: "GET" | "POST" | "PATCH", path: string, opts: RequestOptions = {}, deps: ClientDeps = {}): Promise<T> {
  guardRequest(method, path, opts.accountId);
  const config = deps.config === undefined ? bachsConfig() : deps.config;
  if (!config) throw new BachsError("auth", "Bachs is not configured (BACHS_SECRET_KEY)", 0);
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const log = deps.log ?? ((line: string) => console.log(line));

  const qs = opts.query
    ? "?" + Object.entries(opts.query).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")
    : "";
  const url = `${config.apiBase}${path}${qs}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${config.secretKey}`, Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.accountId) headers["X-Account-Id"] = opts.accountId;
  if (method !== "GET" && opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const safeToRepeat = method === "GET" || !!opts.idempotencyKey;

  let attempts = 0;
  let rateLimited = 0;
  for (;;) {
    attempts++;
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
        cache: "no-store",
      });
    } catch (e) {
      log(`[bachs] ${method} ${path} -> network error (${(e as Error).name})`);
      if (safeToRepeat && attempts < 2) continue;
      throw new BachsError("unavailable", "Bachs did not answer", 0);
    }
    const requestId = res.headers.get("x-request-id");
    log(`[bachs] ${method} ${path} -> ${res.status} req=${requestId ?? "-"}`);
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.ok) return json as T;

    if (res.status === 429 && rateLimited < 2) {
      rateLimited++;
      const wait = Math.min(5000, Math.max(250, Number(res.headers.get("retry-after") ?? "1") * 1000 || 1000));
      await sleep(wait);
      continue;
    }
    if (res.status >= 500 && safeToRepeat && attempts < 2) {
      await sleep(400);
      continue;
    }
    const code = typeof json?.error_code === "string" ? json.error_code : null;
    const detail = typeof json?.detail === "string" ? json.detail : `Bachs answered ${res.status}`;
    throw new BachsError(kindFor(res.status, code), detail, res.status, code, requestId, json?.errors ?? null);
  }
}
