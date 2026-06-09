import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";

/**
 * auth-session.service — owns subscription, idle timeout, max-age, and
 * transient bad_jwt handling for the rebuilt auth feature. Wraps the
 * existing session-health primitives so pages cannot poke them directly.
 *
 * Invariants:
 *  - Idle timeout: 30 minutes (matches mem://features/session-security-mfa).
 *  - Max session age: 4 hours.
 *  - Transient `bad_jwt` survives a single strike; second strike within 15s
 *    purges (delegated to `decidePurgeOnBadJwt`).
 *  - This module is the only legitimate subscriber to
 *    `supabase.auth.onAuthStateChange` inside `src/features/auth/**`.
 */

const log = createLogger("auth-session.service");

export const IDLE_TIMEOUT_MS = 30 * 60_000;
export const MAX_SESSION_AGE_MS = 4 * 60 * 60_000;

let lastActivityAt = Date.now();

export function recordActivity(now: number = Date.now()): void {
  lastActivityAt = now;
}

export function getMsSinceActivity(now: number = Date.now()): number {
  return now - lastActivityAt;
}

export function isIdleExpired(now: number = Date.now()): boolean {
  return getMsSinceActivity(now) > IDLE_TIMEOUT_MS;
}

export function isMaxAgeExpired(signedInAt: number, now: number = Date.now()): boolean {
  return now - signedInAt > MAX_SESSION_AGE_MS;
}

/** Subscribe to auth state. Returns an unsubscribe fn. */
export function subscribe(handler: (event: string, sessionUserId: string | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    try {
      handler(event, session?.user?.id ?? null);
    } catch (e) {
      log.warn("subscribe", "handler threw", { err: e instanceof Error ? e.message : String(e) });
    }
  });
  return () => {
    try {
      data.subscription.unsubscribe();
    } catch {
      /* noop */
    }
  };
}
