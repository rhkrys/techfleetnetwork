import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";
import { logAccountActivity } from "@/lib/account-activity";
import { getSessionPolicyFailureReason } from "@/lib/security";
import { clearOAuthUiMarker, hasFreshOAuthUiMarker, isRootOAuthCallback, stripRootOAuthCallbackUrl } from "@/lib/oauth-ui-guard";
import { getLastActivityAt } from "@/lib/session-activity";
import { classifyAuthError, purgeLocalAuthState } from "@/lib/auth/session-health";
// AUTH-ARCH-CUTOVER-007/008/009/010 (2026-06-15) — auth use-case logic moved
// out of this file. New code MUST import sessionPort or the service directly.
import { signUp as signUpService, resendSignupConfirmation as resendSignupConfirmationService } from "@/features/auth/services/sign-up.service";
import { requestPasswordReset as requestPasswordResetService } from "@/features/auth/services/request-password-reset.service";
import { completePasswordReset as completePasswordResetService } from "@/features/auth/services/complete-password-reset.service";
import { checkAccountIdentity as checkAccountIdentityService } from "@/features/auth/services/identity-hint.service";

const log = createLogger("AuthService");
const MAX_SESSION_AGE_MS = Number.POSITIVE_INFINITY;
const IDLE_SESSION_AGE_MS = 60 * 60 * 1000; // 1 hour
const SESSION_STARTED_AT_KEY = "session_started_at";
const SESSION_MARKER_VERSION = 1;
const AUTH_STORAGE_KEY_PATTERN = /^sb-.*-auth-token$/;
export const GOOGLE_ONLY_ACCOUNT_CODE = "GOOGLE_ONLY_ACCOUNT";
export const GOOGLE_ONLY_ACCOUNT_MESSAGE = "This account uses Google sign-in. Use Google to continue; password reset is not available for this account.";


type AuthSession = NonNullable<Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]>;

type PasswordUpdateRejectCode =
  | "same_password"
  | "weak_password"
  | "session_expired"
  | "rate_limited"
  | "service_unavailable"
  | "unknown";

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
  // Persist the most recent of (now, cross-tab activity timestamp) so that
  // activity in any other tab is preserved into this tab's marker too.
  const lastActivityAtMs = Math.max(Date.now(), getLastActivityAt());
  sessionStorage.setItem(
    SESSION_STARTED_AT_KEY,
    JSON.stringify({ version: SESSION_MARKER_VERSION, userId: session.user.id, startedAtMs: marker.startedAtMs, lastActivityAtMs } satisfies SessionMarker),
  );
}

function readSessionMarker(session: Pick<AuthSession, "user">): { startedAtMs: number; lastActivityAtMs: number; resetReason: string | null } {
  // Real DOM activity (mouse, keyboard, scroll, video playback) ALWAYS wins
  // over the stored marker — the marker is only refreshed when getSession()
  // runs, but a user can be active for an hour without triggering that.
  // 0 means "no activity ever observed yet" — treat fresh-tab as `now`.
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
  // Single source of truth — delegate to the shared purger so every layer
  // (bootstrap, fetch-guard, signin/signout, OAuth) clears the same keys.
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

// `logAdminLoginIfElevated` moved to `src/features/auth/services/sign-in.service.ts`
// alongside the active password-sign-in owner (AUTH-DIRECT-SIGNIN-004).



async function readFunctionError(error: unknown): Promise<{ status?: number; message: string; code?: string }> {
  const fallback = error instanceof Error ? error.message : String((error as { message?: string } | null | undefined)?.message ?? "Unknown error");
  const directStatus = (error as { status?: unknown } | null | undefined)?.status;
  const directCode = (error as { code?: unknown } | null | undefined)?.code;
  const response = (error as { context?: { response?: Response } } | null | undefined)?.context?.response;
  let message = fallback;
  let code: string | undefined;
  try {
    const body = response ? await response.clone().json().catch(() => null) as { error?: string; message?: string; code?: string } | null : null;
    message = body?.error || body?.message || fallback;
    code = body?.code;
  } catch {
    // Use fallback message.
  }
  return {
    status: response?.status ?? (typeof directStatus === "number" ? directStatus : undefined),
    message,
    code: code ?? (typeof directCode === "string" ? directCode : undefined),
  };
}

function classifyPasswordUpdateError(err: { message?: string; code?: string; status?: number }): { code: PasswordUpdateRejectCode; message: string } {
  const code = (err.code || "").toLowerCase();
  const msg = (err.message || "").toLowerCase();

  if (code === "same_password" || msg.includes("should be different from") || msg.includes("same as the old")) {
    return { code: "same_password", message: "Pick a password you haven't used here before." };
  }
  if (code === "weak_password" || msg.includes("pwned") || msg.includes("breach") || msg.includes("weak password")) {
    return { code: "weak_password", message: "This password appeared in a known data breach. Choose a different one." };
  }
  if (
    code === "session_expired" ||
    code === "session_not_found" ||
    code === "no_authorization" ||
    code === "bad_jwt" ||
    code === "user_not_found" ||
    err.status === 401 ||
    msg.includes("auth session missing") ||
    msg.includes("missing auth session") ||
    msg.includes("not authenticated") ||
    msg.includes("user from sub claim in jwt does not exist") ||
    msg.includes("invalid claim") ||
    (msg.includes("session") && (msg.includes("expired") || msg.includes("not found"))) ||
    msg.includes("jwt expired")
  ) {
    return { code: "session_expired", message: "Your password reset link expired. Request a new one to continue." };
  }
  if (code === "over_request_rate_limit" || code === "rate_limited" || err.status === 429 || msg.includes("rate limit")) {
    return { code: "rate_limited", message: "Too many attempts in a short time. Please wait a minute and try again." };
  }
  if (!err.status || err.status >= 500 || msg.includes("failed to fetch") || msg.includes("network")) {
    return { code: "service_unavailable", message: "The password update service is temporarily unavailable. Please try again." };
  }
  return { code: "unknown", message: "We couldn't update your password. Please try again or request a new reset link." };
}


/**
 * AUTH-DIRECT-SIGNIN-004 (2026-06-12): `AuthService.signInWithPassword` was
 * deleted. The ONE password-sign-in owner is
 * `src/features/auth/services/sign-in.service.ts`.
 *
 * AUTH-ARCH-CUTOVER-007/008/009/010 (2026-06-15): signUp,
 * resendSignupConfirmation, resetPassword, updatePassword, and
 * checkAccountIdentity moved out of this file into per-use-case services
 * under `src/features/auth/services/`. The methods below are kept as thin
 * delegators so any straggler legacy importer keeps working until the
 * legacy-importer snapshot drops to zero; new code MUST import sessionPort
 * or the use-case service directly.
 */
import { signUp as signUpService, resendSignupConfirmation as resendSignupConfirmationService } from "@/features/auth/services/sign-up.service";
import { requestPasswordReset as requestPasswordResetService } from "@/features/auth/services/request-password-reset.service";
import { completePasswordReset as completePasswordResetService } from "@/features/auth/services/complete-password-reset.service";
import { checkAccountIdentity as checkAccountIdentityService } from "@/features/auth/services/identity-hint.service";

export const AuthService = {
  signUp: signUpService,
  resendSignupConfirmation: resendSignupConfirmationService,
  resetPassword: requestPasswordResetService,
  checkAccountIdentity: checkAccountIdentityService,
  updatePassword: completePasswordResetService,


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
          // Non-fatal: surface as warning so password reset / settings flows
          // never get blocked by transient GoTrue / network errors.
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
    if (isRootOAuthCallback() && !hasFreshOAuthUiMarker()) {
      log.warn("getSession", "Blocked direct OAuth callback without a recent UI-initiated sign-in marker");
      stripRootOAuthCallbackUrl();
      clearLocalAuthArtifacts();
      return null;
    }

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
      let currentTokenIssuedAtMs = Date.now();
      // Server-side revocation check: if an admin or auto-detection revoked sessions
      // after this token was issued, force sign-out immediately.
      try {
        const issuedAt = new Date((data.session as { user: { created_at?: string } }).user.created_at ?? data.session.user.last_sign_in_at ?? new Date().toISOString());
        const tokenIssuedAt = data.session.expires_at
          ? new Date((data.session.expires_at - (data.session.expires_in ?? 600)) * 1000)
          : issuedAt;
        currentTokenIssuedAtMs = tokenIssuedAt.getTime();
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
