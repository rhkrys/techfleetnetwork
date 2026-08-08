// Freescout API client — config + circuit breaker + concurrency semaphore.
// Base URL and mailbox id are env-OVERRIDABLE with sane defaults. They used to be
// hardcoded constants, but that silently broke the whole integration when
// PikaPods reassigned the pod host (meteoric-hare -> bulky-kagu) — a config
// problem masquerading as a code outage. Now: set FREESCOUT_BASE_URL /
// FREESCOUT_MAILBOX_ID to move servers without a code change; the defaults track
// the current pod so the fn still boots if the secret is absent.
// FREESCOUT_API_KEY remains required (live-validated at secret entry by the
// freescout-validate-secret edge fn); missing key throws loudly at module load.

/**
 * Resolve + validate the Freescout base URL. Pure/exported so the env-override
 * and the https guard are unit-tested (a hardcoded host broke this integration
 * twice). Enforcing https keeps the API/webhook channel from being downgraded
 * and keeps the SSRF host allowlist below meaningful.
 */
export function resolveFreescoutBaseUrl(envValue?: string | null): string {
  const url = envValue && envValue.length > 0 ? envValue : "https://bulky-kagu.pikapod.net";
  if (!url.startsWith("https://")) {
    throw new Error("FREESCOUT_BASE_URL must be an https:// URL");
  }
  return url;
}

export const FREESCOUT_BASE_URL = resolveFreescoutBaseUrl(Deno.env.get("FREESCOUT_BASE_URL"));
export const DEFAULT_MAILBOX_ID = Number(Deno.env.get("FREESCOUT_MAILBOX_ID") ?? "1");
// Derived from the configured base URL — this is the SSRF allowlist: outbound
// calls to any other host are refused (see request() below).
const FREESCOUT_HOST = new URL(FREESCOUT_BASE_URL).host;

const FREESCOUT_API_KEY = Deno.env.get("FREESCOUT_API_KEY") ?? "";
if (!FREESCOUT_API_KEY) {
  // Catastrophic-only tripwire: validated-entry flow makes this unreachable in
  // steady state. If you see this in logs, the deploy is broken — the secret
  // was deleted or never set.
  throw new Error("FREESCOUT_API_KEY missing — refuse to boot");
}

// -------- Errors --------

export class FreescoutError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown
  ) {
    super(message);
  }
}

// -------- Circuit breaker (existing semantics) --------

interface BreakerState {
  failures: number;
  openedAt: number;
}
const breaker: BreakerState = { failures: 0, openedAt: 0 };
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 30_000;

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

// -------- In-isolate concurrency semaphore --------
// Caps outbound fetches per isolate. Not a distributed rate limiter — this is
// in-process upstream protection so a thundering herd can't DoS Pikapod from
// a single warm isolate. Combined with the per-route response cache (see
// freescoutCache.ts) and the breaker, the worst case is bounded.

const MAX_CONCURRENT = 8;
const MAX_WAIT_MS = 2_000;
let inFlight = 0;
const waiters: Array<{
  resolve: () => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}> = [];

async function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waiters.findIndex((w) => w.timer === timer);
      if (idx >= 0) waiters.splice(idx, 1);
      reject(new FreescoutError(503, "Concurrency limit; try again shortly"));
    }, MAX_WAIT_MS);
    waiters.push({
      resolve: () => {
        inFlight++;
        resolve();
      },
      reject,
      timer,
    });
  });
}
function release() {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve();
  }
}

// -------- fetch --------

export interface FreescoutFetchOpts {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  attempt?: number;
  timeoutMs?: number;
  maxAttempts?: number;
}

export async function freescoutFetch<T = unknown>(opts: FreescoutFetchOpts): Promise<T> {
  if (breakerOpen()) {
    throw new FreescoutError(503, "support_unavailable", { reason: "breaker_open" });
  }

  const u = new URL(FREESCOUT_BASE_URL + opts.path);
  if (u.host !== FREESCOUT_HOST) {
    throw new FreescoutError(400, "Refused to call non-allowlisted host");
  }
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    }
  }

  const attempt = opts.attempt ?? 1;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: {
      "X-FreeScout-API-Key": FREESCOUT_API_KEY,
      Accept: "application/json",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: ctrl.signal,
  };

  await acquire();
  let res: Response;
  try {
    res = await fetch(u.toString(), init);
  } catch (e) {
    clearTimeout(timer);
    release();
    recordFailure();
    console.error(
      JSON.stringify({
        level: "error",
        fn: "freescout-client",
        code: "upstream_unreachable",
        method: init.method,
        path: opts.path,
        attempt,
        err: e instanceof Error ? e.message : String(e),
      })
    );
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 250 * attempt));
      return freescoutFetch<T>({ ...opts, attempt: attempt + 1 });
    }
    throw new FreescoutError(502, "Upstream unreachable");
  }
  clearTimeout(timer);
  release();

  if (res.status >= 500) {
    recordFailure();
    let body: unknown = undefined;
    try {
      body = await res.clone().json();
    } catch {
      try {
        body = await res.text();
      } catch {
        /* ignore */
      }
    }
    console.error(
      JSON.stringify({
        level: "error",
        fn: "freescout-client",
        code: "upstream_5xx",
        method: init.method,
        path: opts.path,
        status: res.status,
        attempt,
        body: typeof body === "string" ? body.slice(0, 1000) : body,
      })
    );
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
      return freescoutFetch<T>({ ...opts, attempt: attempt + 1 });
    }
    throw new FreescoutError(res.status, "Upstream error", body);
  }

  if (!res.ok) {
    let body: unknown = undefined;
    try {
      body = await res.clone().json();
    } catch {
      try {
        body = await res.text();
      } catch {
        /* ignore */
      }
    }
    console.error(
      JSON.stringify({
        level: "error",
        fn: "freescout-client",
        code: "upstream_4xx",
        method: init.method,
        path: opts.path,
        status: res.status,
        statusText: res.statusText,
        body: typeof body === "string" ? body.slice(0, 1000) : body,
      })
    );
    throw new FreescoutError(res.status, res.statusText || `HTTP ${res.status}`, body);
  }

  recordSuccess();
  if (res.status === 204) return undefined as unknown as T;
  try {
    return (await res.json()) as T;
  } catch {
    return undefined as unknown as T;
  }
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
  } catch {
    return null;
  }
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
      ["sign"]
    );
    const macBuf = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody))
    );
    if (timingSafeEqual(macBuf, provided)) return true;
  }
  return false;
}

// -------- Typed helpers --------

export interface FreescoutCustomer {
  id: number;
  emails?: { value: string }[];
  firstName?: string;
  lastName?: string;
}
export interface FreescoutUser {
  id: number;
  email?: string;
  firstName?: string;
  lastName?: string;
}

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
  lastName?: string
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
  lastName: string
): Promise<FreescoutUser> {
  // sendInvite:false on purpose — the platform proxies every Freescout call
  // with the master API key, so admins never need a Freescout password or
  // login. Inviting them would just spam their inbox with a setup link they
  // don't need. See plan §1.A — silent provisioning.
  return await freescoutFetch<FreescoutUser>({
    method: "POST",
    path: "/api/users",
    body: {
      firstName: firstName || "Admin",
      lastName: lastName || "User",
      email,
      role: "user",
      sendInvite: false,
      mailboxes: DEFAULT_MAILBOX_ID > 0 ? [DEFAULT_MAILBOX_ID] : [],
    },
  });
}
