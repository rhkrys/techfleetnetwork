// @edge-auth required
/**
 * finalize-password-reset
 *
 * Completes a recovery-session password update server-side, then records a
 * keep-current session revocation so every other browser must use the new
 * password. The caller must present the active recovery JWT.
 */
import { z } from "npm:zod@4.3.6";
import { getAdminClient } from "../_shared/admin-client.ts";
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
  if (error.status === 401 || error.status === 403 || msg.includes("unauthorized") || msg.includes("session") || msg.includes("jwt")) {
    return { status: 401, code: "session_expired", message: "Your password reset link expired. Request a new one to continue." };
  }
  if (error.status === 429 || msg.includes("rate")) {
    return { status: 429, code: "rate_limited", message: "Too many attempts in a short time. Please wait a minute and try again." };
  }
  if (!error.status || error.status >= 500 || msg.includes("failed to fetch") || msg.includes("network")) {
    return { status: 503, code: "service_unavailable", message: "The password update service is temporarily unavailable. Please try again." };
  }
  return { status: 400, code: "weak_password", message: "Choose a stronger password." };
}

async function updatePasswordWithRecoveryJwt(authHeader: string, password: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !anonKey) {
    return { error: { status: 503, message: "Password update configuration is missing." } };
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: anonKey,
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  const body = await response.json().catch(() => ({})) as { code?: string; error_code?: string; error?: string; msg?: string; message?: string };
  if (response.ok) return { error: null };
  return {
    error: {
      status: response.status,
      code: body.code ?? body.error_code,
      message: body.message ?? body.msg ?? body.error ?? "Password update failed.",
    },
  };
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

    const { error: updateError } = await updatePasswordWithRecoveryJwt(auth.authHeader, parsed.data.password);
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