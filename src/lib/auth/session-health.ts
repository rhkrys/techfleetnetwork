/**
 * Single source of truth for "this auth state is unrecoverable; purge and
 * sign out cleanly." Used by AuthContext bootstrap, AuthService, the global
 * fetch guard, and any other call-site that touches sb-*-auth-token state.
 *
 * The legacy duplicated checks (one in AuthContext.tsx, one in auth.service.ts)
 * only recognised "refresh token …" strings. After the 2026-06-01 GoTrue key
 * rotation, every previously-issued ACCESS token failed verification with
 * `bad_jwt` / "invalid number of segments" / "unable to parse or verify
 * signature" — none of which matched, so the SDK auto-refresh loop hammered
 * /user with the dead token and users stayed wedged. This module fixes that
 * permanently: one classifier, one purger, one fingerprint gate, one
 * pre-write JWT shape check.
 */

export type AuthErrorClass =
  | "ok"
  | "refresh_invalid"   // refresh token revoked / expired / reused
  | "jwt_corrupt"       // access token can't be parsed/verified (rotation, tamper, truncation)
  | "shape_invalid";    // token is not even a 3-segment JWT — never write it

const AUTH_STORAGE_KEY_PATTERN = /^sb-.*-auth-token$/;
const FINGERPRINT_KEY = "tfn_auth_client_fingerprint_v1";
const SESSION_STARTED_AT_KEY = "session_started_at";
const OAUTH_LINK_TOAST_KEY = "tfn_oauth_link_toast_shown_v1";

/* ---------------------------------------------------------------------- */
/* 1. Error classifier — shared by every layer                              */
/* ---------------------------------------------------------------------- */

export function classifyAuthError(error: unknown): AuthErrorClass {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String((error as { message?: string } | null | undefined)?.message ?? error ?? "").toLowerCase();
  if (!message) return "ok";

  // Refresh-token failure modes.
  if (message.includes("refresh token")) {
    if (
      message.includes("invalid") ||
      message.includes("not found") ||
      message.includes("missing") ||
      message.includes("expired") ||
      message.includes("revoked") ||
      message.includes("already used") ||
      message.includes("reuse")
    ) {
      return "refresh_invalid";
    }
  }

  // Access-token corruption. Covers every variant emitted by GoTrue after a
  // signing-key rotation or when storage is tampered with.
  if (
    message.includes("bad_jwt") ||
    message.includes("invalid jwt") ||
    message.includes("invalid number of segments") ||
    message.includes("token is malformed") ||
    (message.includes("jwt") && message.includes("malformed")) ||
    message.includes("parse or verify signature") ||
    message.includes("signature is invalid")
  ) {
    return "jwt_corrupt";
  }

  return "ok";
}

/** True iff the error is something we must self-heal from (purge + sign out). */
export function isUnrecoverableAuthError(error: unknown): boolean {
  const c = classifyAuthError(error);
  return c === "refresh_invalid" || c === "jwt_corrupt";
}

/* ---------------------------------------------------------------------- */
/* 2. JWT shape check — refuse to ever write a malformed token            */
/* ---------------------------------------------------------------------- */

const JWT_SEGMENT = /^[A-Za-z0-9_-]+$/;

/** Cheap structural check — header.payload.signature, all base64url. */
export function isLikelyJwt(token: unknown): token is string {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  return parts.every((p) => p.length > 0 && JWT_SEGMENT.test(p));
}

/**
 * AUTH-VICHEA-FIX (2026-06-09): Supabase refresh tokens are OPAQUE strings,
 * not JWTs. The previous `isLikelyJwt(refresh_token)` gate rejected every
 * valid login response, threw "Invalid login response", and the client
 * misclassified that as INVALID_CREDENTIALS — locking real users out and
 * forcing repeated password resets (Vichea, June 2026).
 *
 * Validate refresh tokens ONLY as non-empty opaque strings with a sane
 * minimum length. Never apply a JWT shape check to a refresh token.
 */
export function isOpaqueRefreshToken(token: unknown): token is string {
  return typeof token === "string" && token.length >= 20 && token.length <= 4096;
}

/* ---------------------------------------------------------------------- */
/* 2a. Typed client-side session-write failure                            */
/* ---------------------------------------------------------------------- */

/**
 * Thrown when the client refuses to write a session to storage because the
 * shape of the tokens returned by the auth backend is invalid. This is a
 * CLIENT-SIDE failure, not a credential failure — it MUST NOT count toward
 * device lockout, server rate limit, or CAPTCHA failure counters.
 *
 * Carries a stable `code` so the auth-error-classifier can recognise it
 * without any message-string matching. See AUTH-VICHEA-001.
 */
export class ClientSessionWriteError extends Error {
  readonly code = "CLIENT_SESSION_WRITE_FAILED" as const;
  readonly reason: "access_token_invalid" | "refresh_token_invalid" | "set_session_rejected";
  constructor(reason: ClientSessionWriteError["reason"], message?: string) {
    super(message ?? "Sign-in didn't complete — please try again.");
    this.name = "ClientSessionWriteError";
    this.reason = reason;
  }
}

export function isClientSessionWriteError(err: unknown): err is ClientSessionWriteError {
  return err instanceof ClientSessionWriteError ||
    (typeof err === "object" && err !== null && (err as { code?: string }).code === "CLIENT_SESSION_WRITE_FAILED");
}

/* ---------------------------------------------------------------------- */
/* 2b. Stored access-token health — used to distinguish transient server  */
/* bad_jwt (GoTrue restart, edge proxy hiccup) from a real corruption.    */
/* ---------------------------------------------------------------------- */

export type StoredTokenHealth =
  | { state: "missing" }
  | { state: "shape_invalid" }
  | { state: "expired"; expSeconds: number }
  | { state: "valid"; expSeconds: number };

function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

/**
 * Inspect the currently stored sb-*-auth-token without touching the server.
 * Returns the structural + expiry health of the access token. The fetch
 * guard and bootstrap use this to decide whether a single server bad_jwt
 * should be treated as transient (token still looks valid client-side) or
 * as a real corruption (token shape broken / already expired).
 */
export function getStoredAccessTokenHealth(): StoredTokenHealth {
  if (typeof window === "undefined") return { state: "missing" };
  let raw: string | null = null;
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && AUTH_STORAGE_KEY_PATTERN.test(key)) {
        raw = localStorage.getItem(key);
        if (raw) break;
      }
    }
  } catch {
    return { state: "missing" };
  }
  if (!raw) return { state: "missing" };

  let accessToken: unknown;
  try {
    const parsed = JSON.parse(raw);
    accessToken = parsed?.access_token ?? parsed?.currentSession?.access_token;
  } catch {
    accessToken = raw;
  }
  if (!isLikelyJwt(accessToken)) return { state: "shape_invalid" };

  const payload = decodeJwtPayload(accessToken);
  const expSeconds = Number(payload?.exp ?? 0);
  if (!Number.isFinite(expSeconds) || expSeconds <= 0) return { state: "shape_invalid" };
  const nowSeconds = Math.floor(Date.now() / 1000);
  // Allow a 60s grace window so we don't race the SDK auto-refresh.
  if (expSeconds + 60 < nowSeconds) return { state: "expired", expSeconds };
  return { state: "valid", expSeconds };
}

/* ---------------------------------------------------------------------- */
/* 2c. Two-strike gate — single transient bad_jwt MUST NOT sign out a     */
/* user whose stored token is structurally valid and unexpired.           */
/* ---------------------------------------------------------------------- */

const TRANSIENT_BAD_JWT_KEY = "tfn_auth_transient_bad_jwt_first_ms";
const TRANSIENT_WINDOW_MS = 15_000;

export interface PurgeDecision {
  shouldPurge: boolean;
  reason: "shape_invalid" | "expired" | "second_strike" | "transient";
  health: StoredTokenHealth;
}

/**
 * Decide whether a server bad_jwt response should trigger a purge+signout.
 * Rules:
 *   - Stored token shape broken or already expired → purge immediately.
 *   - Stored token still valid → record a transient strike. If a second
 *     bad_jwt arrives within TRANSIENT_WINDOW_MS, purge. Otherwise let the
 *     SDK auto-refresh recover and keep the user signed in.
 */
export function decidePurgeOnBadJwt(now: number = Date.now()): PurgeDecision {
  const health = getStoredAccessTokenHealth();
  if (health.state === "shape_invalid" || health.state === "missing") {
    clearTransientStrike();
    return { shouldPurge: true, reason: "shape_invalid", health };
  }
  if (health.state === "expired") {
    clearTransientStrike();
    return { shouldPurge: true, reason: "expired", health };
  }
  let firstMs = 0;
  try {
    firstMs = Number(sessionStorage.getItem(TRANSIENT_BAD_JWT_KEY) ?? "0");
  } catch {
    firstMs = 0;
  }
  if (Number.isFinite(firstMs) && firstMs > 0 && now - firstMs <= TRANSIENT_WINDOW_MS) {
    clearTransientStrike();
    return { shouldPurge: true, reason: "second_strike", health };
  }
  try {
    sessionStorage.setItem(TRANSIENT_BAD_JWT_KEY, String(now));
  } catch {
    /* private mode — fail open, do not purge */
  }
  return { shouldPurge: false, reason: "transient", health };
}

export function clearTransientStrike(): void {
  try {
    sessionStorage.removeItem(TRANSIENT_BAD_JWT_KEY);
  } catch {
    /* noop */
  }
}

/* ---------------------------------------------------------------------- */
/* 3. Purger — clears every sb-*-auth-token + side-state in one shot      */
/* ---------------------------------------------------------------------- */

export interface PurgeOptions {
  reason: "jwt_corrupt" | "refresh_invalid" | "fingerprint_mismatch" | "shape_invalid" | "manual";
  source?: "bootstrap" | "fetch_guard" | "signin" | "oauth" | "signout" | "other";
  /** Skip beaconing the wedge event (used for routine signout). */
  silent?: boolean;
}

export function purgeLocalAuthState(opts: PurgeOptions): void {
  try {
    sessionStorage.removeItem(SESSION_STARTED_AT_KEY);
    localStorage.removeItem(OAUTH_LINK_TOAST_KEY);
    for (const storage of [localStorage, sessionStorage]) {
      for (let i = storage.length - 1; i >= 0; i -= 1) {
        const key = storage.key(i);
        if (key && AUTH_STORAGE_KEY_PATTERN.test(key)) storage.removeItem(key);
      }
    }
  } catch {
    /* private mode / quota — non-fatal */
  }
  if (!opts.silent && opts.reason !== "manual") {
    beaconWedge(opts.reason, opts.source ?? "other");
  }
}

/* ---------------------------------------------------------------------- */
/* 4. Client fingerprint — invalidate storage on URL/key swap             */
/* ---------------------------------------------------------------------- */

/**
 * Fingerprint storage against the (URL + publishable-key) pair the app was
 * built with. If a publishable key is rotated, every persisted session
 * becomes garbage; purge BEFORE getSession() to skip the spinner-lock.
 */
export function ensureClientFingerprint(): void {
  try {
    const url = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
    const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) ?? "";
    if (!url || !key) return;
    const fp = `${url}::${key.slice(0, 24)}::${key.length}`;
    const stored = localStorage.getItem(FINGERPRINT_KEY);
    if (stored && stored !== fp) {
      purgeLocalAuthState({ reason: "fingerprint_mismatch", source: "bootstrap" });
    }
    if (stored !== fp) localStorage.setItem(FINGERPRINT_KEY, fp);
  } catch {
    /* private mode — non-fatal */
  }
}

/* ---------------------------------------------------------------------- */
/* 5. Wedge beacon — fire-and-forget counter for observability            */
/* ---------------------------------------------------------------------- */

const BEACON_DEDUPE_KEY = "tfn_auth_wedge_beacon_last_ms";
const BEACON_DEDUPE_WINDOW_MS = 5_000;

function beaconWedge(reason: string, source: string): void {
  try {
    const now = Date.now();
    const last = Number(sessionStorage.getItem(BEACON_DEDUPE_KEY) ?? "0");
    if (Number.isFinite(last) && now - last < BEACON_DEDUPE_WINDOW_MS) return;
    sessionStorage.setItem(BEACON_DEDUPE_KEY, String(now));

    const url = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
    if (!url) return;
    const endpoint = `${url}/functions/v1/record-auth-wedge`;
    const body = JSON.stringify({
      reason,
      source,
      user_agent: navigator.userAgent.slice(0, 200),
      route: window.location.pathname,
    });
    const headers = { type: "application/json" };

    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(endpoint, new Blob([body], headers));
      return;
    }
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* never let observability break recovery */
  }
}
