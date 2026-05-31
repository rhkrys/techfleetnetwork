/**
 * Inventory of every route defined in src/App.tsx.
 *
 * IMPORTANT: keep this in sync when routes are added / renamed / removed
 * in App.tsx. The a11y scanner iterates this list to scan every page in
 * the app for WCAG 2.2 A / AA / AAA violations.
 *
 * For dynamic segments (e.g. /admin/clients/projects/:id/edit) we cannot
 * call the route at runtime without a real DB record, so a `sampleParam`
 * is provided that the spec resolves to a known-good fixture id at scan
 * time, OR the route is marked `skipReason` so it's reported as "skipped"
 * in the audit instead of producing a 404 false positive.
 */
export type RouteKind = "public" | "authed" | "admin";

export interface RouteSpec {
  /** URL path with concrete values for any dynamic params. */
  path: string;
  /** Human label for the report. */
  label: string;
  /** Auth requirement. Drives login flow in the spec. */
  kind: RouteKind;
  /**
   * Optional reason to skip scanning. Use for routes that require
   * server-side state we can't synthesize in CI (e.g. an emailed
   * unsubscribe token, a recovery link, a real applicationId in the
   * DB). They're still listed so the report shows coverage gaps
   * explicitly instead of silently dropping them.
   */
  skipReason?: string;
}

/**
 * Live test fixtures. Replace with real ids once the audit identifies
 * which dynamic routes need stable seed data. Currently scanned via the
 * route's empty/loading state, which is still useful for catching
 * structural a11y issues (landmarks, headings, skip links).
 */
const FIXTURES = {
  questPathId: "take-flight",
  projectId: "00000000-0000-0000-0000-000000000000",
  applicationId: "00000000-0000-0000-0000-000000000000",
} as const;

export const ROUTES: readonly RouteSpec[] = [
  // ---- Public ----
  { path: "/", label: "Index", kind: "public" },
  { path: "/login", label: "Login", kind: "public" },
  { path: "/register", label: "Register", kind: "public" },
  { path: "/forgot-password", label: "Forgot password", kind: "public" },
  {
    path: "/reset-password",
    label: "Reset password",
    kind: "public",
    skipReason:
      "Requires a recovery token in the URL hash; manual scan after a real reset email.",
  },
  {
    path: "/unsubscribe",
    label: "Unsubscribe",
    kind: "public",
    skipReason: "Requires an emailed unsubscribe token.",
  },
  {
    path: "/confirm-admin",
    label: "Confirm admin",
    kind: "public",
    skipReason: "Requires a one-time admin-confirmation token.",
  },

  // ---- Authenticated (trainee + admin both reach these) ----
  { path: "/dashboard", label: "Dashboard", kind: "authed" },
  { path: "/profile-setup", label: "Profile setup", kind: "authed" },
  { path: "/profile/edit", label: "Edit profile", kind: "authed" },
  { path: "/profile/notifications", label: "Notifications", kind: "authed" },
  { path: "/my-journey", label: "My Journey", kind: "authed" },
  {
    path: `/my-journey/quest/${FIXTURES.questPathId}`,
    label: "Quest detail",
    kind: "authed",
  },
  { path: "/courses", label: "Courses", kind: "authed" },
  { path: "/courses/connect-discord", label: "Connect Discord", kind: "authed" },
  { path: "/courses/onboarding", label: "Onboarding course", kind: "authed" },
  { path: "/courses/agile-mindset", label: "Agile mindset course", kind: "authed" },
  { path: "/courses/discord-learning", label: "Discord learning", kind: "authed" },
  { path: "/courses/agile-teamwork", label: "Agile teamwork course", kind: "authed" },
  { path: "/courses/project-training", label: "Project training", kind: "authed" },
  { path: "/courses/volunteer-teams", label: "Volunteer teams", kind: "authed" },
  { path: "/courses/observer", label: "Observer course", kind: "authed" },
  { path: "/events", label: "Events", kind: "authed" },
  { path: "/resources", label: "Resources", kind: "authed" },
  { path: "/chat", label: "Chat", kind: "authed" },
  { path: "/applications", label: "Applications", kind: "authed" },
  { path: "/applications/general", label: "General application", kind: "authed" },
  { path: "/applications/projects", label: "My project applications", kind: "authed" },
  {
    path: `/applications/projects/${FIXTURES.applicationId}/status`,
    label: "Project application status",
    kind: "authed",
    skipReason: "Needs a real applicationId owned by the test user; covered by manual pass.",
  },
  { path: "/project-openings", label: "Project openings list", kind: "authed" },
  {
    path: `/project-openings/${FIXTURES.projectId}`,
    label: "Project opening detail",
    kind: "authed",
    skipReason: "Needs a real projectId; manual pass after seed data lands.",
  },
  {
    path: `/project-openings/${FIXTURES.projectId}/apply`,
    label: "Project application form",
    kind: "authed",
    skipReason: "Needs a real projectId.",
  },
  { path: "/updates", label: "Community updates", kind: "authed" },
  { path: "/feedback", label: "Feedback", kind: "authed" },
  { path: "/admin-recovery", label: "Admin recovery", kind: "authed" },

  // ---- Admin only ----
  { path: "/admin/ingest", label: "Admin: ingest", kind: "admin" },
  { path: "/admin/users", label: "Admin: members", kind: "admin" },
  { path: "/admin/activity-log", label: "Admin: activity log", kind: "admin" },
  { path: "/admin/clients", label: "Admin: clients", kind: "admin" },
  { path: "/admin/clients/projects/new", label: "Admin: new project", kind: "admin" },
  {
    path: `/admin/clients/projects/${FIXTURES.projectId}/edit`,
    label: "Admin: edit project",
    kind: "admin",
    skipReason: "Needs a real projectId.",
  },
  { path: "/admin/feedback", label: "Admin: feedback", kind: "admin" },
  { path: "/admin/roster", label: "Admin: recruiting center", kind: "admin" },
  { path: "/admin/banners", label: "Admin: banners", kind: "admin" },
  {
    path: `/admin/roster/project/${FIXTURES.projectId}`,
    label: "Admin: roster project",
    kind: "admin",
    skipReason: "Needs a real projectId.",
  },
  {
    path: `/admin/roster/project/${FIXTURES.projectId}/applicant/${FIXTURES.applicationId}`,
    label: "Admin: applicant detail",
    kind: "admin",
    skipReason: "Needs real ids.",
  },
  {
    path: `/admin/applications/analysis/${FIXTURES.projectId}`,
    label: "Admin: project analysis",
    kind: "admin",
    skipReason: "Needs a real projectId.",
  },
  {
    path: `/admin/applications/${FIXTURES.applicationId}`,
    label: "Admin: application detail",
    kind: "admin",
    skipReason: "Needs a real applicationId.",
  },

  // ---- Catch-all (intentionally last) ----
  {
    path: "/__nonexistent-route-for-404-scan__",
    label: "404 NotFound",
    kind: "public",
  },
] as const;

export const SCANNABLE_ROUTES = ROUTES.filter((r) => !r.skipReason);
export const SKIPPED_ROUTES = ROUTES.filter((r) => !!r.skipReason);
