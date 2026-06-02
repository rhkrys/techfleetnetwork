// Shared service-role bearer validator for cron-poked workers.
//
// Accepts BOTH formats Supabase can send on cron wake:
//   1. Legacy service-role JWT (claims.role === 'service_role')
//   2. Opaque signing-keys token (sb_secret_*), compared to SUPABASE_SERVICE_ROLE_KEY env
//
// Used by every `verify_jwt = false` cron worker (process-email-queue,
// process-freescout-events, etc.) so a key-format change cannot silently
// 401-storm one worker while another keeps working.

export type ServiceRoleAuthResult =
  | { ok: true; mode: "legacy_jwt" | "opaque" }
  | { ok: false; status: 401 | 403; error: string };

function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1]
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function authorizeServiceRoleRequest(req: Request): ServiceRoleAuthResult {
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return { ok: false, status: 401, error: "Unauthorized" };

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey) {
    // Server misconfig — treat as 401 so caller does not retry-storm.
    return { ok: false, status: 401, error: "Server configuration error" };
  }

  if (token === serviceKey) {
    return { ok: true, mode: "opaque" };
  }

  const claims = parseJwtClaims(token);
  if (claims?.role === "service_role") {
    return { ok: true, mode: "legacy_jwt" };
  }

  return { ok: false, status: 403, error: "Forbidden" };
}

// Test seam: exported for unit tests, not for production callers.
export const __test = { parseJwtClaims };
