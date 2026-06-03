import { withAuditWrapper, auditEdgeEvent } from "../_shared/audit.ts";
import { getAdminClient } from "../_shared/admin-client.ts";
import { errorResponse, handleCors, jsonResponse, parseJsonBody } from "../_shared/http.ts";
import { requireAuthenticatedRequest } from "../_shared/request-auth.ts";
import { createEdgeLogger } from "../_shared/logger.ts";

const log = createEdgeLogger("update-password-confirmed");

function validatePassword(password: string): string | null {
  if (password.length < 12) return "At least 12 characters";
  if (password.length > 128) return "Password must be under 128 characters";
  if (!/[A-Z]/.test(password)) return "One uppercase letter required";
  if (!/[a-z]/.test(password)) return "One lowercase letter required";
  if (!/[0-9]/.test(password)) return "One number required";
  if (!/[^A-Za-z0-9]/.test(password)) return "One special character required";
  return null;
}

function tokenIssuedAt(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { iat?: number };
    return typeof decoded.iat === "number" ? new Date(decoded.iat * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

/**
 * Map GoTrue's auth.updateUser errors to a structured, actionable code.
 * The legacy version returned the same generic banner for every failure,
 * which caused members to retype the same password 5+ times and then
 * trip the device-side login lockout. See AUTH-RESET-001..006 + the
 * 2026-06-03 incident: a member's recovery link "rejected new password
 * over and over and then locked them out."
 */
type RejectCode =
  | "same_password"
  | "weak_password"
  | "session_expired"
  | "rate_limited"
  | "unknown";

function classifyGoTrueError(err: { message?: string; code?: string; status?: number }): {
  code: RejectCode;
  status: number;
  message: string;
  retryAfter?: number;
} {
  const code = (err.code || "").toLowerCase();
  const msg = (err.message || "").toLowerCase();

  if (code === "same_password" || msg.includes("should be different from") || msg.includes("same as the old")) {
    return { code: "same_password", status: 400, message: "Pick a password you haven't used here before." };
  }
  if (code === "weak_password" || msg.includes("pwned") || msg.includes("breach") || msg.includes("weak password")) {
    return {
      code: "weak_password",
      status: 400,
      message: "This password appeared in a known data breach. Choose a different one.",
    };
  }
  if (
    code === "session_not_found" ||
    code === "no_authorization" ||
    code === "bad_jwt" ||
    err.status === 401 ||
    msg.includes("session") && (msg.includes("expired") || msg.includes("not found")) ||
    msg.includes("jwt expired")
  ) {
    return {
      code: "session_expired",
      status: 401,
      message: "Your password reset link expired. Request a new one to continue.",
    };
  }
  if (code === "over_request_rate_limit" || err.status === 429 || msg.includes("rate limit")) {
    return {
      code: "rate_limited",
      status: 429,
      message: "Too many attempts in a short time. Please wait a minute and try again.",
      retryAfter: 60,
    };
  }
  return {
    code: "unknown",
    status: 400,
    message: "We couldn't update your password. Please try again or request a new reset link.",
  };
}

Deno.serve(withAuditWrapper("update-password-confirmed", async (req, ctx) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const auth = await requireAuthenticatedRequest(req, ctx.fn);
    if (auth instanceof Response) return auth;

    const body = await parseJsonBody(req, 8 * 1024) as { password?: unknown; confirmPassword?: unknown };
    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
    const passwordError = validatePassword(password);

    if (passwordError || !confirmPassword || password !== confirmPassword) {
      void auditEdgeEvent(getAdminClient(), {
        fn: ctx.fn,
        event: "password_update_rejected",
        table: "auth.users",
        recordId: auth.userId,
        userId: auth.userId,
        traceId: ctx.traceId,
        severity: "warn",
        fields: [passwordError ? "reason:weak_password_client" : "reason:confirmation_mismatch"],
      });
      return jsonResponse(
        { error: passwordError || "Passwords do not match", code: passwordError ? "weak_password_client" : "confirmation_mismatch" },
        400,
      );
    }

    const { error: updateError } = await auth.userClient.auth.updateUser({ password });
    if (updateError) {
      const classified = classifyGoTrueError(updateError as { message?: string; code?: string; status?: number });
      log.warn("update", `Password update rejected for ${auth.userId} [${classified.code}]: ${updateError.message}`, {
        userId: auth.userId,
        rejectCode: classified.code,
      });
      void auditEdgeEvent(getAdminClient(), {
        fn: ctx.fn,
        event: "password_update_rejected",
        table: "auth.users",
        recordId: auth.userId,
        userId: auth.userId,
        traceId: ctx.traceId,
        severity: classified.code === "rate_limited" ? "warn" : "info",
        fields: [`reason:${classified.code}`],
      });
      const resp = jsonResponse({ error: classified.message, code: classified.code }, classified.status);
      if (classified.retryAfter) resp.headers.set("Retry-After", String(classified.retryAfter));
      return resp;
    }

    const admin = getAdminClient();

    let otherDevicesRevoked = false;
    const { error: revokeError } = await admin.from("revoked_sessions").insert({
      user_id: auth.userId,
      reason: "self_password_changed",
      revoked_by: auth.userId,
      revoke_before: tokenIssuedAt(auth.token),
    });
    if (revokeError) {
      log.warn("revoke", `Password updated but revocation row failed for ${auth.userId}: ${revokeError.message}`, { userId: auth.userId });
    } else {
      otherDevicesRevoked = true;
    }

    // Clear any login-rate-limit bucket for this email so the member can
    // immediately sign in with their new password — they just proved
    // identity via the recovery email.
    try {
      const { data: userRow } = await admin.auth.admin.getUserById(auth.userId);
      const email = userRow?.user?.email;
      if (email) {
        const { error: clearError } = await admin.rpc("clear_login_rate_limit_for_email", { p_email: email });
        if (clearError) {
          log.warn("clear_rate_limit", `Failed to clear login rate limit for ${auth.userId}: ${clearError.message}`, {
            userId: auth.userId,
          });
        }
      }
    } catch (err) {
      log.warn("clear_rate_limit", `Unexpected error clearing rate limit for ${auth.userId}`, {
        userId: auth.userId,
      }, err instanceof Error ? err : undefined);
    }

    void auditEdgeEvent(admin, {
      fn: ctx.fn,
      event: "password_updated",
      table: "auth.users",
      recordId: auth.userId,
      userId: auth.userId,
      traceId: ctx.traceId,
      severity: "info",
      fields: ["confirmed:true", `other_devices_revoked:${otherDevicesRevoked}`],
    });

    return jsonResponse({ success: true, confirmed: true, other_devices_revoked: otherDevicesRevoked });
  } catch (err) {
    return errorResponse(err, "Internal error");
  }
}));
