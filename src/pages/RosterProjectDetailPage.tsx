import React, { Suspense, useState } from "react";
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/hooks/use-admin";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResponsiveTabs, ResponsiveTabsList, ResponsiveTabsContent, type TabItem } from "@/components/ui/responsive-tabs";
import { Loader2, ShieldAlert, FolderKanban, Users } from "lucide-react";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PROJECT_TYPES, PROJECT_PHASES, PROJECT_STATUSES } from "@/data/project-constants";

const ProjectAnalysisContent = lazy(() => import("@/components/admin/ProjectAnalysisContent"));
const ProjectRosterContent = lazy(() => import("@/components/admin/ProjectRosterContent"));
const ProjectBlastComposer = lazy(() => import("@/components/recruiting/ProjectBlastComposer"));
const ProjectBlastHistory = lazy(() => import("@/components/recruiting/ProjectBlastHistory"));

const typeLabel = (v: string) => PROJECT_TYPES.find((t) => t.value === v)?.label ?? v;
const phaseLabel = (v: string) => PROJECT_PHASES.find((p) => p.value === v)?.label ?? v;
const statusLabel = (v: string) => PROJECT_STATUSES.find((s) => s.value === v)?.label ?? v;

function TabFallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

export default function RosterProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdmin();
  const [tab, setTab] = useState("analysis");

  // CWV pass 5 (TTFB): single combined RPC replaces two sequential queries
  // (project header + applicant count). Cuts admin roster header round-trips
  // from 2 → 1 and lets RLS check run server-side once instead of twice.
  const { data: header, isLoading: projLoading } = useQuery({
    queryKey: ["roster-project-header", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_roster_project_header", {
        p_project_id: projectId!,
      });
      if (error) throw error;
      return data as {
        project: {
          id: string;
          project_type: string;
          phase: string;
          project_status: string;
          team_hats: string[];
          client_id: string;
          friendly_name?: string;
          description?: string;
          coordinator_id?: string | null;
          client_name: string | null;
        } | null;
        app_count: number;
      } | null;
    },
    enabled: !!projectId && !!user && isAdmin,
  });

  const project = header?.project
    ? { ...header.project, clients: header.project.client_name ? { name: header.project.client_name } : null }
    : undefined;
  const appCount = header?.app_count ?? 0;


  const baseClientName = project?.clients?.name ?? "Project";
  const clientName = project?.friendly_name?.trim()
    ? `${baseClientName} — ${project.friendly_name}`
    : baseClientName;

  // CWV pass 2 (LCP): Render the breadcrumb + H1 + applicant-count summary
  // synchronously. Previously this page blocked the entire shell behind a
  // single spinner until the project query resolved (~600–900ms TTFB on
  // admin routes), pushing LCP above 3s. The page header is now first paint
  // and the tabs hydrate underneath it as data lands.

  if (adminLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Loading" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <ShieldAlert className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground font-medium">Access denied. Admin role required.</p>
      </div>
    );
  }

  if (!projLoading && !project) {
    return (
      <div className="container-app py-12 text-center">
        <FolderKanban className="h-12 w-12 mx-auto mb-4 opacity-40 text-muted-foreground" />
        <p className="text-muted-foreground">Project not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/admin/roster")}>
          Back to Recruiting Center
        </Button>
      </div>
    );
  }

  return (
    <div className="container-app py-8 sm:py-12 max-w-6xl mx-auto space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/roster">Recruiting Center</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{clientName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-2xl font-bold text-foreground">{clientName}</h1>
        {project?.description?.trim() && (
          <TranslatedContent
            as="p"
            className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap leading-relaxed"
            entityTable="projects"
            entityId={project.id}
            columnName="description"
            sourceText={project.description}
            contentFormat="markdown"
          />
        )}
        <div className="flex items-center gap-2 mt-2 flex-wrap min-h-[24px]">
          {project ? (
            <>
              <Badge variant="secondary">{typeLabel(project.project_type)}</Badge>
              <Badge variant="outline">{phaseLabel(project.phase)}</Badge>
              <Badge variant="outline">{statusLabel(project.project_status)}</Badge>
              <Badge variant="default" className="gap-1">
                <Users className="h-3 w-3" />
                {appCount} {appCount === 1 ? "applicant" : "applicants"}
              </Badge>
            </>
          ) : (
            // Reserve badge-row height to prevent CLS while project loads
            <span aria-hidden="true" className="inline-block h-[24px]" />
          )}
        </div>
      </div>

      {(() => {
        const tabs: TabItem[] = [
          { value: "analysis", label: "Application Analysis" },
          { value: "roster", label: "Project Roster" },
          { value: "blast", label: "Blast" },
        ];
        return (
          <ResponsiveTabs value={tab} onValueChange={setTab}>
            <ResponsiveTabsList tabs={tabs} value={tab} onValueChange={setTab} />
            <ResponsiveTabsContent value="analysis" className="mt-6">
              <Suspense fallback={<TabFallback />}>
                <ProjectAnalysisContent projectId={projectId!} />
              </Suspense>
            </ResponsiveTabsContent>
            <ResponsiveTabsContent value="roster" className="mt-6">
              <Suspense fallback={<TabFallback />}>
                <ProjectRosterContent projectId={projectId!} />
              </Suspense>
            </ResponsiveTabsContent>
            <ResponsiveTabsContent value="blast" className="mt-6 space-y-6">
              <Suspense fallback={<TabFallback />}>
                <ProjectBlastComposer
                  projectId={projectId!}
                  projectName={clientName}
                  canSend={isAdmin}
                />
              </Suspense>
              <Suspense fallback={<TabFallback />}>
                <ProjectBlastHistory projectId={projectId!} />
              </Suspense>
            </ResponsiveTabsContent>
          </ResponsiveTabs>
        );
      })()}
    </div>
  );
}
