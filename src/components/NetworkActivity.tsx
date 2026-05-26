import { memo, Suspense } from "react";
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry";
import { BookOpen, Award, FileCheck, UserPlus, Briefcase, Rocket, PlayCircle, CheckCircle2, MessageCircle, Info } from "lucide-react";
import { useQuery } from "@/lib/react-query";
import { StatsService, type NetworkStats } from "@/services/stats.service";
import { PageTitle, SectionTitle } from "@/components/ui/typography";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";

const MemberWorldMap = lazy(() =>
  import("@/components/MemberWorldMap").then((m) => ({ default: m.MemberWorldMap }))
);

const defaultStats: NetworkStats = {
  total_signups: 0,
  course_completions_total: 0,
  core_courses_active: 0,
  onboarding_courses_active: 0,
  discord_links_count: 0,
  beginner_courses_active: 0,
  advanced_courses_active: 0,
  applications_completed: 0,
  badges_earned: 0,
  prev_week_start: "",
  prev_week_end: "",
  prev_week_signups: 0,
  prev_week_course_completions_total: 0,
  prev_week_core_active: 0,
  prev_week_onboarding_active: 0,
  prev_week_discord_links_count: 0,
  prev_week_beginner_active: 0,
  prev_week_advanced_active: 0,
  prev_week_applications: 0,
  prev_week_badges: 0,
  projects_open_applications: 0,
  projects_coming_soon: 0,
  projects_live: 0,
  projects_previously_completed: 0,
};

interface StatCardProps {
  icon?: React.ReactNode;
  value: number;
  label: string;
  sublabel?: string;
  tooltip?: string;
  colorClass?: string;
}

const StatCard = memo(function StatCard({ value, label, sublabel, tooltip }: StatCardProps) {
  return (
    <div
      className="relative flex aspect-square w-full max-w-[190px] flex-col items-center text-center overflow-hidden p-4"
      style={{
        border: "3px solid var(--tf-stat-border)",
        backgroundColor: "var(--tf-stat-bg)",
        borderRadius: "400px",
        boxShadow:
          "inset 5px 5px 20px 3px var(--tf-stat-glow-1), inset -5px -5px 20px 5px var(--tf-stat-glow-2)",
      }}
    >
      {/* Top half: number anchored to the bottom of this region so every circle's
          number sits at the same vertical position regardless of label length. */}
      <div className="flex h-1/2 w-full items-end justify-center">
        <p
          className="font-display font-semibold leading-none"
          style={{
            color: "var(--tf-stat-text)",
            fontSize: "clamp(1.75rem, 3vw, 2.75rem)",
            letterSpacing: "1px",
          }}
        >
          {value}
        </p>
      </div>
      {/* Bottom half: label sits flush to the top of this region, just under the number. */}
      <div className="flex h-1/2 w-full flex-col items-center pt-2">
        <div className="flex max-w-[90%] items-center justify-center gap-1.5">
          <p
            className="text-sm sm:text-base font-medium leading-tight"
            style={{ color: "var(--tf-stat-label, var(--tf-stat-text))" }}
          >
            {label}
          </p>
          {tooltip ? (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger
                  type="button"
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label={`${label} details`}
                >
                  <Icon icon={Info} size="micro" />
                </TooltipTrigger>
                <TooltipContent className="max-w-56 text-center">
                  {tooltip}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
        {sublabel ? (
          <p
            className="mt-1 text-[0.7rem] leading-tight max-w-[90%] opacity-80"
            style={{ color: "var(--tf-stat-label, var(--tf-stat-text))" }}
          >
            {sublabel}
          </p>
        ) : null}
      </div>
    </div>
  );
});

function parseStatsDate(value: string): Date | null {
  if (!value) return null;

  const isoDateMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function formatDateRange(start: string, end: string): string {
  const startDate = parseStatsDate(start);
  const endDate = parseStatsDate(end);

  if (!startDate || !endDate) return "";

  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  return `${formatter.format(startDate)} – ${formatter.format(endDate)}, ${endDate.getUTCFullYear()}`;
}

function MapFallback() {
  return <Skeleton className="w-full h-[400px] rounded-lg" />;
}

interface NetworkActivityProps {
  showMap?: boolean;
  showActivity?: boolean;
}

export const NetworkActivity = memo(function NetworkActivity({ showMap = true, showActivity = true }: NetworkActivityProps) {
  const { data: stats, isError, isLoading: loading } = useQuery({
    queryKey: ["network-stats", "v5"],
    queryFn: () => StatsService.getNetworkStats(),
    staleTime: 60 * 1000, // 1 min — keep numbers fresh on the landing page
    refetchInterval: 2 * 60 * 1000, // refresh every 2 min while mounted
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // Discord community member count — cached server-side for 24h.
  const { data: discordStats } = useQuery({
    queryKey: ["discord-member-count"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ member_count: number }>(
        "get-discord-member-count",
        { method: "GET" },
      );
      if (error) throw error;
      return data;
    },
    staleTime: 60 * 60 * 1000, // 1h client cache
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // Graceful degradation: if the live RPC failed and the service-layer cache
  // also threw, try the cache directly here so the widget still renders
  // last-known stats instead of an empty error state.
  const cached = !stats ? StatsService.getCachedNetworkStats() : null;
  const effectiveStats = stats ?? cached?.stats ?? null;
  const isStale = !stats && !!cached;

  if (loading && !effectiveStats) {
    return (
      <section aria-labelledby="network-activity-heading" className="py-12 sm:py-16" style={{ minHeight: 800 }}>
        <div className="container-app">
          <Skeleton className="h-8 w-48 mb-8" />
          <div className="grid grid-cols-1 min-[560px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 justify-items-start">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (isError && !effectiveStats) {
    return (
      <section aria-labelledby="network-activity-heading" className="py-12 sm:py-16">
        <div className="container-app">
          <div className="mb-8">
            <PageTitle id="network-activity-heading">
              Network Activity
            </PageTitle>
            <p className="text-muted-foreground mt-2">
              We could not load community activity right now. Please refresh in a moment.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const safeStats = effectiveStats ?? defaultStats;
  const formatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
  const lastUpdatedLabel = isStale && cached
    ? formatter.format(new Date(cached.cachedAt))
    : stats
      ? formatter.format(new Date())
      : null;

  return (
    <section aria-labelledby="network-activity-heading" className="py-12 sm:py-16">
      <div className="container-app">
        <div className="mb-8">
          <PageTitle id="network-activity-heading">
            Network Activity
          </PageTitle>
          <p className="text-muted-foreground mt-2">
            See what our community members are working on right now
          </p>
          {isStale && lastUpdatedLabel ? (
            <p
              className="text-xs text-muted-foreground/80 mt-2"
              role="status"
              aria-live="polite"
            >
              Showing last known activity from {lastUpdatedLabel}. We'll refresh automatically when the live feed is back.
            </p>
          ) : lastUpdatedLabel ? (
            <p className="text-xs text-muted-foreground/80 mt-2" aria-live="polite">
              Last updated {lastUpdatedLabel}
            </p>
          ) : null}
        </div>

        {showActivity && (
          <>
            <SectionTitle className="mb-9 text-center sm:text-left">All Time</SectionTitle>
            <div className="grid grid-cols-1 min-[560px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 justify-items-start mb-10">
              <StatCard icon={<UserPlus className="h-5 w-5 text-primary" aria-hidden="true" />} value={safeStats.total_signups} label="Platform Signups" colorClass="bg-primary/10" />
              <StatCard icon={<MessageCircle className="h-5 w-5 text-info" aria-hidden="true" />} value={discordStats?.member_count ?? 0} label="Discord Members" colorClass="bg-info/10" />
              <StatCard
                icon={<BookOpen className="h-5 w-5 text-warning" aria-hidden="true" />}
                value={safeStats.course_completions_total ?? safeStats.core_courses_active}
                label="Core Course Completions"
                colorClass="bg-warning/10"
              />
              <StatCard icon={<BookOpen className="h-5 w-5 text-info" aria-hidden="true" />} value={(safeStats.historical?.historical_beginner_courses ?? 0) + (safeStats.beginner_courses_active ?? 0)} label="Beginner course registrations" colorClass="bg-info/10" />
              <StatCard icon={<BookOpen className="h-5 w-5 text-accent-foreground" aria-hidden="true" />} value={(safeStats.historical?.historical_advanced_courses ?? 0) + (safeStats.advanced_courses_active ?? 0)} label="Advanced course registrations" colorClass="bg-accent/50" />
              <StatCard icon={<FileCheck className="h-5 w-5 text-success" aria-hidden="true" />} value={(safeStats.historical?.general_applications_pre_platform ?? 0) + (safeStats.applications_completed ?? 0)} label="General applications submitted" colorClass="bg-success/10" />
              <StatCard
                icon={<Award className="h-5 w-5 text-primary" aria-hidden="true" />}
                value={safeStats.badges_earned}
                label="Badges Earned"
                colorClass="bg-primary/10"
              />
            </div>

            <SectionTitle className="mb-9 mt-8 text-center sm:text-left">Project Training</SectionTitle>
            <div className="grid grid-cols-1 min-[560px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 justify-items-start mb-10">
              <StatCard icon={<CheckCircle2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />} value={safeStats.projects_previously_completed} label="Previous Projects" colorClass="bg-muted" />
              <StatCard icon={<Briefcase className="h-5 w-5 text-success" aria-hidden="true" />} value={safeStats.projects_open_applications} label="Open Applications" colorClass="bg-success/10" />
              <StatCard icon={<Rocket className="h-5 w-5 text-warning" aria-hidden="true" />} value={safeStats.projects_coming_soon} label="Coming Soon" colorClass="bg-warning/10" />
              <StatCard icon={<PlayCircle className="h-5 w-5 text-primary" aria-hidden="true" />} value={safeStats.projects_live} label="Live" colorClass="bg-primary/10" />
            </div>

            <div className="pt-8">
              <div className="mb-9">
                <SectionTitle className="text-center sm:text-left">Past 7 Days</SectionTitle>
                {safeStats.prev_week_start && safeStats.prev_week_end && (
                  <p className="text-sm text-muted-foreground mt-1 text-center sm:text-left">
                    {formatDateRange(safeStats.prev_week_start, safeStats.prev_week_end)}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 min-[560px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 justify-items-start">
                <StatCard icon={<UserPlus className="h-5 w-5 text-primary" aria-hidden="true" />} value={safeStats.prev_week_signups} label="Platform Signups" colorClass="bg-primary/10" />
                <StatCard
                  icon={<BookOpen className="h-5 w-5 text-warning" aria-hidden="true" />}
                  value={safeStats.prev_week_course_completions_total ?? safeStats.prev_week_core_active}
                  label="Core Course Completions"
                  colorClass="bg-warning/10"
                />
                <StatCard icon={<BookOpen className="h-5 w-5 text-info" aria-hidden="true" />} value={safeStats.prev_week_beginner_active} label="Beginner Course Completions" colorClass="bg-info/10" />
                <StatCard icon={<BookOpen className="h-5 w-5 text-accent-foreground" aria-hidden="true" />} value={safeStats.prev_week_advanced_active} label="Advanced Course Completions" colorClass="bg-accent/50" />
                <StatCard icon={<FileCheck className="h-5 w-5 text-success" aria-hidden="true" />} value={safeStats.prev_week_applications} label="General Applications Completed" colorClass="bg-success/10" />
                <StatCard
                  icon={<Award className="h-5 w-5 text-primary" aria-hidden="true" />}
                  value={safeStats.prev_week_badges}
                  label="Badges Earned"
                  colorClass="bg-primary/10"
                />
              </div>
            </div>

          </>
        )}

        {showMap && (
          <div className={showActivity ? "pt-8 mt-8" : ""}>
            <Suspense fallback={<MapFallback />}>
              <MemberWorldMap />
            </Suspense>
          </div>
        )}
      </div>
    </section>
  );
});
