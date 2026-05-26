import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/use-admin";
import { SEO } from "@/components/SEO";
import {
  Handshake, ExternalLink, LayoutGrid, List, Loader2, Eye, CheckCircle2,
  Rocket, PlayCircle, Clock, Briefcase,
} from "lucide-react";
import { ResponsiveTabs, ResponsiveTabsList, ResponsiveTabsContent, type TabItem } from "@/components/ui/responsive-tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PROJECT_TYPES, PROJECT_PHASES, PROJECT_STATUSES, TEAM_HATS,
} from "@/data/project-constants";
import { ThemedAgGrid } from "@/components/AgGrid";
import { ProjectOpeningHeading } from "@/components/projects/ProjectOpeningHeading";
import type { ColDef } from "ag-grid-community";

interface OpenProject {
  id: string;
  client_id: string;
  project_type: string;
  phase: string;
  project_status: string;
  team_hats: string[];
  current_phase_milestones: string[];
  friendly_name?: string;
  description?: string;
}

interface ClientInfo {
  id: string;
  name: string;
  logo_url?: string;
  kind?: "external" | "internal";
}

interface ProjectAppStat {
  project_id: string;
  total: number;
  hatCounts: Record<string, number>;
}

interface OpeningStats {
  projects_open_applications: number;
  projects_coming_soon: number;
  projects_live: number;
  projects_previously_completed: number;
}

interface PublicOpeningsResponse {
  projects: OpenProject[];
  clients: ClientInfo[];
  applicationStats: ProjectAppStat[];
  stats: OpeningStats;
}

interface EnrichedProject extends OpenProject {
  clientName: string;
  clientLogoUrl?: string;
  clientKind: "external" | "internal";
  totalApps: number;
  hatCounts: Record<string, number>;
  userApplied: boolean;
}

export default function ProjectOpeningsPage() {
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const navigate = useNavigate();
  const [view, setView] = useState<"card" | "table">("card");

  const { data: publicData, isLoading: projLoading } = useQuery({
    queryKey: ["public-project-openings"],
    queryFn: async () => {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(`${supabaseUrl}/functions/v1/public-project-openings`, {
        headers: { apikey: anonKey, "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("Failed to load project openings.");
      return response.json() as Promise<PublicOpeningsResponse>;
    },
  });

  const projects = publicData?.projects ?? [];
  const clients = publicData?.clients ?? [];
  const appStats = publicData?.applicationStats ?? [];
  const stats = publicData?.stats ?? null;

  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const statsMap = useMemo(() => {
    const map = new Map<string, { total: number; hatCounts: Record<string, number> }>();
    for (const stat of appStats) {
      map.set(stat.project_id, { total: stat.total, hatCounts: stat.hatCounts ?? {} });
    }
    return map;
  }, [appStats]);

  const { data: myProjectApps = [] } = useQuery({
    queryKey: ["my-project-apps-for-openings", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_applications")
        .select("id, project_id, status")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const appliedProjectIds = useMemo(
    () => new Set(myProjectApps.map((a) => a.project_id)),
    [myProjectApps]
  );

  const enrichedProjects = useMemo<EnrichedProject[]>(() =>
    projects.map((p) => {
      const stats = statsMap.get(p.id);
      const client = clientMap.get(p.client_id);
      return {
        ...p,
        clientName: client?.name ?? "Client",
        clientLogoUrl: client?.logo_url || undefined,
        clientKind: client?.kind ?? "external",
        totalApps: stats?.total ?? 0,
        hatCounts: stats?.hatCounts ?? {},
        userApplied: appliedProjectIds.has(p.id),
      };
    }),
    [projects, clientMap, statsMap, appliedProjectIds]
  );

  /* ── Partition by client kind ──────────────────────────────── */
  const clientProjects = useMemo(() => enrichedProjects.filter((p) => p.clientKind !== "internal"), [enrichedProjects]);
  const volunteerProjects = useMemo(() => enrichedProjects.filter((p) => p.clientKind === "internal"), [enrichedProjects]);


  const [activeTab, setActiveTab] = useState<"client" | "volunteer">("client");
  const activeProjects = activeTab === "volunteer" ? volunteerProjects : clientProjects;

  /* ── Split active tab into sections ─────────────────────── */
  const comingSoon = useMemo(() => activeProjects.filter((p) => p.project_status === "coming_soon"), [activeProjects]);
  const openApplications = useMemo(() => activeProjects.filter((p) => p.project_status === "apply_now"), [activeProjects]);
  const startingSoon = useMemo(() => activeProjects.filter((p) => p.project_status === "recruiting" || p.project_status === "team_onboarding"), [activeProjects]);
  const liveProjects = useMemo(() => activeProjects.filter((p) => p.project_status === "project_in_progress"), [activeProjects]);

  /* ── Per-tab counts for tab badges ──────────────────────── */
  const clientOpenCount = useMemo(() => clientProjects.filter((p) => p.project_status === "apply_now").length, [clientProjects]);
  const volunteerOpenCount = useMemo(() => volunteerProjects.filter((p) => p.project_status === "apply_now").length, [volunteerProjects]);

  /* ── Per-tab stats (replace global edge stats) ──────────── */
  const tabStats: OpeningStats = useMemo(() => ({
    projects_open_applications: openApplications.length,
    projects_coming_soon: activeProjects.filter((p) => ["coming_soon", "recruiting", "team_onboarding"].includes(p.project_status)).length,
    projects_live: liveProjects.length,
    projects_previously_completed: 0,
  }), [openApplications, activeProjects, liveProjects]);


  const typeLabel = (v: string) => PROJECT_TYPES.find((t) => t.value === v)?.label ?? v;
  const phaseLabel = (v: string) => PROJECT_PHASES.find((p) => p.value === v)?.label ?? v;
  const statusLabel = (v: string) => PROJECT_STATUSES.find((s) => s.value === v)?.label ?? v;
  const statusClass = (v: string) =>
    v === "apply_now"
      ? "bg-success/10 text-success border-success/20"
      : v === "coming_soon"
        ? "bg-warning/10 text-warning border-warning/20"
        : v === "project_in_progress"
          ? "bg-primary/10 text-primary border-primary/20"
          : "bg-info/10 text-info border-info/20";

  const columnDefs = useMemo<ColDef<EnrichedProject>[]>(() => [
    { headerName: "Client", field: "clientName", flex: 2 },
    { headerName: "Project Type", flex: 1, valueGetter: (params) => typeLabel(params.data?.project_type ?? "") },
    { headerName: "Phase", flex: 1, valueGetter: (params) => phaseLabel(params.data?.phase ?? "") },
    { headerName: "Status", flex: 1, valueGetter: (params) => statusLabel(params.data?.project_status ?? "") },
    {
      headerName: "Your Status",
      flex: 1,
      minWidth: 110,
      valueGetter: (params) => params.data?.userApplied ? "Applied" : "Not Applied",
      cellStyle: (params) => ({
        color: params.value === "Applied" ? "hsl(var(--primary))" : undefined,
        fontWeight: params.value === "Applied" ? 600 : undefined,
      }),
    },
    { headerName: "Team Hats", flex: 2, valueGetter: (params) => (params.data?.team_hats ?? []).join(", ") },
    { headerName: "Applications", field: "totalApps", flex: 0.8, minWidth: 110 },
    ...TEAM_HATS.map((hat) => ({
      headerName: hat,
      flex: 0.7,
      minWidth: 90,
      valueGetter: (params: { data?: EnrichedProject }) => params.data?.hatCounts[hat] ?? 0,
    } as ColDef<EnrichedProject>)),
  ], [clientMap]);



  return (
    <div className="container-app py-8 sm:py-12">
      <SEO
        title="Project Openings — Practice with Real Teams"
        description="Browse open project opportunities at Tech Fleet. Apply to gain real-world experience and grow your skills."
        canonicalPath="/project-openings"
      />
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Project Openings</h1>
        <p className="text-muted-foreground mt-1">
          Browse current openings for client project training and volunteer teams.
        </p>
      </div>

      {/* Stats Cards (per active tab) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
        <div className="card-elevated p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-success/10 flex items-center justify-center flex-shrink-0">
            <Briefcase className="h-5 w-5 text-success" aria-hidden="true" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground leading-tight">{tabStats.projects_open_applications}</p>
            <p className="text-xs text-muted-foreground">Open Applications</p>
          </div>
        </div>
        <div className="card-elevated p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-warning/10 flex items-center justify-center flex-shrink-0">
            <Clock className="h-5 w-5 text-warning" aria-hidden="true" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground leading-tight">{tabStats.projects_coming_soon}</p>
            <p className="text-xs text-muted-foreground">Opening Soon</p>
          </div>
        </div>
        <div className="card-elevated p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-info/10 flex items-center justify-center flex-shrink-0">
            <Rocket className="h-5 w-5 text-info" aria-hidden="true" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground leading-tight">{startingSoon.length}</p>
            <p className="text-xs text-muted-foreground">Starting Soon</p>
          </div>
        </div>
        <div className="card-elevated p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <PlayCircle className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground leading-tight">{tabStats.projects_live}</p>
            <p className="text-xs text-muted-foreground">Live</p>
          </div>
        </div>
        <div className="card-elevated p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground leading-tight">{tabStats.projects_previously_completed}</p>
            <p className="text-xs text-muted-foreground">Previously Completed</p>
          </div>
        </div>
      </div>


      <ProjectOpeningsTabs
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        clientOpenCount={clientOpenCount}
        volunteerOpenCount={volunteerOpenCount}
        activeProjects={activeProjects}
        openApplications={openApplications}
        comingSoon={comingSoon}
        startingSoon={startingSoon}
        liveProjects={liveProjects}
        projLoading={projLoading}
        view={view}
        setView={setView}
        navigate={navigate}
        isAdmin={isAdmin}
        columnDefs={columnDefs}
        typeLabel={typeLabel}
        phaseLabel={phaseLabel}
        statusLabel={statusLabel}
        statusClass={statusClass}
      />


    </div>
  );
}

function ProjectSection({ icon: Icon, items, emptyText, navigate, typeLabel, phaseLabel, statusLabel, statusClass }: { icon: React.ElementType; items: EnrichedProject[]; emptyText: string; navigate: (path: string) => void; typeLabel: (v: string) => string; phaseLabel: (v: string) => string; statusLabel: (v: string) => string; statusClass: (v: string) => string }) {
  if (items.length === 0) return (
    <div className="rounded-lg border bg-card p-6 text-center">
      <Icon className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
      <p className="text-sm text-muted-foreground">{emptyText}</p>
    </div>
  );
  return (
    <div className="grid grid-cols-12 gap-4">
      {items.map((p) => (
        <div key={p.id} className="col-span-12 xl:col-span-6">
          <Card className="flex flex-col h-full cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/project-openings/${p.id}${p.clientKind === "internal" ? "?from=volunteer" : ""}`)}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  {p.clientLogoUrl ? (
                    <img src={p.clientLogoUrl} alt={`${p.clientName} logo`} width={40} height={40} loading="lazy" decoding="async" className="h-10 w-10 rounded-lg object-cover border border-border flex-shrink-0" />
                  ) : (
                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <Handshake className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <ProjectOpeningHeading
                      clientName={p.clientName}
                      friendlyName={p.friendly_name}
                      size="lg"
                      as="h3"
                      truncate
                    />
                    <p className="text-sm text-muted-foreground mt-1">{typeLabel(p.project_type)}</p>
                  </div>
                </div>
                <Badge className={`${statusClass(p.project_status)} shrink-0`}>{statusLabel(p.project_status)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex-1 space-y-3 text-sm">
              <div>
                <p className="text-sm font-semibold text-muted-foreground mb-1">Your Status</p>
                {p.userApplied ? (
                  <Badge className="bg-primary/10 text-primary border-primary/20 text-xs gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Applied
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">Not Applied</Badge>
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-muted-foreground mb-1">Phase</p>
                <Badge variant="secondary" className="text-xs">{phaseLabel(p.phase)}</Badge>
              </div>
              <div>
                <p className="text-sm font-semibold text-muted-foreground mb-1">Team Hats</p>
                <div className="flex flex-wrap gap-1">
                  {p.team_hats.map((h) => <Badge key={h} variant="outline" className="text-xs">{h}</Badge>)}
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-muted-foreground mb-1">Total Applications</p>
                <p className="text-xs text-foreground pl-3 font-medium">{p.totalApps}</p>
              </div>
              {p.team_hats.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-muted-foreground mb-1">Applications by Team Hat</p>
                  <div className="space-y-0.5 pl-3">
                    {p.team_hats.map((hat) => (
                      <p key={hat} className="text-xs text-muted-foreground">
                        <span className="text-foreground font-medium">{p.hatCounts[hat] ?? 0}</span> — {hat}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="pt-3 border-t">
              <Button variant="outline" className="w-full gap-2" onClick={(e) => { e.stopPropagation(); navigate(`/project-openings/${p.id}${p.clientKind === "internal" ? "?from=volunteer" : ""}`); }}>
                <Eye className="h-4 w-4" /> View
              </Button>
            </CardFooter>
          </Card>
        </div>
      ))}
    </div>
  );
}

interface OpeningsTabsProps {
  activeTab: "client" | "volunteer";
  setActiveTab: (v: "client" | "volunteer") => void;
  clientOpenCount: number;
  volunteerOpenCount: number;
  activeProjects: EnrichedProject[];
  openApplications: EnrichedProject[];
  comingSoon: EnrichedProject[];
  startingSoon: EnrichedProject[];
  liveProjects: EnrichedProject[];
  projLoading: boolean;
  view: "card" | "table";
  setView: (v: "card" | "table") => void;
  navigate: (path: string) => void;
  isAdmin: boolean;
  columnDefs: ColDef<EnrichedProject>[];
  typeLabel: (v: string) => string;
  phaseLabel: (v: string) => string;
  statusLabel: (v: string) => string;
  statusClass: (v: string) => string;
}

function ProjectOpeningsTabs(props: OpeningsTabsProps) {
  const {
    activeTab, setActiveTab, clientOpenCount, volunteerOpenCount,
    activeProjects, openApplications, comingSoon, startingSoon, liveProjects,
    projLoading, view, setView, navigate, isAdmin, columnDefs,
    typeLabel, phaseLabel, statusLabel, statusClass,
  } = props;

  const countBadge = (count: number) => (
    <span className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-bold text-primary-foreground ${count > 0 ? "bg-primary" : "bg-muted-foreground"}`}>
      {count}
    </span>
  );

  const tabs: TabItem[] = [
    { value: "client", label: <span className="flex items-center gap-2">Client Project Openings {countBadge(clientOpenCount)}</span> },
    { value: "volunteer", label: <span className="flex items-center gap-2">Volunteer Openings {countBadge(volunteerOpenCount)}</span> },
  ];

  const emptyCopy = activeTab === "volunteer"
    ? {
        title: "No Volunteer Openings Right Now",
        body: "There are no volunteer team openings currently available. Check back soon or visit the guide for more details.",
        url: "https://guide.techfleet.org/training-openings/current-and-upcoming-program-openings/volunteer-project-openings",
      }
    : {
        title: "No Openings Right Now",
        body: "There are no client projects currently available. Check back soon or visit the guide for more details.",
        url: "https://guide.techfleet.org/training-openings/current-and-upcoming-program-openings/project-training-openings",
      };

  const body = (
    <>
      {activeProjects.length > 0 && (
        <div className="flex justify-end mb-4">
          <div className="flex border rounded-md overflow-hidden">
            <Button variant={view === "card" ? "default" : "ghost"} size="sm" onClick={() => setView("card")} aria-label="Card view">
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button variant={view === "table" ? "default" : "ghost"} size="sm" onClick={() => setView("table")} aria-label="Table view">
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {projLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : activeProjects.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <Handshake className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">{emptyCopy.title}</h2>
          <p className="text-muted-foreground max-w-md mx-auto mb-4">{emptyCopy.body}</p>
          <a href={emptyCopy.url} target="_blank" rel="noopener noreferrer">
            <Button variant="outline">
              <ExternalLink className="h-4 w-4 mr-1.5" />View on Guide
            </Button>
          </a>
        </div>
      ) : view === "table" ? (
        <ThemedAgGrid<EnrichedProject>
          gridId={`project-openings-${activeTab}`}
          height="400px"
          rowData={activeProjects}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          onRowClicked={(params) => {
            if (!params.data) return;
            navigate(`/project-openings/${params.data.id}${params.data.clientKind === "internal" ? "?from=volunteer" : ""}`);
          }}
          rowStyle={{ cursor: "pointer" }}
          showExportCsv={isAdmin}
          exportFileName={`project-openings-${activeTab}`}
        />
      ) : (
        <div className="space-y-10">
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">Open Applications</h3>
            <ProjectSection icon={Handshake} items={openApplications} emptyText="No projects are currently accepting applications." navigate={navigate} typeLabel={typeLabel} phaseLabel={phaseLabel} statusLabel={statusLabel} statusClass={statusClass} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">Opening Soon</h3>
            <ProjectSection icon={Clock} items={comingSoon} emptyText="No projects are opening soon." navigate={navigate} typeLabel={typeLabel} phaseLabel={phaseLabel} statusLabel={statusLabel} statusClass={statusClass} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">Starting Soon</h3>
            <ProjectSection icon={Rocket} items={startingSoon} emptyText="No projects are starting soon." navigate={navigate} typeLabel={typeLabel} phaseLabel={phaseLabel} statusLabel={statusLabel} statusClass={statusClass} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">Live Projects</h3>
            <ProjectSection icon={PlayCircle} items={liveProjects} emptyText="No projects are currently in progress." navigate={navigate} typeLabel={typeLabel} phaseLabel={phaseLabel} statusLabel={statusLabel} statusClass={statusClass} />
          </div>
        </div>
      )}
    </>
  );

  return (
    <ResponsiveTabs value={activeTab} onValueChange={(v) => setActiveTab(v as "client" | "volunteer")} className="w-full">
      <ResponsiveTabsList tabs={tabs} value={activeTab} onValueChange={(v) => setActiveTab(v as "client" | "volunteer")} className="mb-6" />
      <ResponsiveTabsContent value="client">{activeTab === "client" && body}</ResponsiveTabsContent>
      <ResponsiveTabsContent value="volunteer">{activeTab === "volunteer" && body}</ResponsiveTabsContent>
    </ResponsiveTabs>
  );
}

