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
        fields: [passwordError ? "reason:weak_password" : "reason:confirmation_mismatch"],
      });
      return jsonResponse({ error: passwordError || "Passwords do not match" }, 400);
    }

    const admin = getAdminClient();
    const { error: updateError } = await admin.auth.admin.updateUserById(auth.userId, { password });
    if (updateError) {
      log.warn("update", `Password update rejected for ${auth.userId}: ${updateError.message}`, { userId: auth.userId });
      return jsonResponse({ error: "Failed to update password. Please try again." }, 400);
    }

    let otherDevicesRevoked = false;
    const { error: revokeError } = await admin.from("revoked_sessions").insert({
      user_id: auth.userId,
      reason: "self_password_changed",
      revoked_by: auth.userId,
    });
    if (revokeError) {
      log.warn("revoke", `Password updated but revocation row failed for ${auth.userId}: ${revokeError.message}`, { userId: auth.userId });
    } else {
      otherDevicesRevoked = true;
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