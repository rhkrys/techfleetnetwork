/**
 * Feature flags (ADR-0021) — the client read-side of public.feature_flags.
 *
 * A flag has a kill-switch (`enabled`) and a dial (`rollout_percent`). This module
 * fetches the flags once, caches the snapshot, and answers "is <key> on for this
 * user?" — both async (for React, via useFeatureFlag) and sync (for non-React
 * callers like the error reporter, which cannot await inside a catch).
 *
 * Safe default is OFF: a missing flag, a not-yet-loaded snapshot, or a failed
 * fetch all resolve to `false`, so a flag can only ever *enable* new behavior.
 */
import { supabase } from "@/integrations/supabase/client";
import { retryPostgrest } from "@/lib/data/transient-retry";

export type FeatureFlag = { key: string; enabled: boolean; rollout_percent: number };
export type FlagSnapshot = ReadonlyMap<string, FeatureFlag>;

let snapshot: FlagSnapshot | null = null;

/** Fetch all flags via the anon-capable SECURITY DEFINER RPC and cache them. */
export async function fetchFeatureFlags(): Promise<FlagSnapshot> {
  // Wrapped so a transient PGRST002/503 schema-cache reload retries instead of
  // dropping the fetch (a drop would just keep the last snapshot / safe-OFF default).
  const { data, error } = await retryPostgrest(() => supabase.rpc("get_feature_flags"));
  if (error) throw error;
  const map = new Map<string, FeatureFlag>();
  for (const row of data ?? []) map.set(row.key, row);
  snapshot = map;
  return map;
}

/** Refresh the cached snapshot; on failure keep the last one (never throws). */
export async function refreshFeatureFlags(): Promise<void> {
  try {
    await fetchFeatureFlags();
  } catch {
    // Keep the last good snapshot; absence still resolves to the safe default.
  }
}

/**
 * Deterministic 0–99 bucket for a seed (FNV-1a/32). Same seed → same bucket in
 * every runtime, so a user stays consistently in/out of a flag as we ramp.
 */
export function hashBucket(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100;
}

/**
 * A per-session anon id so a signed-out visitor stays in the same cohort for the
 * life of the page. Kept in-memory (no web globals) to keep this service pure;
 * cross-reload stickiness is unnecessary for a telemetry ramp.
 */
let anonSeed: string | null = null;
function anonId(): string {
  if (anonSeed === null) anonSeed = Math.random().toString(36).slice(2);
  return anonSeed;
}

/** Evaluate a flag against a specific snapshot (pure — used by the hook). */
export function isEnabledIn(
  snap: FlagSnapshot | null | undefined,
  key: string,
  userId?: string | null
): boolean {
  const flag = snap?.get(key);
  if (!flag || !flag.enabled) return false; // absent or killed → off
  if (flag.rollout_percent >= 100) return true;
  if (flag.rollout_percent <= 0) return false;
  return hashBucket(`${key}|${userId ?? anonId()}`) < flag.rollout_percent;
}

/**
 * Sync check for non-React callers, using the last cached snapshot. Returns the
 * safe default (false) until `fetchFeatureFlags()`/`refreshFeatureFlags()` runs.
 */
export function isFeatureEnabled(key: string, userId?: string | null): boolean {
  return isEnabledIn(snapshot, key, userId);
}

/** Test seam: reset the module cache. */
export function __resetFeatureFlagsForTest(): void {
  snapshot = null;
}
