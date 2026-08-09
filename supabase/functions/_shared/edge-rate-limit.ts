// Audit Wave 2 T-H: per-identity rate limit for public/unauth edge endpoints.
// Keys on the hardened client IP (T-C client-ip.ts) unless an explicit
// identifier is given, and calls the dedicated check_edge_rate_limit RPC.
// Fails OPEN on limiter error (availability > strictness for a best-effort cap).
import { createClient } from "npm:@supabase/supabase-js@2";
import { clientIpOr } from "./client-ip.ts";

export interface EdgeRateLimitResult {
  allowed: boolean;
  identifier: string;
}

export async function enforceEdgeRateLimit(
  req: Request,
  opts: { action: string; max: number; windowMinutes?: number; identifier?: string }
): Promise<EdgeRateLimitResult> {
  const identifier = opts.identifier ?? clientIpOr(req, "unknown");
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data, error } = await admin.rpc("check_edge_rate_limit", {
      p_identifier: identifier,
      p_action: opts.action,
      p_max: opts.max,
      p_window_minutes: opts.windowMinutes ?? 1,
    });
    if (error) return { allowed: true, identifier }; // fail-open
    return { allowed: (data as { allowed?: boolean })?.allowed !== false, identifier };
  } catch {
    return { allowed: true, identifier }; // fail-open
  }
}
