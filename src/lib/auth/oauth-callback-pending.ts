/**
 * OAuth callback pending guard.
 *
 * Root cause it fixes: after a Google sign-in bounce, the URL briefly carries
 * a `?code=…` (PKCE) or `#access_token=…&refresh_token=…` (implicit) before
 * the SDK/AuthContext consumes it and emits SIGNED_IN. During that window,
 * `useAuth().user` is still null, so any <ProtectedRoute> or
 * AuthRedirectHandler would race the consumer and bounce the member back to
 * `/login` or `/` — surfaced to the user as "Gmail login hangs and sends me
 * back to the home page".
 *
 * This module is the single source of truth for "we are mid-OAuth-callback;
 * do not redirect yet." It is bounded by a hard timeout so a broken consumer
 * cannot freeze the app forever.
 */
import { beaconWedge } from "./session-health";

const PENDING_KEY = "tfn_oauth_callback_pending_ms";
/** Hard upper bound on how long we'll defer redirects waiting for SIGNED_IN. */
const PENDING_TTL_MS = 12_000;

/** True iff the current URL is an OAuth callback that hasn't been consumed. */
export function isOAuthCallbackUrl(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    const search = url.searchParams;
    if (search.has("code") && (search.has("state") || search.has("scope"))) return true;
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    if (hash.get("access_token") && hash.get("refresh_token")) return true;
    return false;
  } catch {
    return false;
  }
}

/** Mark "consumer started" — paired with `clearOAuthCallbackPending`. */
export function markOAuthCallbackPending(): void {
  try {
    sessionStorage.setItem(PENDING_KEY, String(Date.now()));
  } catch {
    /* private mode — fail open */
  }
}

export function clearOAuthCallbackPending(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* noop */
  }
}

/**
 * True while EITHER the URL still carries an OAuth callback OR the consumer
 * has flagged itself as in-flight and we're inside the TTL window. Used by
 * <ProtectedRoute> and <AuthRedirectHandler> to defer redirects.
 */
export function isOAuthCallbackPending(now: number = Date.now()): boolean {
  if (isOAuthCallbackUrl()) return true;
  let startedMs = 0;
  try {
    startedMs = Number(sessionStorage.getItem(PENDING_KEY) ?? "0");
  } catch {
    startedMs = 0;
  }
  if (!Number.isFinite(startedMs) || startedMs <= 0) return false;
  if (now - startedMs > PENDING_TTL_MS) {
    // Watchdog tripped — surface as observable event and stop deferring so
    // the app can show /login cleanly instead of spinning forever.
    clearOAuthCallbackPending();
    try { beaconWedge("oauth_callback_timeout", "callback_pending_guard"); } catch { /* noop */ }
    return false;
  }
  return true;
}
