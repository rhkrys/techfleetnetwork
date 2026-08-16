// Authorization for the community-events refresh trigger.
//
// Why this exists (audit 2026-08, docs/audits/events-calendar-audit-2026-08.md):
// the cron→function trigger used to authenticate with the project SERVICE-ROLE
// key. That key is duplicated across three independently-managed places (Vault,
// the function's injected env, the dashboard) and rotates / changes at cutover —
// so a drift in any copy silently 403s the refresh and the calendar goes stale
// with no signal. This decouples the *trigger* credential from the rotating
// service-role key: the cron sends a dedicated EVENTS_REFRESH_SECRET instead.
//
// Security posture: this is ADDITIVE and FAIL-CLOSED. The service-role exact
// match (audit C1) is unchanged and still accepted. If EVENTS_REFRESH_SECRET is
// unset, only the service-role path is available — access is never widened.

import { authorizeServiceRoleRequest, timingSafeEqualStr } from "../_shared/service-role-auth.ts";

export type RefreshAuthResult =
  { ok: true; via: "refresh_secret" | "service_role" } | { ok: false; status: 401 | 403 };

export function authorizeRefreshRequest(req: Request): RefreshAuthResult {
  // Preferred path: dedicated, rotation-stable trigger secret.
  const refreshSecret = Deno.env.get("EVENTS_REFRESH_SECRET") ?? "";
  if (refreshSecret) {
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice("Bearer ".length).trim();
      // Constant-time compare — never leak the secret via timing.
      if (token && timingSafeEqualStr(token, refreshSecret)) {
        return { ok: true, via: "refresh_secret" };
      }
    }
  }

  // Backward-compatible path: the service-role key still works (exact match,
  // unchanged). Kept so this deploys with zero behaviour change before the
  // dedicated secret is provisioned, and as a break-glass.
  const svc = authorizeServiceRoleRequest(req);
  if (svc.ok) return { ok: true, via: "service_role" };
  return { ok: false, status: svc.status };
}
