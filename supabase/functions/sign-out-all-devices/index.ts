// @edge-auth required
import { withAuditWrapper } from "../_shared/audit.ts";
/**
 * sign-out-all-devices
 *
 * Self-serve "sign me out of every device" endpoint, also used after a
 * password reset.
 *
 * Contract (post AUTH-REVOKE-010):
 *  1. SOURCE OF TRUTH = a row in `public.revoked_sessions`. Other devices hit
 *     `is_session_revoked()` on next `getSession()` and self-evict. We MUST
 *     write this row for the security guarantee to hold.
 *  2. `auth.admin.signOut(userId, "global")` is BEST-EFFORT. GoTrue can return
 *     errors when there are no other active sessions or for recently-recreated
 *     users. None of those should surface as a user-visible error.
 *  3. Optional `keep_current: true` keeps the calling device's tokens valid —
 *     the JWT issued AFTER the revoke row passes `is_session_revoked`, so the
 *     user stays signed in on the device they just used.
 *
 * Always returns 200 unless unauthenticated or the revocation row insert
 * itself fails.
 */
import { getAdminClient } from "../_shared/admin-client.ts";
import { errorResponse, handleCors, jsonResponse } from "../_shared/http.ts";
import { requireAuthenticatedRequest } from "../_shared/request-auth.ts";
import { createEdgeLogger } from "../_shared/logger.ts";

const log = createEdgeLogger("sign-out-all-devices");

const ALLOWED_REASONS = new Set([
  "self_password_changed",
  "self_requested",
  "admin_revoked",
  "security_concern",
]);

interface RequestBody {
  reason?: string;
  keep_current?: boolean;
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

Deno.serve(withAuditWrapper("sign-out-all-devices", async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const requestId = crypto.randomUUID().substring(0, 8);

  try {
    const auth = await requireAuthenticatedRequest(req);
    if (auth instanceof Response) {
      log.warn("auth", `Missing Authorization header [${requestId}]`, { requestId });
      return auth;
    }

    let body: RequestBody = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text) as RequestBody;
    } catch {
      // Tolerate empty/invalid body — defaults are fine.
    }

    const reason = ALLOWED_REASONS.has(body.reason ?? "")
      ? body.reason!
      : "self_requested";
    const keepCurrent = body.keep_current === true;

    const admin = getAdminClient();

    // Step A — SOURCE OF TRUTH. If this fails, surface 500.
    const { error: insertError } = await admin
      .from("revoked_sessions")
      .insert({
        user_id: auth.userId,
        reason,
        revoked_by: auth.userId,
        revoke_before: keepCurrent ? tokenIssuedAt(auth.token) : null,
      });

    if (insertError) {
      log.error(
        "revoke",
        `Failed to record revocation [${requestId}]: ${insertError.message}`,
        { requestId, userId: auth.userId },
        insertError,
      );
      return jsonResponse(
        { error: "Failed to record revocation. Please try again." },
        500,
      );
    }

    // Step B — BEST-EFFORT GoTrue invalidation. Errors are non-fatal.
    let gotrueSignedOut = false;
    if (!keepCurrent) {
      const { error: signOutError } = await admin.auth.admin.signOut(
        auth.userId,
        "global",
      );
      if (signOutError) {
        log.warn(
          "revoke",
          `GoTrue admin.signOut returned non-fatal error [${requestId}]: ${signOutError.message}`,
          { requestId, userId: auth.userId },
        );
      } else {
        gotrueSignedOut = true;
      }
    }

    log.info(
      "revoke",
      `Revocation recorded for ${auth.userId} [${requestId}] reason=${reason} keepCurrent=${keepCurrent} gotrueSignedOut=${gotrueSignedOut}`,
      { requestId, userId: auth.userId },
    );

    return jsonResponse({
      success: true,
      revocation_recorded: true,
      gotrue_signed_out: gotrueSignedOut,
      keep_current: keepCurrent,
      reason,
    });
  } catch (err) {
    log.error(
      "handler",
      `Unhandled exception [${requestId}]`,
      { requestId },
      err,
    );
    return errorResponse(err, "Internal error");
  }
}));
