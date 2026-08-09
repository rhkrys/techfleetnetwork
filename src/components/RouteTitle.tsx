import { useEffect } from "react";
import { useLocation, useParams, matchPath } from "react-router-dom";

/**
 * Global per-route document.title manager. Every page in the app gets a
 * specific title in the format:
 *   "<Page Name> | Tech Fleet Network Platform | Agile Practice and Teamwork For All"
 *
 * This is critical for Google Analytics page_view fidelity — without
 * per-page titles, GA4 cannot distinguish routes in reports.
 *
 * Pages that render <SEO/> (via react-helmet-async) will still override
 * this, but only after hydration. RouteTitle sets the title synchronously
 * on every navigation so AnalyticsTracker (which reads document.title)
 * always reports the correct page.
 */

const SUFFIX = " | Tech Fleet Network Platform | Agile Practice and Teamwork For All";

// Order matters: more specific patterns first.
const ROUTE_TITLES: Array<{ pattern: string; title: string }> = [
  { pattern: "/", title: "Welcome" },
  { pattern: "/login", title: "Sign in" },
  { pattern: "/register", title: "Create account" },
  { pattern: "/forgot-password", title: "Reset password" },
  { pattern: "/reset-password", title: "Set new password" },
  { pattern: "/dashboard", title: "Dashboard" },
  { pattern: "/profile-setup", title: "Profile setup" },
  { pattern: "/welcome", title: "Welcome wizard" },

  { pattern: "/my-journey/quest/:pathId", title: "Quest detail" },
  { pattern: "/my-journey", title: "My journey" },

  { pattern: "/courses/connect-discord/callback", title: "Connecting Discord" },
  { pattern: "/courses/connect-discord", title: "Connect Discord" },
  { pattern: "/courses/onboarding", title: "Onboarding course" },
  { pattern: "/courses/agile-mindset", title: "Agile mindset course" },
  { pattern: "/courses/discord-learning", title: "Discord learning course" },
  { pattern: "/courses/agile-teamwork", title: "Agile teamwork course" },
  { pattern: "/courses/project-training", title: "Project training" },
  { pattern: "/courses/volunteer-teams", title: "Volunteer teams course" },
  { pattern: "/courses/observer", title: "Observer course" },
  { pattern: "/courses", title: "Courses" },

  { pattern: "/events", title: "Events" },
  { pattern: "/resources", title: "Resources" },
  { pattern: "/community/get-help", title: "Get help" },
  { pattern: "/chat", title: "Chat with Fleety" },

  { pattern: "/applications/projects/:applicationId/status", title: "Application status" },
  { pattern: "/applications/projects", title: "My project applications" },
  { pattern: "/applications/general", title: "General application" },
  { pattern: "/applications", title: "Applications" },

  { pattern: "/project-openings/:projectId/apply", title: "Apply to project" },
  { pattern: "/project-openings/:projectId", title: "Project opening" },
  { pattern: "/project-openings", title: "Project openings" },

  { pattern: "/admin/ingest", title: "Admin · Data ingest" },
  { pattern: "/admin/policies", title: "Admin · Policies" },
  { pattern: "/admin/users", title: "Admin · Users" },
  { pattern: "/admin/activity-log", title: "Admin · Activity log" },
  { pattern: "/admin/applications/analysis/:projectId", title: "Admin · Application analysis" },
  { pattern: "/admin/applications/:applicationId", title: "Admin · Application detail" },
  { pattern: "/admin/clients/projects/new", title: "Admin · New project" },
  { pattern: "/admin/clients/projects/:id/edit", title: "Admin · Edit project" },
  { pattern: "/admin/clients", title: "Admin · Clients" },
  { pattern: "/admin/feedback", title: "Admin · Feedback" },
  {
    pattern: "/admin/roster/project/:projectId/applicant/:applicationId",
    title: "Admin · Applicant detail",
  },
  { pattern: "/admin/roster/project/:projectId", title: "Admin · Roster project" },
  { pattern: "/admin/roster", title: "Admin · Roster" },
  { pattern: "/admin/banners", title: "Admin · Banners" },
  { pattern: "/admin/system-health", title: "Admin · System health" },
  { pattern: "/admin/email-deliverability-test", title: "Admin · Email deliverability" },
  { pattern: "/admin/brand-tokens", title: "Admin · Brand tokens" },
  { pattern: "/admin/classes", title: "Teaching · All classes" },

  { pattern: "/updates", title: "Updates" },
  { pattern: "/profile/edit", title: "Edit profile" },
  { pattern: "/profile/notifications", title: "Notifications" },
  { pattern: "/feedback", title: "Feedback" },
  { pattern: "/settings/notifications", title: "Notification settings" },

  { pattern: "/accessibility", title: "Accessibility" },
  { pattern: "/privacy/dsar", title: "Data subject request" },
  { pattern: "/privacy", title: "Privacy policy" },
  { pattern: "/cookies", title: "Cookie policy" },
  { pattern: "/terms-of-use", title: "Terms of use" },
  { pattern: "/terms", title: "Terms and conditions" },
  { pattern: "/code-of-conduct", title: "Code of conduct" },

  { pattern: "/confirm-admin", title: "Confirm admin role" },
  { pattern: "/confirm-teacher", title: "Confirm teacher role" },

  { pattern: "/teach/classes/:id/cohorts/new", title: "New cohort" },
  { pattern: "/teach/classes/:id/edit", title: "Edit class" },
  { pattern: "/teach/classes/:id", title: "Class detail" },
  { pattern: "/teach/classes/new", title: "New class" },
  { pattern: "/teach/classes", title: "My classes" },

  { pattern: "/unsubscribe", title: "Unsubscribe" },
  { pattern: "/access-denied", title: "Access denied" },
];

function resolvePageName(pathname: string): string {
  for (const { pattern, title } of ROUTE_TITLES) {
    const match = matchPath({ path: pattern, end: true }, pathname);
    if (match) return title;
  }
  return "Page not found";
}

export function RouteTitle() {
  const location = useLocation();
  // useParams not strictly required, but keeps RouteTitle re-rendering on dynamic-segment changes.
  useParams();

  useEffect(() => {
    const name = resolvePageName(location.pathname);
    const fullTitle = `${name}${SUFFIX}`;
    if (document.title !== fullTitle) {
      document.title = fullTitle;
    }
    // Mirror to og:title so social crawlers (when they execute JS) and
    // analytics integrations that read meta tags stay in sync.
    const og = document.querySelector('meta[property="og:title"]');
    if (og) og.setAttribute("content", fullTitle);
    const tw = document.querySelector('meta[name="twitter:title"]');
    if (tw) tw.setAttribute("content", fullTitle);
  }, [location.pathname]);

  return null;
}
