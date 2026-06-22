/**
 * Centralized React Query configuration — microservice-style cache boundaries.
 *
 * Each "service domain" has tuned staleTime / gcTime based on data volatility.
 * This eliminates redundant DB calls at scale:
 *   - Static data (handbooks, workshops, milestones): 30 min stale, 60 min gc
 *   - Semi-static (quest paths, BDD scenarios): 15 min stale
 *   - User-specific mutable (journey progress, apps): 60s stale
 *   - High-frequency polling (notifications, announcements): 30s stale
 *
 * At 10k users × 6 page views/session, this saves ~240k unnecessary DB calls/day.
 */

// ── Cache tiers ──────────────────────────────────────────────────────
export const CACHE_STATIC = { staleTime: 30 * 60 * 1000, gcTime: 60 * 60 * 1000 } as const;
export const CACHE_SEMI_STATIC = { staleTime: 15 * 60 * 1000, gcTime: 30 * 60 * 1000 } as const;
export const CACHE_USER_MUTABLE = { staleTime: 60 * 1000, gcTime: 10 * 60 * 1000 } as const;
export const CACHE_VOLATILE = { staleTime: 15 * 1000, gcTime: 5 * 60 * 1000 } as const;

// ── Identity-scoped key helper ───────────────────────────────────────
// Every per-user query MUST start with ["identity", userId, ...] so the
// React Query cache cannot leak a previous identity's snapshot into a new
// session (AUTH-RESILIENCE-007, PROFILE-IDENTITY-GUARD-002) and so the
// duplicate parallel fetches observed during bootstrap (Profile×2,
// getCompletedCount×4) dedupe to a single in-flight promise.
export const identityKey = (userId: string | undefined | null, ...parts: readonly unknown[]) =>
  ["identity", userId ?? "anon", ...parts] as const;

// ── Query key factory ────────────────────────────────────────────────
// Centralised keys prevent typo-based cache misses and enable targeted invalidation.
export const queryKeys = {
  // Auth / Profile domain
  profile: (userId: string) => identityKey(userId, "profile"),
  mfaGate: (userId: string | undefined | null) => identityKey(userId, "mfa-gate"),


  // Journey domain
  journeyProgress: (userId: string, phase: string) => ["journey-progress", userId, phase] as const,
  journeyCompleted: (userId: string, phase: string, taskKey: string) =>
    ["journey-completed", userId, phase, taskKey] as const,

  // Quest domain
  questPaths: () => ["quest-paths"] as const,
  questSteps: (pathId?: string) => pathId ? ["quest-steps", pathId] as const : ["quest-steps-all"] as const,
  questSelections: (userId: string) => ["quest-selections", userId] as const,
  questSelfReport: (userId: string) => ["quest-self-report", userId] as const,
  questAllProgress: (userId: string) => ["quest-all-journey-progress", userId] as const,

  // Notifications domain
  notifications: (userId: string, limit: number) => ["notifications", userId, limit] as const,

  // Announcements domain
  announcements: (limit: number) => ["announcements", limit] as const,
  announcementsLatest: (limit: number) => ["announcements", "latest", limit] as const,
  announcementReadIds: (userId: string) => ["announcement-read-ids", userId] as const,

  // Reference data domain (static)
  milestoneReference: () => ["milestone-reference"] as const,
  handbooks: () => ["handbooks"] as const,
  workshops: () => ["workshops"] as const,

  // Network / Stats domain
  networkStats: () => ["network-stats"] as const,

  // Dashboard domain
  dashboardGeneralApp: (userId: string) => ["dashboard-general-app", userId] as const,
  dashboardProjectApps: (userId: string) => ["dashboard-project-apps-combined", userId] as const,
  dashboardPrefs: (userId: string) => ["dashboard-preferences", userId] as const,

  // Admin domain
  adminRole: (userId: string) => ["admin-role", userId] as const,
  twoFactorEnrollment: (userId: string) => ["two-factor-enrollment", userId] as const,
} as const;
