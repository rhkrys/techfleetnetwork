import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ClipboardList, FolderKanban, HeartHandshake, ArrowRight, CheckCircle2, Lock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/use-admin";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GeneralApplicationService } from "@/services/general-application.service";
import { reportError } from "@/services/error-reporter.service";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTabs, ResponsiveTabsList, ResponsiveTabsContent, type TabItem } from "@/components/ui/responsive-tabs";

import { format } from "date-fns";
import { Suspense } from "react";
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry";

const SubmittedApplicationsTab = lazy(() =>
  import("@/components/SubmittedApplicationsTab").then((m) => ({
    default: m.default,
  }))
);

export default function ApplicationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAdmin } = useAdmin();
  const defaultTab = "yours";
  const [appStatus, setAppStatus] = useState<{ completed: boolean; completedAt: string | null }>({ completed: false, completedAt: null });

  useEffect(() => {
    if (!user) return;
    GeneralApplicationService.list(user.id).then((apps) => {
      const app = apps[0];
      if (app && (app.status === "completed" || app.completed_at)) {
        setAppStatus({ completed: true, completedAt: app.completed_at ?? app.updated_at });
      } else {
        setAppStatus({ completed: false, completedAt: null });
      }
    }).catch((e) => reportError(e, "ApplicationsPage.loadGeneralApp", { severity: "warn" }));
  }, [user]);

  /* Count user's own project applications for the card badge */
  const { data: myProjectApps } = useQuery({
    queryKey: ["my-project-apps-count", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_applications")
        .select("id, status")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const projAppCount = myProjectApps?.length ?? 0;
  const projAppsCompleted = myProjectApps?.filter((a) => a.status === "completed").length ?? 0;
  const projAppsDraft = myProjectApps?.filter((a) => a.status === "draft").length ?? 0;

  const yourApplicationsContent = (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {/* General Application Card */}
      <Link
        to="/applications/general"
        className="group rounded-lg border bg-card p-6 hover:shadow-md transition-shadow duration-200 flex flex-col relative"
      >
        {appStatus.completed && (
          <Badge className="absolute top-4 right-4 bg-success/10 text-success border-success/30 gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Completed
          </Badge>
        )}
        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center mb-4">
          <ClipboardList className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">
          My General Application
        </h2>
        <p className="text-sm text-muted-foreground flex-1">
          Submit your general application to join the Tech Fleet community.
          Covers your background, agile mindset, and service leadership.
        </p>
        {appStatus.completed && appStatus.completedAt && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-success/10 border border-success/20 px-3 py-2">
            <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
            <span className="text-sm font-medium text-success">
              Completed on {format(new Date(appStatus.completedAt), "MMM d, yyyy")}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1 mt-4 text-sm font-medium text-primary group-hover:gap-2 transition-all">
          {appStatus.completed ? "View & Edit" : "Open"}
          <ArrowRight className="h-4 w-4" />
        </div>
      </Link>

      {/* Project Applications Card */}
      <Link
        to="/applications/projects"
        className="group rounded-lg border bg-card p-6 hover:shadow-md transition-shadow duration-200 flex flex-col relative"
      >
        {projAppsCompleted > 0 && (
          <Badge className="absolute top-4 right-4 bg-success/10 text-success border-success/30 gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {projAppsCompleted} Submitted
          </Badge>
        )}
        {projAppsCompleted === 0 && projAppsDraft > 0 && (
          <Badge className="absolute top-4 right-4 bg-warning/10 text-warning border-warning/30 gap-1">
            {projAppsDraft} In Progress
          </Badge>
        )}
        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center mb-4">
          <FolderKanban className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">
          My Project Applications
        </h2>
        <p className="text-sm text-muted-foreground flex-1">
          View your project team applications. Each project has its own
          application requirements and timeline.
        </p>
        <div className="flex items-center gap-1 mt-4 text-sm font-medium text-primary group-hover:gap-2 transition-all">
          {projAppCount > 0 ? "View Applications" : "Browse Openings"}
          <ArrowRight className="h-4 w-4" />
        </div>
      </Link>

      {/* Volunteer Applications Card */}
      <div className="rounded-lg border bg-card p-6 flex flex-col">
        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center mb-4">
          <HeartHandshake className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">
          My Volunteer Applications
        </h2>
        <p className="text-sm text-muted-foreground flex-1">
          Apply to volunteer teams that support Tech Fleet operations,
          mentorship, and community initiatives.
        </p>
        <span className="mt-4 text-sm text-muted-foreground italic">Coming soon</span>
      </div>
    </div>
  );

  const [tab, setTab] = useState("yours");

  const appTabs: TabItem[] = [
    { value: "yours", label: "Your Applications" },
    ...(isAdmin
      ? [{ value: "all", label: "All Applications" }]
      : [{ value: "all", label: "All Applications", disabled: true }]),
  ];

  return (
    <div className="container-app py-8 sm:py-12">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
          Applications
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage your applications and track your progress.
        </p>
      </div>

      <ResponsiveTabs value={tab} onValueChange={(v) => { if (v === "all" && !isAdmin) return; setTab(v); }}>
        <ResponsiveTabsList tabs={appTabs} value={tab} onValueChange={(v) => { if (v === "all" && !isAdmin) return; setTab(v); }} />
        <ResponsiveTabsContent value="yours" className="mt-6">
          {yourApplicationsContent}
        </ResponsiveTabsContent>
        {isAdmin && (
          <ResponsiveTabsContent value="all" className="mt-6">
            <Suspense fallback={<div className="flex items-center justify-center py-12"><div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
              <SubmittedApplicationsTab />
            </Suspense>
          </ResponsiveTabsContent>
        )}
      </ResponsiveTabs>
    </div>
  );
}
