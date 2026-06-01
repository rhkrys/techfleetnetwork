import { memo, useMemo, useRef, useEffect, useState, Suspense } from "react";
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry";
import { Link } from "react-router-dom";
import {
  BookOpen,
  Briefcase,
  ClipboardCheck,
  Heart,
  MessageSquare,
  FileCheck2,
} from "lucide-react";
import { useAgreementStatus } from "@/hooks/use-agreement-status";
import { CommunityAgreementSheet } from "@/components/agreements/CommunityAgreementSheet";
import celebrationImg from "@/assets/courses-complete-rocket.svg";
import { Badge } from "@/components/ui/badge";
import { ApplicationStatusBadge } from "@/components/ApplicationStatusBadge";
import { BadgesDisplay } from "@/components/BadgesDisplay";
import { DashboardCustomizer } from "@/components/DashboardCustomizer";
import { DiscordInviteBanner } from "@/components/DiscordInviteBanner";
import { DashboardEmptyState } from "@/components/DashboardEmptyState";
import { GettingStartedChecklist, type ChecklistItem } from "@/components/GettingStartedChecklist";
import { SectionEmptyState } from "@/components/SectionEmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { IdleMount } from "@/components/IdleMount";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useCompletedCount } from "@/hooks/use-journey-progress";
import { TOTAL_FIRST_STEPS, FIRST_STEPS_TASK_IDS } from "@/pages/FirstStepsPage";
import { TOTAL_CONNECT_DISCORD, CONNECT_DISCORD_TASK_IDS } from "@/pages/ConnectDiscordPage";
import { useLatestAnnouncements } from "@/hooks/use-announcements";
import { useDashboardPreferences } from "@/hooks/use-dashboard-preferences";
import { StatsService } from "@/services/stats.service";
import { stripHtml } from "@/lib/html";
import { TOTAL_AGILE_LESSONS } from "@/data/agile-course";
import { TOTAL_DISCORD_LESSONS } from "@/data/discord-course";
import { TOTAL_TEAMWORK_LESSONS } from "@/data/teamwork-course";
import { TOTAL_PROJECT_TRAINING_LESSONS } from "@/data/project-training-course";
import { TOTAL_VOLUNTEER_LESSONS } from "@/data/volunteer-teams-course";
import { TOTAL_OBSERVER_LESSONS, ALL_OBSERVER_LESSON_IDS } from "@/data/observer-course";
import { Progress } from "@/components/ui/progress";

import { format } from "date-fns";
import { WelcomeDialog } from "@/components/WelcomeDialog";
import { useQuery, useQueryClient } from "@/lib/react-query";
import { useAdaptiveInterval } from "@/hooks/use-adaptive-interval";
import { useDashboardOverview } from "@/hooks/use-dashboard-overview";
import { useAdmin } from "@/hooks/use-admin";
import { PageTitle, SectionTitle, CardTitle, Body, Caption } from "@/components/ui/typography";

// Lazy-load heavy components
const NetworkActivity = lazy(() =>
  import("@/components/NetworkActivity").then((m) => ({ default: m.NetworkActivity }))
);
const SystemHealthWidget = lazy(() =>
  import("@/components/admin/SystemHealthWidget").then((m) => ({ default: m.SystemHealthWidget }))
);

interface CoreCourse {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  totalTasks: number;
  completedTasks: number;
  locked: boolean;
  prerequisiteLabel?: string;
}

const CoreCourseCard = memo(function CoreCourseCard({ course }: { course: CoreCourse }) {
  const progress = course.totalTasks > 0
    ? Math.round((course.completedTasks / course.totalTasks) * 100)
    : 0;
  const isComplete = course.totalTasks > 0 && course.completedTasks >= course.totalTasks;
  const isStarted = course.completedTasks > 0;
  const Icon = course.icon;

  if (course.locked) {
    return (
      <div
        className="tf-card p-4 opacity-50 cursor-not-allowed relative overflow-hidden"
        aria-label={`${course.title} — Locked. Complete ${course.prerequisiteLabel} first.`}
      >
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm text-muted-foreground truncate">{course.title}</h3>
            <p className="text-xs text-muted-foreground/70 truncate">{course.description}</p>
          </div>
          <Badge variant="outline" className="bg-muted text-muted-foreground border-muted-foreground/20 text-xs flex-shrink-0">
            Locked
          </Badge>
        </div>
      </div>
    );
  }

  return (
    <Link
      to={course.href}
      className="tf-card p-4 hover:border-primary/40 transition-all group block"
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors truncate">
              {course.title}
            </h3>
            {isComplete ? (
              <Badge variant="outline" className="bg-success/10 text-success border-success/20 text-xs flex-shrink-0">
                Complete
              </Badge>
            ) : isStarted ? (
              <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 text-xs flex-shrink-0">
                In Progress
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs flex-shrink-0">Not Started</Badge>
            )}
          </div>
          {course.totalTasks > 0 && (
            <div className="flex items-center gap-2 mt-1.5">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden flex-1">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {course.completedTasks}/{course.totalTasks}
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
});

function DashboardSkeleton() {
  return (
    <div className="container-app !px-4 sm:!px-4 lg:!px-4 py-8 sm:py-12 space-y-8">
      <div>
        <Skeleton className="h-8 w-64 mb-2" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const userId = user?.id;
  const customizerRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const { isAdmin } = useAdmin();

  const { visibleWidgets, widgetOrder, isVisible, toggleWidget, reorderWidgets, isNewUser, isLoading: prefsLoading } = useDashboardPreferences();

  const [agreementCtx, setAgreementCtx] = useState<{ id: string; name: string; clientName: string } | null>(null);

  const totalFirstSteps = TOTAL_FIRST_STEPS;

  // Single round-trip RPC: phase counts + general app + project apps in one call.
  // Cuts dashboard load from 8 queries to 1 (audit 2026-04-18).
  const { data: overview } = useDashboardOverview();
  const phaseCounts = overview?.phase_counts ?? {};

  // Task-id-filtered counts (RPC returns total per phase, can't filter by task subset)
  const { data: connectDiscordCompleted = 0 } = useCompletedCount(userId, "first_steps", CONNECT_DISCORD_TASK_IDS);
  const { data: firstStepsCompleted = 0 } = useCompletedCount(userId, "first_steps", FIRST_STEPS_TASK_IDS);

  // Phase-total counts (sourced from overview RPC)
  const secondStepsCompleted = phaseCounts.second_steps ?? 0;
  const discordLearningCompleted = phaseCounts.discord_learning ?? 0;
  const teamworkCompleted = phaseCounts.third_steps ?? 0;
  const projectTrainingCompleted = phaseCounts.project_training ?? 0;
  const volunteerCompleted = phaseCounts.volunteer ?? 0;
  const { data: observerCompleted = 0 } = useCompletedCount(userId, "observer", ALL_OBSERVER_LESSON_IDS);

  const { data: latestAnnouncements = [] } = useLatestAnnouncements(5);

  // Share cache key with NetworkActivity component — no duplicate fetch
  const { data: stats } = useQuery({
    queryKey: ["network-stats"],
    queryFn: () => StatsService.getNetworkStats(),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // General application status — sourced from overview RPC
  const generalApp = overview?.general_application ?? null;

  // Project apps come from RPC; still need projects + clients lookup for display.
  const projectApps = overview?.project_applications ?? [];
  const { data: projectLookup } = useQuery({
    queryKey: ["dashboard-project-lookup", projectApps.map((a) => a.project_id).sort().join(",")],
    queryFn: async () => {
      if (projectApps.length === 0) return { projects: [], clients: [] };
      const projectIds = [...new Set(projectApps.map((a) => a.project_id))];
      const { data: projects } = await supabase
        .from("projects").select("id, client_id, project_type, phase, project_status, friendly_name").in("id", projectIds);
      const clientIds = [...new Set((projects ?? []).map((p) => p.client_id))];
      const { data: clients } = clientIds.length > 0
        ? await supabase.from("clients").select("id, name, kind").in("id", clientIds)
        : { data: [] };
      return { projects: projects ?? [], clients: clients ?? [] };
    },
    enabled: projectApps.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Adaptive poll for application status changes (60s base, 240s when tab hidden)
  const dashboardPollInterval = useAdaptiveInterval(60_000);
  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview", userId] });
    }, dashboardPollInterval);
    return () => clearInterval(interval);
  }, [userId, queryClient, dashboardPollInterval]);

  const myProjectApps = projectApps;
  const dashProjectMap = useMemo(() => new Map((projectLookup?.projects ?? []).map((p) => [p.id, p])), [projectLookup?.projects]);
  const dashClientMap = useMemo(() => new Map((projectLookup?.clients ?? []).map((c) => [c.id, c])), [projectLookup?.clients]);

  const communityBadgeCount = stats?.badges_earned ?? null;

  // Self-heal: treat Connect to Discord as done if the profile already has a linked
  // Discord account, even when the journey_progress row is missing (older users who
  // linked Discord via ProfileSetupDialog never marked the connect-discord task).
  const hasLinkedDiscord = !!(profile?.discord_user_id && profile.discord_user_id.length > 0);
  const allConnectDiscordDone = connectDiscordCompleted >= TOTAL_CONNECT_DISCORD || hasLinkedDiscord;
  const allFirstStepsDone = totalFirstSteps > 0 && firstStepsCompleted >= totalFirstSteps;
  const allSecondStepsDone = secondStepsCompleted >= TOTAL_AGILE_LESSONS;
  const allDiscordDone = discordLearningCompleted >= TOTAL_DISCORD_LESSONS;
  const allThirdStepsDone = teamworkCompleted >= TOTAL_TEAMWORK_LESSONS;
  const allProjectTrainingDone = projectTrainingCompleted >= TOTAL_PROJECT_TRAINING_LESSONS;
  const allVolunteerDone = volunteerCompleted >= TOTAL_VOLUNTEER_LESSONS;
  const allOnboardingDone = allConnectDiscordDone && allFirstStepsDone && allSecondStepsDone && allProjectTrainingDone && allVolunteerDone;
  const observerNotStarted = allOnboardingDone && observerCompleted === 0;
  const observerInProgress = allOnboardingDone && observerCompleted > 0 && observerCompleted < TOTAL_OBSERVER_LESSONS;
  const observerDone = allOnboardingDone && observerCompleted >= TOTAL_OBSERVER_LESSONS;

  const coreCourses: CoreCourse[] = useMemo(() => [
    {
      id: "connect-discord",
      title: "Connect to Discord",
      description: "Link your Discord account to the Tech Fleet Network platform.",
      icon: MessageSquare,
      href: "/courses/connect-discord",
      totalTasks: TOTAL_CONNECT_DISCORD,
      completedTasks: connectDiscordCompleted,
      locked: false,
    },
    {
      id: "onboarding",
      title: "Onboarding Steps",
      description: "Set up your profile, complete onboarding class, sign up for service leadership, and review the user guide.",
      icon: ClipboardCheck,
      href: "/courses/onboarding",
      totalTasks: totalFirstSteps,
      completedTasks: firstStepsCompleted,
      locked: !allConnectDiscordDone,
      prerequisiteLabel: "Connect to Discord",
    },
    {
      id: "agile-mindset",
      title: "Build an Agile Mindset",
      description: `${TOTAL_AGILE_LESSONS} lessons covering agile philosophies, teamwork, and scrum methods.`,
      icon: BookOpen,
      href: "/courses/agile-mindset",
      totalTasks: TOTAL_AGILE_LESSONS,
      completedTasks: secondStepsCompleted,
      locked: !allFirstStepsDone,
      prerequisiteLabel: "Onboarding Steps",
    },
    {
      id: "project-training",
      title: "Join Project Training Teams",
      description: `${TOTAL_PROJECT_TRAINING_LESSONS} lessons on apprenticeship training and nonprofit clients.`,
      icon: Briefcase,
      href: "/courses/project-training",
      totalTasks: TOTAL_PROJECT_TRAINING_LESSONS,
      completedTasks: projectTrainingCompleted,
      locked: !allSecondStepsDone,
      prerequisiteLabel: "Build an Agile Mindset",
    },
    {
      id: "volunteer-teams",
      title: "Join Volunteer Teams",
      description: `${TOTAL_VOLUNTEER_LESSONS} lessons on volunteering at Tech Fleet.`,
      icon: Heart,
      href: "/courses/volunteer-teams",
      totalTasks: TOTAL_VOLUNTEER_LESSONS,
      completedTasks: volunteerCompleted,
      locked: !allSecondStepsDone,
      prerequisiteLabel: "Build an Agile Mindset",
    },
  ], [connectDiscordCompleted, firstStepsCompleted, secondStepsCompleted, projectTrainingCompleted, volunteerCompleted, allConnectDiscordDone, allFirstStepsDone, allSecondStepsDone, totalFirstSteps]);

  // Gumroad-style flat checklist derived from the same course progress.
  const onboardingChecklist: ChecklistItem[] = useMemo(
    () =>
      coreCourses.map((c) => ({
        id: c.id,
        title: c.title,
        subtitle: c.description,
        icon: c.icon,
        href: c.href,
        completed: c.totalTasks > 0 && c.completedTasks >= c.totalTasks,
        locked: c.locked,
        prerequisiteLabel: c.prerequisiteLabel,
      })),
    [coreCourses]
  );

  const displayName = profile?.first_name || profile?.display_name || user?.user_metadata?.full_name || "there";

  // Hook guarantees arrays — no runtime guards needed
  const togglableSectionsVisible = visibleWidgets.filter((w) => w !== "core_courses").length;
  const showEmptyState = !prefsLoading && isNewUser && togglableSectionsVisible === 0;

  const handleOpenCustomizer = () => {
    customizerRef.current?.click();
  };

  return (
    <div className="container-app !px-4 sm:!px-4 lg:!px-4 py-8 sm:py-12 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <PageTitle className="truncate">Welcome back, {displayName} 👋</PageTitle>
          <Body className="text-muted-foreground mt-1">Continue your journey through the Tech Fleet training platform.</Body>
        </div>
        <div className="flex-shrink-0">
          <DashboardCustomizer
            visibleWidgets={visibleWidgets}
            widgetOrder={widgetOrder}
            onToggle={toggleWidget}
            onReorder={reorderWidgets}
            excludeIds={isAdmin ? [] : ["system_health"]}
          />
        </div>
      </div>

      <WelcomeDialog />
      <DiscordInviteBanner />

      {widgetOrder.map((widgetId) => {
        switch (widgetId) {
          case "badges":
            return isVisible("badges") ? (
              <section key="badges" className="py-8">
                <BadgesDisplay
                  allFirstStepsDone={allFirstStepsDone}
                  allSecondStepsDone={allSecondStepsDone}
                  allDiscordDone={allDiscordDone}
                  allThirdStepsDone={allThirdStepsDone}
                  allProjectTrainingDone={allProjectTrainingDone}
                  allVolunteerDone={allVolunteerDone}
                  communityBadgeCount={communityBadgeCount}
                />
              </section>
            ) : null;

          case "core_courses":
            return isVisible("core_courses") ? (
              <section key="core_courses" className="py-8">
                {allOnboardingDone ? (
                  (() => {
                    const observerHeading = observerNotStarted
                      ? "You're ready to observe a Tech Fleet project"
                      : observerInProgress
                      ? "Keep preparing to observe"
                      : "You finished the onboarding and core courses!";
                    const observerBody = observerNotStarted
                      ? "Great work finishing your onboarding. The Observer Course is your next step. It teaches you how to shadow a real project team and get ready to apply as an Observer."
                      : observerInProgress
                      ? `You've finished ${observerCompleted} of ${TOTAL_OBSERVER_LESSONS} sections in the Observer Course. Keep going to get ready to shadow a real Tech Fleet project team.`
                      : "Congratulations, you are ready to keep going into deeper training in our community! Check out the basic and advanced courses to go further.";
                    const observerCtaLabel = observerNotStarted
                      ? "Start observer course"
                      : observerInProgress
                      ? "Continue observer course"
                      : "Continue courses";
                    const observerCtaHref = observerDone ? "/courses" : "/courses/observer";
                    const observerPct = Math.round((observerCompleted / TOTAL_OBSERVER_LESSONS) * 100);
                    return (
                      <div className="tf-card overflow-hidden" aria-labelledby="core-courses-heading">
                        <h2 id="core-courses-heading" className="sr-only">
                          {observerNotStarted || observerInProgress ? "Observer Course next step" : "Onboard to Tech Fleet"}
                        </h2>
                        <div className="flex flex-col sm:flex-row items-stretch">
                          <div className="sm:w-48 md:w-56 flex-shrink-0 bg-primary/5">
                            <img
                              src={celebrationImg}
                              alt=""
                              width={224}
                              height={224}
                              className="w-full h-48 sm:h-full object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                          </div>
                          <div className="flex-1 p-6 flex flex-col justify-center space-y-3">
                            <div className="text-center sm:text-left">
                              <CardTitle as="h2">{observerHeading}</CardTitle>
                            </div>
                            <p className="text-base text-muted-foreground leading-relaxed text-center sm:text-left">
                              {observerBody}
                            </p>
                            {observerInProgress && (
                              <div className="space-y-2" aria-label="Observer Course progress">
                                <p className="text-sm font-medium text-foreground text-center sm:text-left">
                                  {observerCompleted} of {TOTAL_OBSERVER_LESSONS} sections complete
                                </p>
                                <Progress
                                  value={observerPct}
                                  aria-label={`Observer Course progress: ${observerCompleted} of ${TOTAL_OBSERVER_LESSONS} sections complete`}
                                />
                              </div>
                            )}
                            <div className="text-center sm:text-left">
                              <Button asChild variant="hero" size="lg">
                                <Link to={observerCtaHref}>{observerCtaLabel}</Link>
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <GettingStartedChecklist
                    title="Getting started"
                    items={onboardingChecklist}
                    storageKey={userId ?? "anon"}
                  />
                )}
              </section>
            ) : null;

          case "my_project_apps":
            return isVisible("my_project_apps") ? (
              <section key="my_project_apps" aria-labelledby="my-apps-heading" className="py-8">
                <div className="flex items-center justify-between mb-4">
                  <SectionTitle id="my-apps-heading">
                    My Applications
                  </SectionTitle>
                  <Link
                    to="/applications"
                    className="text-sm text-primary hover:underline"
                  >
                    View all
                  </Link>
                </div>

                {/* General Application card */}
                {generalApp ? (
                  <Link
                    to="/applications/general"
                    className="tf-card p-4 hover:border-primary/40 transition-all block mb-2"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-sm text-foreground truncate">
                            General Application
                          </h3>
                          {generalApp.status === "completed" ? (
                            <Badge variant="outline" className="bg-success/10 text-success border-success/20 text-xs flex-shrink-0">
                              Completed
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 text-xs flex-shrink-0">
                              Draft
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {generalApp.status === "completed" && generalApp.completed_at
                            ? `Completed ${format(new Date(generalApp.completed_at), "MMM d, yyyy")}`
                            : `Section ${generalApp.current_section} of 5 · Updated ${format(new Date(generalApp.updated_at), "MMM d")}`}
                        </p>
                      </div>
                    </div>
                  </Link>
                ) : (
                  <Link
                    to="/applications/general"
                    className="tf-card p-4 hover:border-primary/40 transition-all block mb-2"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm text-foreground truncate">General Application</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">Required before applying to projects</p>
                      </div>
                      <Badge variant="secondary" className="text-xs flex-shrink-0">Not Started</Badge>
                    </div>
                  </Link>
                )}

                {myProjectApps.length === 0 ? (
                  <SectionEmptyState
                    title="No project applications yet"
                    description="When project openings are available, you can apply and track your progress here."
                  />
                ) : (
                  <div className="space-y-2">
                    {myProjectApps.map((app) => {
                      const proj = dashProjectMap.get(app.project_id);
                      const client = proj ? dashClientMap.get(proj.client_id) : null;
                      const clientName = client?.name ?? "Client";
                      const friendly = (proj as any)?.friendly_name?.trim();
                      return (
                        <DashboardProjectAppCard
                          key={app.id}
                          app={app}
                          clientName={clientName}
                          isVolunteerOpening={(client as { kind?: string } | null)?.kind === "internal"}
                          friendly={friendly}
                          onOpenAgreement={() => setAgreementCtx({ id: app.id, name: friendly || clientName, clientName })}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            ) : null;

          case "latest_updates":
            return isVisible("latest_updates") ? (
              <section key="latest_updates" aria-labelledby="announcements-heading" className="py-8">
                <div className="flex items-center justify-between mb-4">
                  <SectionTitle id="announcements-heading">
                    Latest Updates
                  </SectionTitle>
                  <Link
                    to="/updates"
                    className="text-sm text-primary hover:underline"
                  >
                    View all
                  </Link>
                </div>
                {latestAnnouncements.length === 0 ? (
                  <SectionEmptyState
                    title="No updates yet"
                    description="Announcements and news from Tech Fleet will appear here."
                  />
                ) : (
                  <div className="space-y-2">
                    {latestAnnouncements.map((a) => (
                      <Link
                        key={a.id}
                        to="/updates"
                        className="tf-card p-4 hover:border-primary/40 transition-all block"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <h3 className="font-semibold text-sm text-foreground truncate">{a.title}</h3>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{stripHtml(a.body_html).slice(0, 120)}</p>
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                            {format(new Date(a.created_at), "MMM d")}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            ) : null;

          case "network_activity":
          case "world_map": {
            const lastNetworkIdx = widgetOrder.reduce((acc, w, i) => (w === "network_activity" || w === "world_map") ? i : acc, -1);
            if (widgetOrder[lastNetworkIdx] !== widgetId) return null;
            const showAny = isVisible("network_activity") || isVisible("world_map");
            // CWV pass 2 (LCP): NetworkActivity ships a heavy map + recent-activity
            // query that competes for bandwidth on dashboard cold load. Defer the
            // entire section to browser idle so it never blocks LCP on the
            // dashboard hero (welcome card + getting-started checklist).
            return showAny ? (
              <section key="network" className="py-8 min-h-[400px]">
                <IdleMount>
                  <Suspense fallback={<Skeleton className="h-[400px] rounded-lg" />}>
                    <NetworkActivity
                      showMap={isVisible("world_map")}
                      showActivity={isVisible("network_activity")}
                    />
                  </Suspense>
                </IdleMount>
              </section>
            ) : null;
          }

          case "system_health":
            // Admin-only widget — defer to idle so it never blocks LCP on /dashboard.
            return isAdmin && isVisible("system_health") ? (
              <section key="system_health" className="py-8 min-h-[200px]">
                <IdleMount>
                  <Suspense fallback={<Skeleton className="h-[200px] rounded-lg" />}>
                    <SystemHealthWidget />
                  </Suspense>
                </IdleMount>
              </section>
            ) : null;

          default:
            return null;
        }
      })}

      {showEmptyState && (
        <DashboardEmptyState onCustomize={handleOpenCustomizer} />
      )}

      {agreementCtx && (
        <CommunityAgreementSheet
          open={!!agreementCtx}
          onOpenChange={(o) => { if (!o) setAgreementCtx(null); }}
          applicationId={agreementCtx.id}
          projectName={agreementCtx.name}
          clientName={agreementCtx.clientName}
        />
      )}
    </div>
  );
}

interface DashboardAppLike {
  id: string;
  project_id: string;
  status: string;
  applicant_status: string | null;
  completed_at: string | null;
  updated_at: string;
  current_step: number;
  team_hats_interest: string[];
}

function DashboardProjectAppCard({
  app,
  clientName,
  isVolunteerOpening,
  friendly,
  onOpenAgreement,
}: {
  app: DashboardAppLike;
  clientName: string;
  isVolunteerOpening?: boolean;
  friendly?: string;
  onOpenAgreement: () => void;
}) {
  const isCompleted = app.status === "completed";
  const isDraft = app.status === "draft";
  const applicantStatus = app.applicant_status ?? undefined;
  const isActive = applicantStatus === "active_participant";
  const agreement = useAgreementStatus(app.id, isActive);
  const showAgreementPending = isActive && agreement.data?.status === "pending";

  const appHref = isCompleted
    ? `/applications/projects/${app.id}/status`
    : `/project-openings/${app.project_id}/apply`;

  return (
    <div className="tf-card p-4 hover:border-primary/40 transition-all">
      <Link to={appHref} className="block">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm text-foreground truncate">{clientName}</h3>
              <ApplicationStatusBadge status={app.status} applicantStatus={applicantStatus} />
              {isVolunteerOpening && (
                <Badge className="bg-info/10 text-info border-info/30 text-xs">Volunteer Opening</Badge>
              )}
              {showAgreementPending && (
                <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300 text-xs">
                  Sign Community Agreement
                </Badge>
              )}
            </div>
            {friendly && <p className="text-xs text-muted-foreground mt-0.5 truncate">{friendly}</p>}
            <p className="text-xs text-muted-foreground mt-0.5">
              {isCompleted && app.completed_at
                ? `Submitted ${format(new Date(app.completed_at), "MMM d, yyyy")}`
                : isDraft
                  ? `Step ${app.current_step} of 3 · Updated ${format(new Date(app.updated_at), "MMM d")}`
                  : ""}
              {app.team_hats_interest.length > 0 && ` · ${app.team_hats_interest.join(", ")}`}
            </p>
          </div>
        </div>
      </Link>
      {showAgreementPending && (
        <div className="mt-3 flex">
          <Button
            size="sm"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenAgreement(); }}
            className="gap-1.5"
          >
            <FileCheck2 className="h-3.5 w-3.5" />
            Sign now
          </Button>
        </div>
      )}
    </div>
  );
}
