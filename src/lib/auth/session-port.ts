/**
 * Canonical session port — the ONE place outside the auth feature module
 * and AuthContext bootstrap that other code may use to read/end an auth
 * session. Every "side door" (settings pages, service modules, panels)
 * MUST go through here so backend hiccups never reach a logout path
 * directly.
 *
 * Layers wrapped here:
 *   1. Coalesced + cached reads (delegates to getCachedSession)
 *   2. Transient bad_jwt classifier (decidePurgeOnBadJwt)
 *   3. Retry-with-jitter on transient network/5xx for `/user`
 *   4. Safe signOut that never throws and tags the reason
 *   5. Telemetry beacon `auth_flap_detected` for transient recoveries
 *
 * No tokens, PII, or user ids ever leave the browser via this module.
 *
 * BDD: AUTH-RESILIENCE-001..006
 */

import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getCachedSession, invalidateCachedSession } from "@/lib/cached-session";
import {
  classifyAuthError,
  decidePurgeOnBadJwt,
  purgeLocalAuthState,
  clearTransientStrike,
} from "@/lib/auth/session-health";

const USER_RETRY_DELAYS_MS = [250, 500] as const;

/* ---------------------------------------------------------------------- */
/* Read paths — never throw on transient failure                           */
/* ---------------------------------------------------------------------- */

/**
 * Safe session read. Returns the cached session, or `null` on transient
 * failure. NEVER throws and NEVER triggers a sign-out, even on bad_jwt —
 * the two-strike gate in `decidePurgeOnBadJwt` is the only authority that
 * can decide a session is truly dead.
 */
export async function getSessionSafe(): Promise<Session | null> {
  try {
    return await getCachedSession();
  } catch (err) {
    handleTransient(err, "getSessionSafe");
    return null;
  }
}

/**
 * Safe user read with one retry on transient backend errors. The
 * underlying `auth.getUser()` re-validates with the auth server, which is
 * the call that flaked during the 2026-06-16 incident. On transient 5xx
 * or `bad_jwt`-with-valid-stored-token, we retry with jitter and return
 * the user without disturbing the session.
 */
export async function getUserSafe(): Promise<User | null> {
  for (let attempt = 0; attempt <= USER_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (attempt > 0) beaconFlap("getUserSafe", attempt);
      return data.user ?? null;
    } catch (err) {
      const cls = classifyAuthError(err);
      // Real corruption — let AuthContext bootstrap decide via its two-strike
      // gate; we just bail out cleanly here.
      if (cls === "refresh_invalid") {
        return null;
      }
      if (cls === "jwt_corrupt") {
        const decision = decidePurgeOnBadJwt();
        if (!decision.shouldPurge && attempt < USER_RETRY_DELAYS_MS.length) {
          await sleep(USER_RETRY_DELAYS_MS[attempt]);
          continue;
        }
        return null;
      }
      // Transient network / 5xx — retry once, then give up gracefully.
      if (attempt < USER_RETRY_DELAYS_MS.length) {
        await sleep(USER_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      handleTransient(err, "getUserSafe");
      return null;
    }
  }
  return null;
}

/* ---------------------------------------------------------------------- */
/* Write paths — bounded, audited                                          */
/* ---------------------------------------------------------------------- */

export interface SignOutOptions {
  /** "local" clears only this tab's session; "global" revokes across devices. */
  scope?: "local" | "global";
  /** Human-readable cause. Beaconed for ops; never sent with PII. */
  reason: "user_initiated" | "mfa_refused" | "profile_update" | "admin_action" | "session_revoked";
}

/**
 * Safe sign-out. Always best-effort, never throws, always purges local
 * storage so the UI cannot be left in a half-authed state. The auth
 * backend can fail — that's fine; the user is signed out locally and a
 * subsequent server reconciliation will catch up.
 */
export async function signOutSafe(opts: SignOutOptions): Promise<void> {
  const scope = opts.scope ?? "global";
  try {
    await supabase.auth.signOut({ scope });
  } catch {
    /* network or auth backend hiccup — fall through to local purge */
  }
  purgeLocalAuthState({ reason: "manual", source: "signout", silent: true });
  invalidateCachedSession();
  clearTransientStrike();
  beaconSignout(opts.reason, scope);
}

/* ---------------------------------------------------------------------- */
/* Telemetry — fire-and-forget                                             */
/* ---------------------------------------------------------------------- */

function beaconFlap(source: string, retries: number): void {
  postBeacon("auth_flap_detected", { source, retries });
}

function beaconSignout(reason: string, scope: string): void {
  postBeacon("auth_signout", { reason, scope });
}

function handleTransient(err: unknown, source: string): void {
  postBeacon("auth_read_failed", {
    source,
    class: classifyAuthError(err),
  });
}

function postBeacon(kind: string, payload: Record<string, string | number>): void {
  try {
    const url = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
    if (!url) return;
    const endpoint = `${url}/functions/v1/record-auth-wedge`;
    const body = JSON.stringify({
      kind,
      ...payload,
      route: typeof window !== "undefined" ? window.location.pathname : "",
    });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* observability must never break the caller */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
