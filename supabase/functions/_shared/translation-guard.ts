// Audit Wave 1 — H15: shared auth + spend-cap gate for the AI translation
// endpoints (translate-strings, translate-bundle).
//
// The old gate accepted ANY header starting with "Bearer " and had no rate
// limit, so anyone holding the public anon key could drain the shared
// LOVABLE_API_KEY. This gate instead:
//   1. validates the token is a GENUINE Supabase-issued JWT via getClaims
//      (an anon JWT is fine — anonymous page-load i18n must keep working — but
//      a garbage "Bearer x" is rejected), and
//   2. enforces a per-identity rate limit (signed-in user id, else client IP)
//      as the real spend ceiling.
// @2.99.1 for auth.getClaims (JWT validation) — matches check-account-identity.
import { createClient } from "npm:@supabase/supabase-js@2.99.1";

export function rateLimitIdentity(userId: string | null, ip: string | null): string {
  return userId ? `uid:${userId}` : `ip:${(ip ?? "unknown").trim() || "unknown"}`;
}

export type GateDecision =
  | { kind: "unauthorized"; status: 401 }
  | { kind: "rate_limited"; status: 429 }
  | { kind: "ok"; status: 200 };

// Pure decision — unit-tested. jwtValid gates first (no valid Supabase JWT ->
// 401); then the rate limit (-> 429); otherwise allow.
export function decideTranslationGate(i: {
  jwtValid: boolean;
  rateAllowed: boolean;
}): GateDecision {
  if (!i.jwtValid) return { kind: "unauthorized", status: 401 };
  if (!i.rateAllowed) return { kind: "rate_limited", status: 429 };
  return { kind: "ok", status: 200 };
}

export interface TranslationGuardResult {
  ok: boolean;
  status: number;
  error?: string;
  userId: string | null;
}

export async function guardTranslationRequest(
  req: Request,
  opts: { max: number; windowMinutes: number }
): Promise<TranslationGuardResult> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  let jwtValid = false;
  let userId: string | null = null;
  if (token) {
    try {
      const userClient = createClient(url, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data, error } = await userClient.auth.getClaims(token);
      if (!error && data?.claims) {
        jwtValid = true;
        userId = (data.claims.sub as string | undefined) ?? null;
      }
    } catch {
      jwtValid = false;
    }
  }

  let rateAllowed = true;
  if (jwtValid) {
    try {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      const admin = createClient(url, serviceKey);
      const { data: rl, error } = await admin.rpc("check_translation_rate_limit", {
        p_identifier: rateLimitIdentity(userId, ip),
        p_max: opts.max,
        p_window_minutes: opts.windowMinutes,
      });
      if (!error && rl && (rl as { allowed?: boolean }).allowed === false) rateAllowed = false;
      // Fail-open on limiter error (availability) — the request is still JWT-gated.
    } catch {
      /* fail-open on limiter error */
    }
  }

  const decision = decideTranslationGate({ jwtValid, rateAllowed });
  return {
    ok: decision.kind === "ok",
    status: decision.status,
    error:
      decision.kind === "unauthorized"
        ? "unauthorized"
        : decision.kind === "rate_limited"
          ? "rate_limited"
          : undefined,
    userId,
  };
}
