// Shared service-role bearer validator for cron-poked / internal-only workers.
//
// Security (audit C1, 2026-08): service-role is granted ONLY by a constant-time
// exact match against SUPABASE_SERVICE_ROLE_KEY. The previous version also
// accepted ANY JWT whose base64 payload said role="service_role" WITHOUT
// verifying the signature — an unauthenticated attacker could forge
// `x.<base64 {"role":"service_role"}>.x` and run every verify_jwt=false worker.
// That fallback is removed. This is safe: cron jobs are invoked with the
// service-role key from Vault (see 20260707200000_recreate_cron_jobs_on_live_project.sql),
// and the correct callers (e.g. send-transactional-email) already exact-match only.
//
// If a *signed*-JWT path is ever genuinely required, verify the signature against
// the GoTrue JWKS / SUPABASE_JWT_SECRET — never trust an unverified `role` claim.

export type ServiceRoleAuthResult =
  { ok: true; mode: "opaque" } | { ok: false; status: 401 | 403; error: string };

/** Constant-time string comparison (avoids leaking the key via timing). Length
 *  mismatch short-circuits — acceptable, as key length is not secret. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
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
    // Server misconfig — fail closed (401 so callers don't retry-storm).
    return { ok: false, status: 401, error: "Server configuration error" };
  }

  // ONLY a constant-time exact match is accepted. No JWT-claim decoding.
  if (timingSafeEqualStr(token, serviceKey)) {
    return { ok: true, mode: "opaque" };
  }
  return { ok: false, status: 403, error: "Forbidden" };
}

// Test seam.
export const __test = { timingSafeEqualStr };
