import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";
import { logAccountActivity } from "@/lib/account-activity";
import { getSessionPolicyFailureReason } from "@/lib/security";
import { clearOAuthUiMarker, hasFreshOAuthUiMarker, isRootOAuthCallback, stripRootOAuthCallbackUrl } from "@/lib/oauth-ui-guard";
import { emailInputSchema, passwordSchema } from "@/lib/validators/auth";
import { createAuthThrottleCaptchaError, isAuthThrottleCaptchaError } from "@/lib/auth-throttle-captcha";
import { validateEmailDomainExists } from "@/lib/email-domain-validation";
import { getLastActivityAt } from "@/lib/session-activity";
import { classifyAuthError, isLikelyJwt, purgeLocalAuthState } from "@/lib/auth/session-health";


const log = createLogger("AuthService");
// Per product policy: users should only be signed out after 1 hour of inactivity.
// No absolute max-age cutoff — set to effectively unbounded so it never triggers
// a mid-session logout on its own. Idle timeout is the only client-side enforced policy.
const MAX_SESSION_AGE_MS = Number.POSITIVE_INFINITY;
const IDLE_SESSION_AGE_MS = 60 * 60 * 1000; // 1 hour
const SESSION_STARTED_AT_KEY = "session_started_at";
const SESSION_MARKER_VERSION = 1;
const AUTH_STORAGE_KEY_PATTERN = /^sb-.*-auth-token$/;
const blockedAuthInputError = new Error("Enter a valid email address.");

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

async function logAdminLoginIfElevated(userId?: string | null) {
  if (!userId) return;

  try {
    const { count, error } = await supabase
      .from("user_roles")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", userId)
      .eq("role", "admin");

    if (error || (count ?? 0) === 0) return;

    await supabase.rpc("write_audit_log", {
      p_event_type: "authn_admin_login_success",
      p_table_name: "auth.users",
      p_record_id: userId,
      p_user_id: userId,
      p_changed_fields: [
        `origin:${window.location.origin}`,
        `path:${window.location.pathname}`,
        `user_agent:${navigator.userAgent.slice(0, 160)}`,
      ],
      p_error_message: null,
    });
  } catch {
    // Admin login telemetry must never block a successful login.
  }
}

// LCL-FIX-008: Module-level single-flight lock around setSession so two
// parallel signInWithPassword calls (rapid double-click, retry race) cannot
// interleave writes to `sb-*-auth-token` and produce a malformed JWT.
let setSessionInflight: Promise<unknown> | null = null;
async function singleFlightSetSession(tokens: { access_token: string; refresh_token: string }) {
  if (setSessionInflight) {
    await setSessionInflight.catch(() => undefined);
  }
  const p = supabase.auth.setSession(tokens);
  setSessionInflight = p;
  try {
    return await p;
  } finally {
    if (setSessionInflight === p) setSessionInflight = null;
  }
}

export const AuthService = {
  async signInWithPassword(email: string, password: string, captchaToken?: string, attemptId?: string) {
    const parsedEmail = emailInputSchema.safeParse(email);
    if (!parsedEmail.success || !passwordSchema.safeParse(password).success) {
      throw blockedAuthInputError;
    }
    if (!captchaToken?.trim()) {
      throw new Error("Complete the human verification before trying again.");
    }
    const safeEmail = parsedEmail.data;
    // LCL-FIX-002: client-side DNS check intentionally removed on the login
    // path. The server already runs a fail-open domain check inside
    // `login-with-captcha`, and DoH hiccups on the client were a top cause
    // of "Use an email address with a real domain." false rejects. Domain
    // typo prevention still runs on registration where it adds value.
    void logAccountActivity("login_attempt_started", { email: safeEmail });
    return log.track("signInWithPassword", `Authenticating user ${safeEmail}`, { email: safeEmail }, async () => {
      const { data, error } = await supabase.functions.invoke<{ session: AuthSession; user: AuthSession["user"] }>("login-with-captcha", {
        body: { email: safeEmail, password, captchaToken: captchaToken.trim(), ...(attemptId ? { attemptId } : {}) },
      }).then(async (res) => {
        if (res.error) return { data: null, error: res.error };
        if (res.data?.session?.access_token && res.data.session.refresh_token) {
          const setSessionResult = await singleFlightSetSession({
            access_token: res.data.session.access_token,
            refresh_token: res.data.session.refresh_token,
          });
          return setSessionResult as { data: { session: AuthSession | null; user: AuthSession["user"] | null }; error: null } | { data: null; error: Error };
        }
        return { data: null, error: new Error("Invalid login response") };
      });
      if (error) {
        log.error("signInWithPassword", `Authentication failed for ${safeEmail}: ${error.message}`, { email: safeEmail, errorCode: error.status }, error);
        void logAccountActivity("login_failed", { email: safeEmail, errorMessage: error.message, errorCode: error.status });
        if (error.status === 429 || error.message.toLowerCase().includes("too many rapid auth attempts")) throw createAuthThrottleCaptchaError();
        throw new Error("Invalid email or password. Please try again.");
      }
      // LCL-FIX-004 (revised): Post-setSession round-trip validation is
      // non-fatal. The supabase client already validated tokens during
      // setSession; an extra getUser() call here can race against residual
      // `sb-*-auth-token` entries from a just-ended session and return
      // `bad_jwt` even though the new session is valid. If it fails, retry
      // once after letting the storage write settle; if it still fails, log
      // and continue — the onAuthStateChange listener and subsequent API
      // calls will surface any real problem.
      try {
        let { data: userCheck, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userCheck?.user) {
          await new Promise((r) => setTimeout(r, 120));
          ({ data: userCheck, error: userErr } = await supabase.auth.getUser());
        }
        if (userErr || !userCheck?.user) {
          log.warn("signInWithPassword", "Post-setSession getUser() did not confirm a user; continuing (session was set successfully).", { email: safeEmail }, userErr ?? undefined);
        }
      } catch (validationErr) {
        log.warn("signInWithPassword", "Post-setSession validation threw; continuing without forcing sign-out.", { email: safeEmail }, validationErr);
      }

      if (data.session) writeSessionMarker(data.session);
      log.info("signInWithPassword", `User ${safeEmail} authenticated successfully`, { userId: data.user?.id });
      void logAccountActivity("login_succeeded", { email: safeEmail, userId: data.user?.id });
      void logAdminLoginIfElevated(data.user?.id);
      return data;
    });
  },


  async signUp(email: string, password: string, firstName: string, lastName: string, redirectTo: string, captchaToken: string, birthYear?: number) {
    const parsedEmail = emailInputSchema.safeParse(email);
    if (!parsedEmail.success || !passwordSchema.safeParse(password).success) {
      throw blockedAuthInputError;
    }
    const safeCaptchaToken = captchaToken.trim();
    if (!safeCaptchaToken) throw new Error("Complete the human verification before trying again.");
    const safeEmail = parsedEmail.data;
    const domainCheck = await validateEmailDomainExists(safeEmail);
    if (!domainCheck.valid) throw new Error(domainCheck.message ?? "Use an email address with a real domain.");
    void logAccountActivity("signup_attempt_started", { email: safeEmail, details: { hasName: Boolean(firstName && lastName) } });
    return log.track("signUp", `Registering new user ${safeEmail}`, { email: safeEmail, firstName, lastName }, async () => {
      const attempt = async () =>
        supabase.auth.signUp({
          email: safeEmail,
          password,
          options: {
            data: {
              full_name: `${firstName} ${lastName}`.trim(),
              first_name: firstName,
              last_name: lastName,
              ...(birthYear ? { birth_year: birthYear } : {}),
            },
            emailRedirectTo: redirectTo,
            captchaToken: safeCaptchaToken,
          },
        });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Sign-up request timed out. Please try again.")), 30_000)
      );

      // Auto-retry once on transient 5xx / network blips before surfacing.
      let lastErr: { message: string; status?: number; code?: string } | null = null;
      let data: any = null;
      for (let i = 0; i < 2; i++) {
        try {
          const res = await Promise.race([attempt(), timeoutPromise]);
          if (!res.error) { data = res.data; lastErr = null; break; }
          if (res.error.status === 429 || res.error.message.toLowerCase().includes("too many rapid auth attempts")) throw createAuthThrottleCaptchaError();
          lastErr = { message: res.error.message, status: res.error.status, code: (res.error as any).code };
          const transient = !res.error.status || res.error.status >= 500 || res.error.status === 0;
          if (!transient) break;
          await new Promise(r => setTimeout(r, 600 * (i + 1)));
        } catch (networkErr: any) {
          if (isAuthThrottleCaptchaError(networkErr)) throw networkErr;
          // Catches the timeoutPromise rejection AND any fetch-level network failures (offline, DNS, CORS).
          lastErr = { message: networkErr?.message ?? "Network error", status: 0 };
          void logAccountActivity("signup_network_error", { email: safeEmail, errorMessage: lastErr.message });
          break;
        }
      }

      if (lastErr) {
        // Persist the REAL Supabase error so admins can diagnose, but surface a friendly mapped message to the user.
        log.error("signUp", `Registration failed for ${safeEmail}: [${lastErr.status ?? "?"}] ${lastErr.message}`,
          { email: safeEmail, errorCode: lastErr.status, errorName: lastErr.code }, lastErr as Error);
        void logAccountActivity("signup_supabase_error", {
          email: safeEmail,
          errorMessage: lastErr.message,
          errorCode: lastErr.status ?? lastErr.code ?? "unknown",
        });

        const m = (lastErr.message || "").toLowerCase();
        // Map common Supabase auth errors to actionable user messaging.
        if (m.includes("already registered") || m.includes("already been registered") || m.includes("user already")) {
          const e: any = new Error("ACCOUNT_EXISTS");
          e.code = "ACCOUNT_EXISTS";
          throw e;
        }
        if (m.includes("pwned") || m.includes("compromised")) {
          throw new Error("This password has appeared in a known data breach. Please choose a different password.");
        }
        if (m.includes("weak") || m.includes("password should") || m.includes("password must")) {
          throw new Error(`Password rejected: ${lastErr.message}`);
        }
        if (m.includes("rate") || lastErr.status === 429) {
          throw new Error("Too many signup attempts from your network. Please wait a few minutes and try again.");
        }
        if (m.includes("invalid") && m.includes("email")) {
          throw new Error("That email address looks invalid. Please double-check and try again.");
        }
        if (m.includes("signup") && m.includes("disabled")) {
          throw new Error("Account creation is temporarily unavailable. Please contact support.");
        }
        if (lastErr.status && lastErr.status >= 500) {
          throw new Error("The signup service is temporarily unavailable. Please try again in a minute.");
        }
        // Last-resort: surface the actual server message so the user (and we) can act on it.
        throw new Error(lastErr.message || "Unable to create account. Please try again or use a different email.");
      }

      // Supabase anti-enumeration: when an email is already registered, the
      // server returns a fake "success" with a user object whose identities
      // array is empty and no session. Detect and surface as ACCOUNT_EXISTS so
      // the UI can show a "sign in instead" CTA rather than a misleading
      // "check your email" screen.
      const looksLikeExistingUser =
        data?.user &&
        Array.isArray(data.user.identities) &&
        data.user.identities.length === 0 &&
        !data.session;
      if (looksLikeExistingUser) {
        log.info("signUp", `Signup blocked: account already exists for ${safeEmail}`, { email: safeEmail });
        void logAccountActivity("signup_blocked_existing_account", { email: safeEmail });
        const e: any = new Error("ACCOUNT_EXISTS");
        e.code = "ACCOUNT_EXISTS";
        throw e;
      }

      log.info("signUp", `User ${safeEmail} registered successfully, confirmation email sent`, {
        userId: data?.user?.id,
        confirmationRequired: !data?.session,
      });
      void logAccountActivity("signup_succeeded", {
        email: safeEmail,
        userId: data?.user?.id,
        details: { confirmationRequired: !data?.session },
      });
      return data;
    });
  },

  async resendSignupConfirmation(email: string, redirectTo: string, captchaToken: string) {
    const parsedEmail = emailInputSchema.safeParse(email);
    if (!parsedEmail.success) throw blockedAuthInputError;
    const safeCaptchaToken = captchaToken.trim();
    if (!safeCaptchaToken) throw new Error("Complete the human verification before trying again.");
    const safeEmail = parsedEmail.data;
    const domainCheck = await validateEmailDomainExists(safeEmail);
    if (!domainCheck.valid) throw new Error(domainCheck.message ?? "Use an email address with a real domain.");
    void logAccountActivity("signup_confirmation_resend_requested", { email: safeEmail });
    return log.track("resendSignupConfirmation", `Requesting signup confirmation email for ${safeEmail}`, { email: safeEmail }, async () => {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: safeEmail,
        options: { emailRedirectTo: redirectTo, captchaToken: safeCaptchaToken },
      });

      if (error) {
        log.warn("resendSignupConfirmation", `Confirmation resend failed for ${safeEmail}: ${error.message}`, { email: safeEmail, errorCode: error.status }, error);
        void logAccountActivity("signup_confirmation_resend_failed", {
          email: safeEmail,
          errorMessage: error.message,
          errorCode: error.status,
        });

        const message = error.message.toLowerCase();
        if (message.includes("rate") || error.status === 429) {
          throw new Error("Too many verification email requests. Please wait a few minutes and try again.");
        }
        throw new Error("We could not resend the verification email right now. Please try again in a minute.");
      }

      log.info("resendSignupConfirmation", `Confirmation resend accepted for ${safeEmail}`, { email: safeEmail });
      void logAccountActivity("signup_confirmation_resend_succeeded", { email: safeEmail });
    });
  },

  async resetPassword(email: string, redirectTo: string, captchaToken?: string) {
    const parsedEmail = emailInputSchema.safeParse(email);
    if (!parsedEmail.success) throw blockedAuthInputError;
    const safeCaptchaToken = captchaToken?.trim();
    if (captchaToken !== undefined && !safeCaptchaToken) throw new Error("Complete the human verification before trying again.");
    const safeEmail = parsedEmail.data;
    const domainCheck = await validateEmailDomainExists(safeEmail);
    if (!domainCheck.valid) throw new Error(domainCheck.message ?? "Use an email address with a real domain.");
    return log.track("resetPassword", `Sending password reset for ${safeEmail}`, { email: safeEmail }, async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(safeEmail, {
        redirectTo,
        ...(safeCaptchaToken ? { captchaToken: safeCaptchaToken } : {}),
      });
      if (error) {
        log.warn("resetPassword", `Password reset request failed for ${safeEmail}: ${error.message}`, { email: safeEmail }, error);
        void logAccountActivity("password_reset_failed", { email: safeEmail, errorMessage: error.message, errorCode: error.status });
        if (error.status === 429 || error.message.toLowerCase().includes("too many rapid auth attempts")) throw createAuthThrottleCaptchaError();
        throw new Error("If an account exists with that email, a reset link has been sent.");
      }
      log.info("resetPassword", `Password reset email sent for ${safeEmail}`, { email: safeEmail });
      void logAccountActivity("password_reset_requested", { email: safeEmail });
    });
  },

  async updatePassword(newPassword: string): Promise<{ otherDevicesRevoked: boolean }> {
    return log.track("updatePassword", "Updating user password", undefined, async () => {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        log.error("updatePassword", `Password update failed: ${error.message}`, { errorCode: error.status }, error);
        throw new Error("Failed to update password. Please try again.");
      }
      log.info("updatePassword", "Password updated successfully");
      void logAccountActivity("password_updated", {});
      // Keep the current device signed in; revoke other devices via the
      // server-side `revoked_sessions` gate. A revoke failure must NEVER
      // mask a successful password change.
      let otherDevicesRevoked = false;
      try {
        const result = await this.signOutAllDevices({
          keepCurrent: true,
          reason: "self_password_changed",
        });
        otherDevicesRevoked = result.revocationRecorded;
      } catch (revokeErr) {
        log.warn(
          "updatePassword",
          `Other-device revocation failed (non-fatal): ${(revokeErr as Error)?.message}`,
          undefined,
          revokeErr instanceof Error ? revokeErr : undefined,
        );
      }
      return { otherDevicesRevoked };
    });
  },

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
