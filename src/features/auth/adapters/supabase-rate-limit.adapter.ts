/**
 * AUTH-ENGINE — Supabase rate-limit adapter.
 *
 * Implements the `rateLimitPort` contract against the existing
 * `RateLimitService` (peek / record_rate_limit_failure RPCs) and the
 * `clear_login_rate_limit_for_email` edge function. Engines depend on the port
 * shape; this adapter is the only module that knows about the underlying
 * service.
 *
 * Fail-open by design: a transient RPC failure must never brick sign-in.
 */
import { rateLimitPort, type RateLimitDecision } from "@/features/auth/ports/rate-limit.port";

export const supabaseRateLimitAdapter = {
  peek(email: string, purpose: string): Promise<RateLimitDecision> {
    return rateLimitPort.peek(email, purpose);
  },
  recordFailure(email: string, purpose: string): Promise<void> {
    return rateLimitPort.recordFailure(email, purpose);
  },
  clearForEmail(email: string): Promise<void> {
    return rateLimitPort.clearForEmail(email);
  },
} as const;

export type SupabaseRateLimitAdapter = typeof supabaseRateLimitAdapter;
