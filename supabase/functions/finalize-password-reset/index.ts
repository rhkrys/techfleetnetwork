// @edge-auth required
/**
 * finalize-password-reset
 *
 * Completes a recovery-session password update server-side, then records a
 * keep-current session revocation so every other browser must use the new
 * password. The caller must present the active recovery JWT.
 */
import { z } from "npm:zod@4.3.6";
import { getAdminClient, getUserClient } from "../_shared/admin-client.ts";
import { errorResponse, handleCors, jsonResponse, parseJsonBody } from "../_shared/http.ts";
import { requireAuthenticatedRequest } from "../_shared/request-auth.ts";
import { withAuditWrapper } from "../_shared/audit.ts";

const BodySchema = z.object({
  password: z.string().min(8).max(512),
});

function tokenIssuedAt(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { iat?: number };
    return typeof decoded.iat === "number" ? new Date(decoded.iat * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

function classifyUpdateError(error: { code?: string; status?: number; message?: string }) {
  const code = (error.code ?? "").toLowerCase();
  const msg = (error.message ?? "").toLowerCase();
  if (code === "same_password" || msg.includes("should be different") || msg.includes("same as the old")) {
    return { status: 400, code: "same_password", message: "Pick a password you haven't used here before." };
  }
  if (code === "weak_password" || msg.includes("pwned") || msg.includes("breach") || msg.includes("weak")) {
    return { status: 400, code: "weak_password", message: "This password appeared in a known data breach. Choose a different one." };
  }
  if (error.status === 401 || msg.includes("session") || msg.includes("jwt")) {
    return { status: 401, code: "session_expired", message: "Your password reset link expired. Request a new one to continue." };
  }
  if (error.status === 429 || msg.includes("rate")) {
    return { status: 429, code: "rate_limited", message: "Too many attempts in a short time. Please wait a minute and try again." };
  }
  return { status: error.status && error.status >= 400 ? error.status : 500, code: "service_unavailable", message: "We're briefly unable to reach the password service. Please try again in a moment." };
}

Deno.serve(withAuditWrapper("finalize-password-reset", async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const auth = await requireAuthenticatedRequest(req, "finalize-password-reset");
    if (auth instanceof Response) return auth;

    const parsed = BodySchema.safeParse(await parseJsonBody(req, 8 * 1024));
    if (!parsed.success) {
      return jsonResponse({ code: "weak_password", message: "Choose a stronger password." }, 400);
    }

    const userClient = getUserClient(auth.authHeader);
    const { error: updateError } = await userClient.auth.updateUser({ password: parsed.data.password });
    if (updateError) {
      const mapped = classifyUpdateError(updateError as { code?: string; status?: number; message?: string });
      return jsonResponse(mapped, mapped.status);
    }

    let revocationRecorded = false;
    const admin = getAdminClient();
    const { error: insertError } = await admin.from("revoked_sessions").insert({
      user_id: auth.userId,
      reason: "self_password_changed",
      revoked_by: auth.userId,
      revoke_before: tokenIssuedAt(auth.token),
    });
    revocationRecorded = !insertError;

    await admin.auth.admin.signOut(auth.userId, "others").catch(() => undefined);
    await admin.rpc("record_event", {
      p_sink: "ops_events",
      p_kind: "auth.recovery.update_success",
      p_actor: auth.userId,
      p_payload: { other_sessions_revoked: revocationRecorded },
      p_severity: "info",
      p_ref_table: "auth.users",
      p_ref_id: auth.userId,
    }).catch(() => undefined);

    return jsonResponse({ ok: true, other_devices_revoked: revocationRecorded });
  } catch (err) {
    return errorResponse(err, "Internal error");
  }
}));