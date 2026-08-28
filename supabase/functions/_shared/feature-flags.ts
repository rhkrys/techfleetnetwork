// Module: supabase/functions/_shared (bdd-gate coverage marker)
/**
 * Feature flags (ADR-0021) — the edge read-side of public.feature_flags.
 *
 * Edge functions run with the service role, so they read the table directly.
 * Safe default is OFF: a missing flag, a query error, or a thrown client all
 * resolve to `false`, so a flag can never *break* a function — only enable
 * behavior. The bucket hash matches the client (src/services/feature-flags.service.ts)
 * so the same *authenticated* user lands in the same cohort on both sides (signed-out
 * cohorts differ by runtime, which is fine for a telemetry ramp). Both suites pin the
 * same golden vector so the two copies can never silently drift.
 */

export interface FeatureFlagClient {
  from(table: string): {
    select(cols: string): {
      eq(
        col: string,
        val: string
      ): {
        maybeSingle(): Promise<{
          data: { enabled: boolean; rollout_percent: number } | null;
          error: unknown;
        }>;
      };
    };
  };
}

/** Deterministic 0–99 bucket (FNV-1a/32) — must match the client implementation. */
export function hashBucket(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100;
}

/** Whether `key` is on for `userId` (safe default OFF; never throws). */
export async function flagEnabled(
  client: FeatureFlagClient,
  key: string,
  userId?: string | null
): Promise<boolean> {
  try {
    const { data, error } = await client
      .from("feature_flags")
      .select("enabled,rollout_percent")
      .eq("key", key)
      .maybeSingle();
    if (error || !data || !data.enabled) return false;
    if (data.rollout_percent >= 100) return true;
    if (data.rollout_percent <= 0) return false;
    return hashBucket(`${key}|${userId ?? "anon"}`) < data.rollout_percent;
  } catch {
    return false;
  }
}
