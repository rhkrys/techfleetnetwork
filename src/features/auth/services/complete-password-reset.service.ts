/**
 * AUTH-ARCH-CUTOVER-010 — single owner of password-reset completion.
 *
 * Logic moved verbatim from legacy `AuthService.updatePassword` (2026-06-15).
 * Calls the `finalize-password-reset` edge function with the recovery session
 * bearer token. Engines convert thrown errors to typed AuthErr results.
 */
import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";
import { logAccountActivity } from "@/lib/account-activity";
import { validatePasswordSet, type PasswordSetValue } from "@/lib/auth/password-set";

const log = createLogger("auth.complete-password-reset.service");

type PasswordUpdateRejectCode =
  | "same_password"
  | "weak_password"
  | "session_expired"
  | "rate_limited"
  | "service_unavailable"
  | "unknown";

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
    // fallback
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
    code === "session_expired" || code === "session_not_found" || code === "no_authorization" ||
    code === "bad_jwt" || code === "user_not_found" || err.status === 401 ||
    msg.includes("auth session missing") || msg.includes("missing auth session") ||
    msg.includes("not authenticated") || msg.includes("user from sub claim in jwt does not exist") ||
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

export async function completePasswordReset(passwordSet: PasswordSetValue): Promise<{ otherDevicesRevoked: boolean }> {
  return log.track("updatePassword", "Updating user password", undefined, async () => {
    const validation = validatePasswordSet(passwordSet);
    if (!validation.isValid) {
      const err = new Error(validation.passwordError || validation.confirmError) as Error & { code?: string };
      err.code = "weak_password_client";
      throw err;
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession().catch(() => ({
      data: { session: null },
      error: new Error("Recovery session lookup failed"),
    }));
    const accessToken = sessionData.session?.access_token?.trim();
    if (sessionError || !accessToken) {
      const expired = new Error("Your password reset link expired. Request a new one to continue.") as Error & { code?: string };
      expired.code = "session_expired";
      throw expired;
    }

    const { data, error } = await supabase.functions.invoke("finalize-password-reset", {
      body: { password: passwordSet.password },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) {
      const fnError = await readFunctionError(error);
      const classified = classifyPasswordUpdateError(fnError);
      log.error("updatePassword", `Password update failed: ${fnError.message} [${classified.code}]`, { errorCode: classified.code || fnError.status });
      const wrapped = new Error(classified.message) as Error & { code?: string };
      wrapped.code = classified.code;
      throw wrapped;
    }

    log.info("updatePassword", "Password updated successfully");
    void logAccountActivity("password_updated", { details: { confirmed: true } });
    await (async () => {
      const { error: cleanupError } = await supabase.rpc("clear_own_auth_rate_limits_after_password_reset");
      if (cleanupError) {
        log.warn("updatePassword", `Rate-limit cleanup after reset failed: ${cleanupError.message}`);
      }
    })().catch((err) => {
      log.warn("updatePassword", `Rate-limit cleanup after reset failed: ${(err as Error)?.message ?? String(err)}`);
    });
    return { otherDevicesRevoked: Boolean((data as { other_devices_revoked?: boolean } | null)?.other_devices_revoked) };
  });
}
