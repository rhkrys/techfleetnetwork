/**
 * sign-in.service — the ONE password-sign-in owner.
 *
 * AUTH-DIRECT-SIGNIN-004 (2026-06-12): the active /login form (SignInScreen →
 * useSignInEngine → sign-in-password.flow) routes here. This is the only
 * non-legacy module that owns email+password sign-in. It calls the auth SDK
 * through `supabaseSessionAdapter.signInPassword`; there is NO edge-token
 * handoff, NO `setSession`, NO `login-with-captcha` invocation.
 *
 * Legacy `AuthService.signInWithPassword` has been removed; CI guard
 * `scripts/ci/check-auth-direct-signin.mjs` blocks its reintroduction.
 */
import { supabaseSessionAdapter } from "@/features/auth/adapters/supabase-session.adapter";
import { ClientSessionWriteError } from "@/lib/auth/session-health";
import { createAuthThrottleCaptchaError } from "@/lib/auth-throttle-captcha";
import { logAccountActivity } from "@/lib/account-activity";
import { emailInputSchema, loginPasswordSchema } from "@/lib/validators/auth";
import { createLogger } from "@/services/logger.service";
import { supabase } from "@/integrations/supabase/client";

const log = createLogger("sign-in.service");
const blockedAuthInputError = new Error("Enter a valid email address.");

const SESSION_STARTED_AT_KEY = "session_started_at";
const SESSION_MARKER_VERSION = 1;

interface AuthSessionShape {
  user: { id: string };
}

function writeSessionMarker(session: AuthSessionShape, startedAtMs = Date.now()) {
  try {
    sessionStorage.setItem(
      SESSION_STARTED_AT_KEY,
      JSON.stringify({ version: SESSION_MARKER_VERSION, userId: session.user.id, startedAtMs }),
    );
  } catch {
    /* storage blocked — idle policy will reset on next getSession */
  }
}

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
    /* use fallback */
  }
  return {
    status: response?.status ?? (typeof directStatus === "number" ? directStatus : undefined),
    message,
    code: code ?? (typeof directCode === "string" ? directCode : undefined),
  };
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
    /* admin audit must never block sign-in */
  }
}

export interface SignInResult {
  session: NonNullable<Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]>;
  user: NonNullable<Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]>["user"];
}

export async function signInWithPasswordService(email: string, password: string, captchaToken?: string): Promise<SignInResult> {
  const parsedEmail = emailInputSchema.safeParse(email);
  if (!parsedEmail.success || !loginPasswordSchema.safeParse(password).success) {
    throw blockedAuthInputError;
  }
  if (!captchaToken?.trim()) {
    throw new Error("Complete the human verification before trying again.");
  }
  const safeEmail = parsedEmail.data;

  void logAccountActivity("login_attempt_started", { email: safeEmail });

  const { data, error } = await supabaseSessionAdapter.signInPassword({
    email: safeEmail,
    password,
    captchaToken: captchaToken.trim(),
  });

  if (error) {
    if (error instanceof ClientSessionWriteError) throw error;
    const fnError = await readFunctionError(error);
    log.error("signInWithPassword", `Authentication failed for ${safeEmail}: ${fnError.message}`, { email: safeEmail, errorCode: fnError.status ?? fnError.code }, error);
    void logAccountActivity("login_failed", { email: safeEmail, errorMessage: fnError.message, errorCode: fnError.status ?? fnError.code });
    if (fnError.status === 429 || fnError.code === "rate_limited" || fnError.message.toLowerCase().includes("too many rapid auth attempts")) {
      throw createAuthThrottleCaptchaError();
    }
    if (typeof fnError.status === "number" && fnError.status >= 500) {
      const serviceError = new Error("The sign-in service hit a snag. Please try again in a moment.") as Error & { status?: number; code?: string };
      serviceError.status = fnError.status;
      serviceError.code = "service_unavailable";
      throw serviceError;
    }
    if (fnError.code === "CAPTCHA_REQUIRED" || fnError.message.toLowerCase().includes("human verification")) {
      const captchaError = new Error("Complete the human verification below before signing in.") as Error & { status?: number; code?: string };
      captchaError.status = fnError.status;
      captchaError.code = "captcha_required";
      throw captchaError;
    }
    if (fnError.code?.toLowerCase() === "captcha_failed" || fnError.message.toLowerCase().includes("captcha")) {
      const captchaError = new Error("Complete the human verification below before signing in.") as Error & { status?: number; code?: string };
      captchaError.status = fnError.status;
      captchaError.code = "captcha_failed";
      throw captchaError;
    }
    const credentialError = new Error("Invalid email or password. Please try again.") as Error & { status?: number; code?: string };
    credentialError.status = fnError.status ?? 401;
    credentialError.code = "invalid_credentials";
    throw credentialError;
  }

  if (!data?.session?.access_token) {
    throw new ClientSessionWriteError("set_session_rejected", "Sign-in didn't complete — please try again.");
  }

  // Post-success getUser is best-effort; the SDK already validated the
  // session. Failure here is logged but never punishes the member.
  try {
    let { data: userCheck, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userCheck?.user) {
      await new Promise((r) => setTimeout(r, 120));
      ({ data: userCheck, error: userErr } = await supabase.auth.getUser());
    }
    if (userErr || !userCheck?.user) {
      log.warn("signInWithPassword", "Post-sign-in getUser() did not confirm a user; continuing (session was set successfully).", { email: safeEmail }, userErr ?? undefined);
    }
  } catch (validationErr) {
    log.warn("signInWithPassword", "Post-sign-in validation threw; continuing without forcing sign-out.", { email: safeEmail }, validationErr);
  }

  writeSessionMarker(data.session);
  log.info("signInWithPassword", `User ${safeEmail} authenticated successfully`, { userId: data.user?.id });
  void logAccountActivity("login_succeeded", { email: safeEmail, userId: data.user?.id });
  void logAdminLoginIfElevated(data.user?.id);
  return { session: data.session, user: data.user };
}
