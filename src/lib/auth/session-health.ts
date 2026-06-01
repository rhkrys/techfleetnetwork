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
