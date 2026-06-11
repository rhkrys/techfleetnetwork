import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  extractBearerToken,
  getAdminClient,
  getUserClient,
} from "./admin-client.ts";
import { jsonResponse } from "./http.ts";
import { auditEdgeEvent, getOrCreateTraceId } from "./audit.ts";
import type { AuditSeverity } from "./audit.ts";

export interface AuthenticatedRequestContext {
  authHeader: string;
  token: string;
  userId: string;
  userClient: SupabaseClient;
}

/**
 * Optional `fn` lets the helper emit `authn_unauthorized` / `authz_admin_denied`
 * audit rows tagged with the calling function name. Backwards-compatible
 * (older call sites that omit `fn` simply skip the audit emission).
 */
export async function requireAuthenticatedRequest(
  req: Request,
  fn?: string,
  options: { missingTokenSeverity?: AuditSeverity } = {},
): Promise<AuthenticatedRequestContext | Response> {
  const token = extractBearerToken(req);
  if (!token) {
    if (fn) {
      void auditEdgeEvent(getAdminClient(), {
        fn,
        event: "authn_unauthorized",
        severity: options.missingTokenSeverity ?? "warn",
        traceId: getOrCreateTraceId(req),
        fields: ["reason:missing_token"],
      });
    }
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const authHeader = `Bearer ${token}`;
  const userClient = getUserClient(authHeader);
  const { data, error } = await userClient.auth.getClaims(token);
  const userId = data?.claims?.sub;

  if (error || !userId) {
    if (fn) {
      void auditEdgeEvent(getAdminClient(), {
        fn,
        event: "authn_unauthorized",
        severity: "warn",
        traceId: getOrCreateTraceId(req),
        fields: ["reason:invalid_token"],
      });
    }
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  return { authHeader, token, userId, userClient };
}

export async function requireAdminRequest(
  req: Request,
  fn?: string,
): Promise<AuthenticatedRequestContext | Response> {
  const auth = await requireAuthenticatedRequest(req, fn);
  if (auth instanceof Response) return auth;

  const { data, error } = await getAdminClient().rpc("has_role", {
    _user_id: auth.userId,
    _role: "admin",
  });

  if (error) {
    console.error(
      JSON.stringify({ level: "error", action: "admin_authorization_check" }),
    );
    if (fn) {
      void auditEdgeEvent(getAdminClient(), {
        fn,
        event: "authz_check_failed",
        severity: "error",
        userId: auth.userId,
        traceId: getOrCreateTraceId(req),
        errorMessage: error.message,
      });
    }
    return jsonResponse({ error: "Unable to verify authorization" }, 500);
  }

  if (data !== true) {
    if (fn) {
      void auditEdgeEvent(getAdminClient(), {
        fn,
        event: "authz_admin_denied",
        severity: "warn",
        userId: auth.userId,
        traceId: getOrCreateTraceId(req),
        fields: ["required_role:admin"],
      });
    }
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  return auth;
}
