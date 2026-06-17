/**
 * Cached session accessor — coalesces concurrent supabase.auth.getSession()
 * calls and caches the result in-memory for a short TTL. Prevents service-layer
 * fan-out from generating dozens of redundant /auth/v1/user network calls per
 * page load.
 *
 * Stays consistent with onAuthStateChange: any auth event invalidates the cache.
 *
 * Usage:
 *   import { getCachedSession } from "@/lib/cached-session";
 *   const session = await getCachedSession();
 *
 * At 10k users averaging 6 service calls per page, this saves ~50k
 * /auth/v1/user round-trips per minute.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

const TTL_MS = 30_000;

let cached: { session: Session | null; expiresAt: number } | null = null;
let inflight: Promise<Session | null> | null = null;

// Invalidate the cache on every auth state change so refresh / sign-out are
// reflected immediately.
supabase.auth.onAuthStateChange((_event, session) => {
  cached = session ? { session, expiresAt: Date.now() + TTL_MS } : null;
  inflight = null;
});

export async function getCachedSession(): Promise<Session | null> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.session;
  if (inflight) return inflight;

  inflight = readOnce()
    .catch(async (err) => {
      // AUTH-RESILIENCE-004 — single transient retry with 250ms backoff so
      // a one-off GoTrue/network hiccup never bubbles a throw to UI code.
      // The two-strike gate in decidePurgeOnBadJwt is still the only path
      // that can decide a session is truly dead.
      await new Promise((r) => setTimeout(r, 250));
      try {
        return await readOnce();
      } catch {
        cached = null;
        throw err;
      }
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

async function readOnce(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  cached = { session: data.session ?? null, expiresAt: Date.now() + TTL_MS };
  return cached.session;
}

/** Force a refresh on the next call. Use after explicit sign-in/out flows. */
export function invalidateCachedSession(): void {
  cached = null;
  inflight = null;
}
