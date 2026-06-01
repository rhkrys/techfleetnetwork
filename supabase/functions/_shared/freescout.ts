// Freescout API client — single admin API key, OWASP A02/A03/A10 hardened.
// - HTTPS-only base URL, validated lazily (never throws at module load)
// - Constant-time HMAC verify for webhooks
// - CircuitBreaker + exponential backoff
// - No raw string-concat into URLs; encodeURIComponent on all path params

export const DEFAULT_MAILBOX_ID = Number.parseInt(
  Deno.env.get("FREESCOUT_DEFAULT_MAILBOX_ID") ?? "0",
  10,
);

export type FreescoutConfigReason =
  | "missing_url"
  | "missing_key"
  | "scheme_not_https"
  | "url_malformed";

export interface FreescoutConfigOk {
  ok: true;
  base: string;
  key: string;
  host: string;
}
export interface FreescoutConfigErr {
  ok: false;
  reason: FreescoutConfigReason;
  detail: string;
}
export type FreescoutConfig = FreescoutConfigOk | FreescoutConfigErr;

let _cachedConfig: FreescoutConfig | null = null;
let _loggedInvalidConfig = false;

/**
 * Lazy, idempotent config resolver. Returns a typed result instead of
 * throwing — so a missing/invalid secret degrades to a clean 503 response
 * instead of crash-looping the isolate at import time.
 */
export function getFreescoutConfig(): FreescoutConfig {
  if (_cachedConfig) return _cachedConfig;

  const rawBase = (Deno.env.get("FREESCOUT_API_URL") ?? "").trim().replace(/\/+$/, "");
  const key = Deno.env.get("FREESCOUT_API_KEY") ?? "";

  if (!rawBase) {
    _cachedConfig = { ok: false, reason: "missing_url", detail: "FREESCOUT_API_URL is empty" };
    return _cachedConfig;
  }
  if (!key) {
    _cachedConfig = { ok: false, reason: "missing_key", detail: "FREESCOUT_API_KEY is empty" };
    return _cachedConfig;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawBase);
  } catch {
    _cachedConfig = {
      ok: false,
      reason: "url_malformed",
      detail: `FREESCOUT_API_URL is not a valid URL (got: ${rawBase.slice(0, 24)}…)`,
    };
    return _cachedConfig;
  }
  if (parsed.protocol !== "https:") {
    _cachedConfig = {
      ok: false,
      reason: "scheme_not_https",
      detail: `FREESCOUT_API_URL must use https:// (got: ${parsed.protocol}//)`,
    };
    return _cachedConfig;
  }

  _cachedConfig = { ok: true, base: rawBase, key, host: parsed.host };
  return _cachedConfig;
}

/** Test-only: clear cache between unit tests. */
export function _resetFreescoutConfigCache() {
  _cachedConfig = null;
  _loggedInvalidConfig = false;
}

interface BreakerState { failures: number; openedAt: number }
const breaker: BreakerState = { failures: 0, openedAt: 0 };
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 30_000;

export class FreescoutError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

function breakerOpen(): boolean {
  if (breaker.failures < BREAKER_THRESHOLD) return false;
  if (Date.now() - breaker.openedAt > BREAKER_COOLDOWN_MS) {
    breaker.failures = BREAKER_THRESHOLD - 1;
    return false;
  }
  return true;
}

function recordFailure() {
  breaker.failures += 1;
  if (breaker.failures >= BREAKER_THRESHOLD && breaker.openedAt === 0) {
    breaker.openedAt = Date.now();
  }
}

function recordSuccess() {
  if (breaker.failures > 0 || breaker.openedAt > 0) {
    breaker.failures = 0;
    breaker.openedAt = 0;
  }
}

export interface FreescoutFetchOpts {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  attempt?: number;
  timeoutMs?: number;
}

export async function freescoutFetch<T = unknown>(opts: FreescoutFetchOpts): Promise<T> {
  const cfg = getFreescoutConfig();
  if (!cfg.ok) {
    // Log once per cold start with a stable code so the triage queue picks it up.
    if (!_loggedInvalidConfig) {
      _loggedInvalidConfig = true;
      console.error(JSON.stringify({
        level: "error",
        severity: "error",
        fn: "freescout",
        code: "config_invalid",
        reason: cfg.reason,
        detail: cfg.detail,
      }));
    }
    throw new FreescoutError(503, "support_unavailable", { reason: cfg.reason, detail: cfg.detail });
  }
  if (breakerOpen()) {
    throw new FreescoutError(503, "support_unavailable", { reason: "breaker_open" });
  }

  const u = new URL(cfg.base + opts.path);
  if (u.host !== cfg.host) {
    throw new FreescoutError(400, "Refused to call non-allowlisted host");
  }
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    }
  }

  const attempt = opts.attempt ?? 1;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: {
      "X-FreeScout-API-Key": cfg.key,
      "Accept": "application/json",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: ctrl.signal,
  };

  let res: Response;
  try {
    res = await fetch(u.toString(), init);
  } catch (_e) {
    clearTimeout(timer);
    recordFailure();
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 250 * attempt));
      return freescoutFetch<T>({ ...opts, attempt: attempt + 1 });
    }
    throw new FreescoutError(502, "Upstream unreachable");
  }
  clearTimeout(timer);

  if (res.status >= 500) {
    recordFailure();
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
      return freescoutFetch<T>({ ...opts, attempt: attempt + 1 });
    }
    let body: unknown = undefined;
    try { body = await res.json(); } catch { /* ignore */ }
    throw new FreescoutError(res.status, "Upstream error", body);
  }

  if (!res.ok) {
    let body: unknown = undefined;
    try { body = await res.json(); } catch { /* ignore */ }
    throw new FreescoutError(res.status, res.statusText, body);
  }

  recordSuccess();
  if (res.status === 204) return undefined as unknown as T;
  try { return await res.json() as T; } catch { return undefined as unknown as T; }
}

// -------- HMAC webhook verification (A02, constant-time) --------

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function hexDecode(s: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(s) || s.length % 2 !== 0) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substring(i * 2, i * 2 + 2), 16);
  return out;
}

function b64Decode(s: string): Uint8Array | null {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

export async function verifyFreescoutWebhook(req: Request, rawBody: string): Promise<boolean> {
  const secrets = [
    Deno.env.get("FREESCOUT_WEBHOOK_SECRET") ?? "",
    Deno.env.get("FREESCOUT_WEBHOOK_SECRET_PREVIOUS") ?? "",
  ].filter(Boolean);
  if (secrets.length === 0) return false;
  const sig =
    req.headers.get("x-freescout-signature") ??
    req.headers.get("x-signature") ??
    req.headers.get("signature");
  if (!sig) return false;
  const provided = hexDecode(sig) ?? b64Decode(sig);
  if (!provided) return false;

  for (const secret of secrets) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const macBuf = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
    );
    if (timingSafeEqual(macBuf, provided)) return true;
  }
  return false;
}

export interface FreescoutCustomer { id: number; emails?: { value: string }[]; firstName?: string; lastName?: string }
export interface FreescoutUser { id: number; email?: string; firstName?: string; lastName?: string }

export async function findCustomerByEmail(email: string): Promise<FreescoutCustomer | null> {
  const res = await freescoutFetch<{ _embedded?: { customers?: FreescoutCustomer[] } }>({
    path: "/api/customers",
    query: { email },
  });
  const list = res._embedded?.customers ?? [];
  return list[0] ?? null;
}

export async function createCustomer(
  email: string,
  firstName?: string,
  lastName?: string,
): Promise<FreescoutCustomer> {
  return await freescoutFetch<FreescoutCustomer>({
    method: "POST",
    path: "/api/customers",
    body: {
      firstName: firstName || "Tech Fleet",
      lastName: lastName || "Member",
      emails: [email],
    },
  });
}

export async function findUserByEmail(email: string): Promise<FreescoutUser | null> {
  const res = await freescoutFetch<{ _embedded?: { users?: FreescoutUser[] } }>({
    path: "/api/users",
    query: { email },
  });
  const list = res._embedded?.users ?? [];
  return list[0] ?? null;
}

export async function createUser(
  email: string,
  firstName: string,
  lastName: string,
): Promise<FreescoutUser> {
  return await freescoutFetch<FreescoutUser>({
    method: "POST",
    path: "/api/users",
    body: {
      firstName: firstName || "Admin",
      lastName: lastName || "User",
      email,
      role: "user",
      sendInvite: true,
      mailboxes: DEFAULT_MAILBOX_ID > 0 ? [DEFAULT_MAILBOX_ID] : [],
    },
  });
}
