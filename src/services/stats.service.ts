import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";
import { handleServiceError } from "@/lib/service-result";

const log = createLogger("StatsService");

export interface HistoricalStats {
  general_applications_pre_platform: number;
  service_leadership_unique: number;
  masterclass_total: number;
  masterclass_minus_servlead: number;
  historical_beginner_courses: number;
  historical_advanced_courses: number;
  last_synced_at: string | null;
}

export interface NetworkStats {
  total_signups: number;
  /** All-tier course completions (core + onboarding) — headline + badge reconciliation source. */
  course_completions_total?: number;
  /** Tier='core' only — kept for back-compat with v4 consumers. */
  core_courses_active: number;
  /** Tier='onboarding' only (connect-discord, onboarding). */
  onboarding_courses_active?: number;
  /** Discord links with immutable linked timestamps — third badge reconciliation source. */
  discord_links_count?: number;
  distinct_course_completers?: number;
  beginner_courses_active: number;
  advanced_courses_active: number;
  applications_completed: number;
  badges_earned: number;
  prev_week_start: string;
  prev_week_end: string;
  prev_week_signups: number;
  /** All-tier past-7d course completions. */
  prev_week_course_completions_total?: number;
  prev_week_core_active: number;
  prev_week_onboarding_active?: number;
  prev_week_discord_links_count?: number;
  prev_week_beginner_active: number;
  prev_week_advanced_active: number;
  prev_week_applications: number;
  prev_week_badges: number;
  projects_open_applications: number;
  projects_coming_soon: number;
  projects_live: number;
  projects_previously_completed: number;
  historical?: HistoricalStats;
}

// v5 — cache key bumped 2026-05-21: NetworkStats now includes
// course_completions_total + onboarding_courses_active so the headline card
// reconciles arithmetically with Badges Earned. Evict prior payloads.
const CACHE_KEY = "tfn:network-stats:last-known:v5";
const LEGACY_CACHE_KEYS = [
  "tfn:network-stats:last-known:v1",
  "tfn:network-stats:last-known:v2",
  "tfn:network-stats:last-known:v3",
  "tfn:network-stats:last-known:v4",
];
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 1 day — fallback only, not a freshness window

export interface CachedNetworkStats {
  stats: NetworkStats;
  cachedAt: number;
}

function readCache(): CachedNetworkStats | null {
  if (typeof window === "undefined") return null;
  try {
    // Best-effort eviction of any prior cache versions so users never see numbers
    // older than the current schema/contract.
    for (const legacy of LEGACY_CACHE_KEYS) window.localStorage.removeItem(legacy);
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedNetworkStats;
    if (!parsed?.stats || typeof parsed.cachedAt !== "number") return null;
    if (Date.now() - parsed.cachedAt > CACHE_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(stats: NetworkStats): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ stats, cachedAt: Date.now() } satisfies CachedNetworkStats),
    );
  } catch {
    // Ignore quota / private-mode errors — cache is best-effort.
  }
}

export const StatsService = {
  /**
   * Fetches network stats with graceful degradation: if the live RPC fails,
   * returns the most recently cached stats (up to 7 days old) so the
   * landing/dashboard widget never shows an empty error state.
   */
  async getNetworkStats(): Promise<NetworkStats> {
    return log.track("getNetworkStats", "Fetching network stats from database", undefined, async () => {
      try {
        const { data, error } = await supabase.rpc("get_network_stats");
        if (error) throw error;
        const stats = data as unknown as NetworkStats;
        writeCache(stats);
        log.info("getNetworkStats", `Network stats loaded: ${stats.total_signups} total signups`, {
          totalSignups: stats.total_signups,
        });
        return stats;
      } catch (err) {
        const cached = readCache();
        if (cached) {
          log.warn(
            "getNetworkStats",
            "Live network stats unavailable; serving last-known cached stats",
            { cachedAt: new Date(cached.cachedAt).toISOString() },
            err as Error,
          );
          return cached.stats;
        }
        handleServiceError(err as Error, {
          logger: log,
          action: "getNetworkStats",
          message: `Failed to load network stats: ${(err as Error)?.message ?? "Unknown error"}`,
          throwMessage: "Failed to load network stats.",
        });
        throw err;
      }
    });
  },

  /** Exposed for the UI so it can badge data as "last known" when stale. */
  getCachedNetworkStats(): CachedNetworkStats | null {
    return readCache();
  },
};
