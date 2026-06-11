/**
 * AUTH-ENGINE — rate-limit port.
 *
 * Wraps the existing RateLimitService and the `clear_login_rate_limit_for_email`
 * edge function so engine code calls one shape regardless of provider. After
 * Ship 5b/5c the engines stop importing RateLimitService and `supabase`
 * directly and use this port exclusively.
 */
import { RateLimitService } from "@/services/rate-limit.service";
import { supabase } from "@/integrations/supabase/client";

type RateLimitPurpose = string;

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retry_after: number;
}

export const rateLimitPort = {
  async peek(email: string, purpose: RateLimitPurpose): Promise<RateLimitDecision> {
    try {
      return await RateLimitService.peek(email, purpose);
    } catch {
      // Fail-open: telemetry-friendly default so a transient rate-limit RPC
      // failure never bricks sign-in.
      return { allowed: true, remaining: 5, retry_after: 0 };
    }
  },

  async recordFailure(email: string, purpose: RateLimitPurpose): Promise<void> {
    try {
      await RateLimitService.recordFailure(email, purpose);
    } catch {
      /* swallow — telemetry path */
    }
  },

  async clearForEmail(email: string): Promise<void> {
    try {
      await supabase.functions.invoke("clear_login_rate_limit_for_email", {
        body: { email },
      });
    } catch {
      /* swallow — clearing is best-effort, the cron sweeper covers stragglers */
    }
  },
};
