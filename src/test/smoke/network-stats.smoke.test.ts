/**
 * Network stats smoke tests — guards the cache contract on the home page
 * StatsService. We cannot exercise the Supabase RPC here (no network in
 * unit tests), so these focus on:
 *
 *  - STATS-013  Legacy localStorage cache keys (v1/v2) are evicted on read.
 *  - STATS-007  When the live RPC fails and a current-version cache exists, the
 *               cached payload (including the `historical` block) is returned
 *               unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn() },
}));

import { StatsService, type NetworkStats } from "@/services/stats.service";
import { supabase } from "@/integrations/supabase/client";

// Must track the service's current cache key (bumped to v5 on 2026-05-21).
const CACHE_KEY = "tfn:network-stats:last-known:v5";

const sampleStats: NetworkStats = {
  total_signups: 440,
  core_courses_active: 223,
  beginner_courses_active: 0,
  advanced_courses_active: 0,
  applications_completed: 70,
  badges_earned: 664,
  prev_week_start: "2026-05-13",
  prev_week_end: "2026-05-20",
  prev_week_signups: 12,
  prev_week_core_active: 5,
  prev_week_beginner_active: 0,
  prev_week_advanced_active: 0,
  prev_week_applications: 3,
  prev_week_badges: 8,
  projects_open_applications: 1,
  projects_coming_soon: 3,
  projects_live: 11,
  projects_previously_completed: 120,
  historical: {
    general_applications_pre_platform: 890,
    service_leadership_unique: 1101,
    masterclass_total: 1881,
    masterclass_minus_servlead: 780,
    last_synced_at: "2026-05-17T18:38:01.934238+00:00",
  },
};

describe("StatsService cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(() => window.localStorage.clear());

  it("STATS-013: evicts legacy v1/v2 cache keys when reading", () => {
    window.localStorage.setItem("tfn:network-stats:last-known:v1", "x");
    window.localStorage.setItem("tfn:network-stats:last-known:v2", "y");
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ stats: sampleStats, cachedAt: Date.now() })
    );

    const cached = StatsService.getCachedNetworkStats();
    expect(cached?.stats.total_signups).toBe(440);
    expect(window.localStorage.getItem("tfn:network-stats:last-known:v1")).toBeNull();
    expect(window.localStorage.getItem("tfn:network-stats:last-known:v2")).toBeNull();
  });

  it("STATS-007: serves cached historical block when live RPC fails", async () => {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ stats: sampleStats, cachedAt: Date.now() })
    );
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: new Error("network down"),
    });

    const result = await StatsService.getNetworkStats();
    expect(result.historical?.general_applications_pre_platform).toBe(890);
    expect(result.historical?.masterclass_total).toBe(1881);
    expect(result.applications_completed).toBe(70); // live, NOT 890 + 70
  });
});
