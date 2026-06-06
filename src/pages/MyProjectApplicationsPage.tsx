import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/use-admin";
import { format } from "date-fns";
import {
  ArrowLeft, CheckCircle2, Clock, ExternalLink, Loader2, FolderKanban,
  LayoutGrid, List,
} from "lucide-react";
import { PageTitle } from "@/components/ui/typography";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PROJECT_TYPES, PROJECT_PHASES, PROJECT_STATUSES } from "@/data/project-constants";
import { ThemedAgGrid } from "@/components/AgGrid";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { ClientLogo } from "@/components/ClientLogo";
import { ProjectOpeningHeading } from "@/components/projects/ProjectOpeningHeading";

const typeLabel = (v: string) => PROJECT_TYPES.find((t) => t.value === v)?.label ?? v;
const phaseLabel = (v: string) => PROJECT_PHASES.find((p) => p.value === v)?.label ?? v;
const statusLabel = (v: string) => PROJECT_STATUSES.find((s) => s.value === v)?.label ?? v;

interface ProjectApp {
  id: string;
  project_id: string;
  status: string;
  applicant_status: string;
  current_step: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  participated_previous_phase: boolean;
  team_hats_interest: string[];
}

/** Statuses that indicate the applicant should see a status page instead of the application editor. */
const STATUS_PAGE_STATUSES = new Set([
  "invited_to_interview",
  "interview_scheduled",
  "not_selected",
  "active_participant",
  "left_the_project",
]);

const APPLICANT_STATUS_LABELS: Record<string, string> = {
  pending_review: "Pending Review",
  invited_to_interview: "Invited to Interview",
  interview_scheduled: "Interview Scheduled",
  not_selected: "Not Selected",
  active_participant: "Active Participant",
  left_the_project: "Left the Project",
};

interface EnrichedApp extends ProjectApp {
  project?: { id: string; project_type: string; phase: string; project_status: string; client_id: string; team_hats: string[]; friendly_name?: string | null };
  client?: { id: string; name: string; logo_url?: string | null; kind?: "external" | "internal" };
}

/** Returns the correct route for a given application based on its status. */
function getAppRoute(app: EnrichedApp): string {
  // All completed (submitted) applications go to the status page
  if (app.status === "completed") {
    return `/applications/projects/${app.id}/status`;
  }
  // If applicant_status is beyond pending_review, also go to status page (no editing)
  if (STATUS_PAGE_STATUSES.has(app.applicant_status)) {
    return `/applications/projects/${app.id}/status`;
  }
  return `/project-openings/${app.project_id}/apply`;
}

export default function MyProjectApplicationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { isAdmin } = useAdmin();
  const [view, setView] = useState<"card" | "table">("card");
  

  /* Realtime invalidation is mounted globally in AppLayout
   * (useProjectApplicationsRealtime + useNotificationRealtime), so we no
   * longer need a 30s setInterval here. CACHE_USER_MUTABLE + focus refetch
   * cover the cold-tab case. */

  const { data: apps, isLoading } = useQuery({
    queryKey: ["my-project-applications", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_applications")
        .select("*")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ProjectApp[];
    },
    enabled: !!user,
    staleTime: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const projectIds = useMemo(() => [...new Set((apps ?? []).map((a) => a.project_id))], [apps]);

  const { data: projects } = useQuery({
    queryKey: ["my-projects-for-apps", projectIds],
    queryFn: async () => {
      if (projectIds.length === 0) return [];
      const { data, error } = await supabase
        .from("projects").select("*").in("id", projectIds);
      if (error) throw error;
      return (data ?? []) as { id: string; project_type: string; phase: string; project_status: string; client_id: string; team_hats: string[]; friendly_name?: string | null }[];
    },
    enabled: projectIds.length > 0,
  });

  const clientIds = useMemo(() => [...new Set((projects ?? []).map((p) => p.client_id))], [projects]);

  const { data: clients } = useQuery({
    queryKey: ["my-clients-for-apps", clientIds],
    queryFn: async () => {
      if (clientIds.length === 0) return [];
      const { data, error } = await supabase
        .from("clients").select("id, name, logo_url, kind").in("id", clientIds);
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; logo_url: string | null; kind?: "external" | "internal" }[];
    },
    enabled: clientIds.length > 0,
  });

  const projectMap = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects]);
  const clientMap = useMemo(() => new Map((clients ?? []).map((c) => [c.id, c])), [clients]);

  const enriched = useMemo(() => (apps ?? []).map((a) => {
    const proj = projectMap.get(a.project_id);
    const cli = proj ? clientMap.get(proj.client_id) : undefined;
    return { ...a, project: proj, client: cli };
  }), [apps, projectMap, clientMap]);

  /* ── AG Grid column definitions ── */
  const columnDefs = useMemo<ColDef<EnrichedApp>[]>(() => [
    {
      headerName: "Client",
      field: "client",
      valueGetter: (p) => p.data?.client?.name ?? "Unknown",
      flex: 1.5,
      minWidth: 140,
    },
    {
      headerName: "Project",
      colId: "project_friendly",
      valueGetter: (p) => p.data?.project?.friendly_name?.trim() || "—",
      flex: 1.5,
      minWidth: 140,
    },
    {
      headerName: "App Status",
      field: "status",
      cellRenderer: (p: ICellRendererParams<EnrichedApp>) => {
        const d = p.data;
        if (!d) return null;
        if (d.status === "completed") return "Submitted";
        if (d.status === "draft") return "In Progress";
        return d.status;
      },
      flex: 0.8,
      minWidth: 90,
    },
    {
      headerName: "Applicant Status",
      field: "applicant_status",
      valueGetter: (p) => APPLICANT_STATUS_LABELS[p.data?.applicant_status ?? "pending_review"] ?? p.data?.applicant_status,
      flex: 1.2,
      minWidth: 130,
    },
    {
      headerName: "Type",
      valueGetter: (p) => typeLabel(p.data?.project?.project_type ?? ""),
      flex: 1,
      minWidth: 120,
    },
    {
      headerName: "Phase",
      valueGetter: (p) => phaseLabel(p.data?.project?.phase ?? ""),
      flex: 0.8,
      minWidth: 80,
    },
    {
      headerName: "Project Status",
      valueGetter: (p) => statusLabel(p.data?.project?.project_status ?? ""),
      flex: 1,
      minWidth: 110,
    },
    {
      headerName: "Team Hats",
      valueGetter: (p) => (p.data?.team_hats_interest ?? []).join(", "),
      flex: 1.5,
      minWidth: 140,
    },
    {
      headerName: "Date",
      valueGetter: (p) => {
        const d = p.data;
        if (!d) return "";
        return d.completed_at
          ? format(new Date(d.completed_at), "MMM d, yyyy")
          : format(new Date(d.updated_at), "MMM d, yyyy");
      },
      flex: 1,
      minWidth: 110,
    },
    {
      headerName: "",
      sortable: false,
      filter: false,
      maxWidth: 100,
      cellRenderer: (p: ICellRendererParams<EnrichedApp>) => {
        if (!p.data) return null;
        const route = getAppRoute(p.data);
        const isStatusPage = route.includes("/status");
        return (
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-7 text-xs"
            onClick={() => navigate(route)}
          >
            {isStatusPage ? "Status" : p.data.status === "completed" ? "View" : "Continue"}
            <ExternalLink className="h-3 w-3" />
          </Button>
        );
      },
    },
  ], [navigate]);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container-app py-8 sm:py-12 max-w-4xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/applications">Applications</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Project Applications</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/applications")} aria-label="Back to Applications">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <PageTitle>Your Project Applications</PageTitle>
            <p className="text-sm text-muted-foreground">
              Track the status of your project team applications.
            </p>
          </div>
        </div>

        {/* View toggle */}
        {enriched.length > 0 && (
          <div className="flex items-center gap-1 self-start">
            <Button
              variant={view === "card" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("card")}
              aria-label="Card view"
              className="gap-1.5"
            >
              <LayoutGrid className="h-4 w-4" />
              Cards
            </Button>
            <Button
              variant={view === "table" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("table")}
              aria-label="Table view"
              className="gap-1.5"
            >
              <List className="h-4 w-4" />
              Table
            </Button>
          </div>
        )}
      </div>

      {enriched.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto">
            <FolderKanban className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-lg font-medium text-foreground">No project applications yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Browse open projects and submit your first application.
            </p>
          </div>
          <Button onClick={() => navigate("/project-openings")} className="mt-2">
            Browse Project Openings
          </Button>
        </div>
      ) : view === "table" ? (
        <ThemedAgGrid<EnrichedApp>
          gridId="my-project-applications"
          height="450px"
          rowData={enriched}
          columnDefs={columnDefs}
          onRowClicked={(e) => {
            if (e.data) navigate(getAppRoute(e.data));
          }}
          showExportCsv={isAdmin}
          exportFileName="my-project-applications"
        />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {enriched.map((app) => {
            const isCompleted = app.status === "completed";
            const isDraft = app.status === "draft";
            const route = getAppRoute(app);
            const hasStatusUpdate = isCompleted && STATUS_PAGE_STATUSES.has(app.applicant_status);
            const statusLabel2 = APPLICANT_STATUS_LABELS[app.applicant_status] ?? app.applicant_status;

            return (
              <Card
                key={app.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(route)}
              >
                <CardContent className="pt-5 space-y-3">
                  {/* Client & Status */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <ClientLogo url={app.client?.logo_url} name={app.client?.name} size="md" />
                      <ProjectOpeningHeading
                        clientName={app.client?.name ?? "Unknown Client"}
                        friendlyName={app.project?.friendly_name}
                        size="md"
                        as="h3"
                        truncate
                        className="flex-1"
                      />
                    </div>
                    {hasStatusUpdate ? (
                      <Badge className={`gap-1 shrink-0 ${
                        app.applicant_status === "invited_to_interview" ? "bg-primary/10 text-primary border-primary/30" :
                        app.applicant_status === "interview_scheduled" || app.applicant_status === "active_participant" ? "bg-success/10 text-success border-success/30" :
                        app.applicant_status === "not_selected" ? "bg-destructive/10 text-destructive border-destructive/30" :
                        "bg-muted text-muted-foreground border-border"
                      }`}>
                        {statusLabel2}
                      </Badge>
                    ) : isCompleted ? (
                      <Badge className="bg-success/10 text-success border-success/30 gap-1 shrink-0">
                        <CheckCircle2 className="h-3 w-3" />
                        Submitted
                      </Badge>
                    ) : isDraft ? (
                      <Badge className="bg-warning/10 text-warning border-warning/30 gap-1 shrink-0">
                        <Clock className="h-3 w-3" />
                        In Progress
                      </Badge>
                    ) : null}
                  </div>

                  {/* Project details */}
                  <div className="flex flex-wrap gap-1.5">
                    {app.client?.kind === "internal" && (
                      <Badge className="bg-info/10 text-info border-info/30 text-xs">Volunteer Opening</Badge>
                    )}
                    <Badge variant="outline" className="text-xs">{typeLabel(app.project?.project_type ?? "")}</Badge>
                    <Badge variant="outline" className="text-xs">{phaseLabel(app.project?.phase ?? "")}</Badge>
                    <Badge variant="secondary" className="text-xs">{statusLabel(app.project?.project_status ?? "")}</Badge>
                  </div>

                  {/* Team hats */}
                  {app.team_hats_interest.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-muted-foreground">Your Team Hats</p>
                      <div className="flex flex-wrap gap-1">
                        {app.team_hats_interest.map((h) => (
                          <Badge key={h} variant="outline" className="text-xs">{h}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Progress / Date */}
                  {isCompleted && app.completed_at ? (
                    <p className="text-xs text-muted-foreground">
                      Submitted on {format(new Date(app.completed_at), "MMM d, yyyy")}
                    </p>
                  ) : isDraft ? (
                    <p className="text-xs text-muted-foreground">
                      Step {app.current_step} of 3 · Last updated {format(new Date(app.updated_at), "MMM d, yyyy")}
                    </p>
                  ) : null}

                  <Button variant={hasStatusUpdate && app.applicant_status === "invited_to_interview" ? "default" : "outline"} size="sm" className="w-full gap-1">
                    {hasStatusUpdate ? (app.applicant_status === "invited_to_interview" ? "Accept Invitation" : "View Status") : isCompleted ? "View Status" : "Continue Application"}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
