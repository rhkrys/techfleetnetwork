/**
 * AUTH-ARCH-CUTOVER-013 (2026-06-15) — Session lifecycle service.
 *
 * Owns ONLY session lifecycle:
 *   - getSession (with idle-policy + server-side revocation enforcement)
 *   - onAuthStateChange
 *   - signOut (single device)
 *   - signOutAllDevices (revoke-all via edge fn)
 *   - clearLocalAuthState (best-effort local purge)
 *
 * Does NOT own: sign-up, sign-in, password reset, identity hint, MFA. Those
 * live in dedicated per-use-case services under `src/features/auth/services/`.
 *
 * Physical successor to the deleted `src/services/auth.service.ts` (the
 * 625-line mixed-responsibility legacy file). Importers go through
 * `sessionPort` (see `src/features/auth/ports/session.port.ts`).
 */
import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";
import { logAccountActivity } from "@/lib/account-activity";
import { getSessionPolicyFailureReason } from "@/lib/security";
import {
  clearOAuthUiMarker,
  hasFreshOAuthUiMarker,
  isRootOAuthCallback,
  stripRootOAuthCallbackUrl,
} from "@/lib/oauth-ui-guard";
import { getLastActivityAt } from "@/lib/session-activity";
import { classifyAuthError, purgeLocalAuthState } from "@/lib/auth/session-health";

const log = createLogger("SessionService");
const MAX_SESSION_AGE_MS = Number.POSITIVE_INFINITY;
const IDLE_SESSION_AGE_MS = 60 * 60 * 1000; // 1 hour
const SESSION_STARTED_AT_KEY = "session_started_at";
const SESSION_MARKER_VERSION = 1;
const AUTH_STORAGE_KEY_PATTERN = /^sb-.*-auth-token$/;

type AuthSession = NonNullable<Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]>;

interface SessionMarker {
  version: number;
  userId: string;
  startedAtMs: number;
  lastActivityAtMs?: number;
}

function writeSessionMarker(session: Pick<AuthSession, "user">, startedAtMs = Date.now()) {
  sessionStorage.setItem(
    SESSION_STARTED_AT_KEY,
    JSON.stringify({ version: SESSION_MARKER_VERSION, userId: session.user.id, startedAtMs } satisfies SessionMarker),
  );
}

function touchSessionMarker(session: Pick<AuthSession, "user">, marker: { startedAtMs: number }) {
  const lastActivityAtMs = Math.max(Date.now(), getLastActivityAt());
  sessionStorage.setItem(
    SESSION_STARTED_AT_KEY,
    JSON.stringify({ version: SESSION_MARKER_VERSION, userId: session.user.id, startedAtMs: marker.startedAtMs, lastActivityAtMs } satisfies SessionMarker),
  );
}

function readSessionMarker(session: Pick<AuthSession, "user">): { startedAtMs: number; lastActivityAtMs: number; resetReason: string | null } {
  const liveActivity = getLastActivityAt();
  const freshDefault = liveActivity > 0 ? liveActivity : Date.now();
  const raw = sessionStorage.getItem(SESSION_STARTED_AT_KEY);
  if (!raw) return { startedAtMs: Date.now(), lastActivityAtMs: freshDefault, resetReason: "missing" };

  const legacyStartedAt = Number(raw);
  if (Number.isFinite(legacyStartedAt)) return { startedAtMs: Date.now(), lastActivityAtMs: freshDefault, resetReason: "legacy" };

  try {
    const marker = JSON.parse(raw) as Partial<SessionMarker>;
    if (marker.version !== SESSION_MARKER_VERSION || marker.userId !== session.user.id || !Number.isFinite(marker.startedAtMs)) {
      return { startedAtMs: Date.now(), lastActivityAtMs: freshDefault, resetReason: "mismatch" };
    }
    const storedLast = Number.isFinite(marker.lastActivityAtMs) ? marker.lastActivityAtMs! : marker.startedAtMs!;
    return { startedAtMs: marker.startedAtMs!, lastActivityAtMs: Math.max(storedLast, liveActivity), resetReason: null };
  } catch {
    return { startedAtMs: Date.now(), lastActivityAtMs: freshDefault, resetReason: "malformed" };
  }
}

function isInvalidRefreshTokenError(error: unknown) {
  const c = classifyAuthError(error);
  return c === "refresh_invalid" || c === "jwt_corrupt";
}

function clearLocalAuthArtifacts(reason: "manual" | "refresh_invalid" | "jwt_corrupt" = "manual") {
  purgeLocalAuthState({ reason, source: "signout", silent: reason === "manual" });
}

function hasStoredAuthSession() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  if (url.searchParams.has("code") || hash.has("access_token") || hash.has("refresh_token")) {
    return isRootOAuthCallback(url) && hasFreshOAuthUiMarker();
  }

  for (const storage of [localStorage, sessionStorage]) {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && AUTH_STORAGE_KEY_PATTERN.test(key) && storage.getItem(key)) return true;
    }
  }
  return false;
}

async function recoverFromInvalidRefreshToken(error: unknown, source: string) {
  const maybeError = error as { message?: string; status?: number } | null | undefined;
  log.warn(source, "Stored refresh token is no longer valid — clearing local auth state", undefined, error);
  void logAccountActivity("invalid_refresh_token_cleared", {
    errorMessage: maybeError?.message ?? String(error ?? "Invalid refresh token"),
    errorCode: maybeError?.status,
    details: { source },
  });
  clearLocalAuthArtifacts();
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
}

export const sessionService = {
  async signOut() {
    log.info("signOut", "Signing out user");
    clearLocalAuthArtifacts();

    const { error } = await supabase.auth.signOut();
    if (!error) {
      log.info("signOut", "User signed out successfully (global)");
      void logAccountActivity("signout_global", {});
      return;
    }

    log.warn("signOut", `Global sign-out failed, falling back to local: ${error.message}`, undefined, error);
    const { error: localError } = await supabase.auth.signOut({ scope: "local" });
    if (localError) {
      log.error("signOut", `Local sign-out also failed: ${localError.message}`, undefined, localError);
      throw new Error("Sign out failed. Please try again.");
    }
    log.info("signOut", "User signed out successfully (local fallback)");
    void logAccountActivity("signout_local", { errorMessage: error.message });
  },

  clearLocalAuthState() {
    clearLocalAuthArtifacts();
  },

  async signOutAllDevices(opts?: { keepCurrent?: boolean; reason?: string }): Promise<{ revocationRecorded: boolean; gotrueSignedOut: boolean }> {
    const keepCurrent = opts?.keepCurrent === true;
    const reason = opts?.reason ?? "self_requested";
    return log.track("signOutAllDevices", "Revoking all user sessions", { keepCurrent, reason }, async () => {
      let revocationRecorded = false;
      let gotrueSignedOut = false;
      try {
        const { data, error } = await supabase.functions.invoke("sign-out-all-devices", {
          body: { keep_current: keepCurrent, reason },
        });
        if (error) {
          log.warn("signOutAllDevices", `Edge revoke returned error: ${error.message}`, undefined, error);
          void logAccountActivity("signout_local", { errorMessage: error.message });
        } else {
          revocationRecorded = Boolean((data as any)?.revocation_recorded);
          gotrueSignedOut = Boolean((data as any)?.gotrue_signed_out);
          void logAccountActivity("signout_all_devices", { details: { reason, keepCurrent } });
        }
      } catch (err) {
        log.warn("signOutAllDevices", `Edge revoke threw (non-fatal): ${(err as Error)?.message}`, undefined, err instanceof Error ? err : undefined);
      }

      if (!keepCurrent) {
        sessionStorage.removeItem(SESSION_STARTED_AT_KEY);
        await supabase.auth.signOut();
        log.info("signOutAllDevices", "Local session cleared");
      } else {
        log.info("signOutAllDevices", "Current device session preserved");
      }
      return { revocationRecorded, gotrueSignedOut };
    });
  },

  async getSession() {
    log.debug("getSession", "Retrieving current session");
    // AUTH-OAUTH-CALLBACK-OWNER (2026-06-22): the previous "no fresh UI marker
    // → strip URL + purge local auth" guard was destructive. Storage
    // partitioning (Safari ITP, third-party bounces, apex↔www) routinely
    // drops the marker even on legitimate Google sign-ins, and the resulting
    // purge bounced members back to the logged-out home page. The OAuth
    // broker already validates `state` cryptographically before emitting
    // tokens — local CSRF defense via storage marker is redundant and
    // harmful. The callback consumer in AuthContext bootstrap owns URL
    // cleanup; this function no longer mutates the URL or local auth state.

    if (!hasStoredAuthSession()) {
      log.debug("getSession", "No stored auth session — skipping backend session check");
      return null;
    }


    let authResult: Awaited<ReturnType<typeof supabase.auth.getSession>>;
    try {
      authResult = await supabase.auth.getSession();
    } catch (error) {
      if (isInvalidRefreshTokenError(error)) {
        await recoverFromInvalidRefreshToken(error, "getSession");
        return null;
      }
      throw error;
    }

    const { data, error } = authResult;
    if (error) {
      if (isInvalidRefreshTokenError(error)) {
        await recoverFromInvalidRefreshToken(error, "getSession");
        return null;
      }
      log.error("getSession", `Failed to retrieve session: ${error.message}`, undefined, error);
      throw new Error(error.message);
    }

    if (data.session) {
      try {
        const issuedAt = new Date((data.session as { user: { created_at?: string } }).user.created_at ?? data.session.user.last_sign_in_at ?? new Date().toISOString());
        const tokenIssuedAt = data.session.expires_at
          ? new Date((data.session.expires_at - (data.session.expires_in ?? 600)) * 1000)
          : issuedAt;
        const { data: revoked } = await supabase.rpc("is_session_revoked", {
          _user_id: data.session.user.id,
          _issued_at: tokenIssuedAt.toISOString(),
        });
        if (revoked === true) {
          log.warn("getSession", `Session revoked server-side for user ${data.session.user.id} — forcing sign-out`);
          void logAccountActivity("session_revoked_serverside", { userId: data.session.user.id });
          await supabase.auth.signOut();
          sessionStorage.removeItem(SESSION_STARTED_AT_KEY);
          return null;
        }
      } catch (e) {
        log.warn("getSession", `Revocation check failed (non-blocking): ${e instanceof Error ? e.message : String(e)}`);
      }

      const marker = readSessionMarker(data.session);
      if (marker.resetReason) {
        writeSessionMarker(data.session);
        log.debug("getSession", "Session timestamp reset for current authenticated user", {
          userId: data.session.user.id,
          reason: marker.resetReason,
        });
        return data.session;
      }

      const now = Date.now();
      const sessionPolicyFailure = getSessionPolicyFailureReason({
        startedAt: marker.startedAtMs,
        lastActivityAt: marker.lastActivityAtMs,
        now,
        idleTimeoutMs: IDLE_SESSION_AGE_MS,
        absoluteTimeoutMs: MAX_SESSION_AGE_MS,
      });
      if (sessionPolicyFailure) {
        log.warn("getSession", `Session failed policy (${sessionPolicyFailure}) — forcing sign-out`, {
          reason: sessionPolicyFailure,
          elapsedMs: now - marker.startedAtMs,
          idleMs: now - marker.lastActivityAtMs,
          maxMs: MAX_SESSION_AGE_MS,
        });
        void logAccountActivity(sessionPolicyFailure === "idle_timeout" ? "session_idle_timeout" : "session_expired_clientside", {
          userId: data.session.user.id,
          details: { reason: sessionPolicyFailure, elapsedMs: now - marker.startedAtMs },
        });
        await supabase.auth.signOut();
        sessionStorage.removeItem(SESSION_STARTED_AT_KEY);
        return null;
      }
      touchSessionMarker(data.session, marker);
      log.debug("getSession", "Valid session found", { userId: data.session.user.id });
      if (isRootOAuthCallback()) {
        clearOAuthUiMarker();
        stripRootOAuthCallbackUrl();
      }
    } else {
      log.debug("getSession", "No active session");
    }

    return data.session;
  },

  onAuthStateChange(callback: Parameters<typeof supabase.auth.onAuthStateChange>[0]) {
    log.debug("onAuthStateChange", "Subscribing to auth state changes");
    return supabase.auth.onAuthStateChange(callback);
  },
};

export type SessionService = typeof sessionService;
