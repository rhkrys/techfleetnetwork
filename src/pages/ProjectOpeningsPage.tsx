import { useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/use-admin";
import { SEO } from "@/components/SEO";
import { LayoutGrid, List, Loader2 } from "lucide-react";
import { ResponsiveTabs, ResponsiveTabsList, ResponsiveTabsContent, type TabItem } from "@/components/ui/responsive-tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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


  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") === "volunteer" ? "volunteer" : "client";
  const [activeTab, setActiveTabState] = useState<"client" | "volunteer">(initialTab);
  const setActiveTab = (v: "client" | "volunteer") => {
    setActiveTabState(v);
    const next = new URLSearchParams(searchParams);
    if (v === "volunteer") next.set("tab", "volunteer"); else next.delete("tab");
    setSearchParams(next, { replace: true });
  };
  const clientOpenApplications = useMemo(() => clientProjects.filter((p) => p.project_status === "apply_now"), [clientProjects]);
  const clientComingSoon = useMemo(() => clientProjects.filter((p) => p.project_status === "coming_soon"), [clientProjects]);
  const clientStartingSoon = useMemo(() => clientProjects.filter((p) => p.project_status === "recruiting" || p.project_status === "team_onboarding"), [clientProjects]);
  const clientLiveProjects = useMemo(() => clientProjects.filter((p) => p.project_status === "project_in_progress"), [clientProjects]);
  const volunteerOpenApplications = useMemo(() => volunteerProjects.filter((p) => p.project_status === "apply_now"), [volunteerProjects]);
  const volunteerComingSoon = useMemo(() => volunteerProjects.filter((p) => p.project_status === "coming_soon"), [volunteerProjects]);
  const volunteerStartingSoon = useMemo(() => volunteerProjects.filter((p) => p.project_status === "recruiting" || p.project_status === "team_onboarding"), [volunteerProjects]);
  const volunteerLiveProjects = useMemo(() => volunteerProjects.filter((p) => p.project_status === "project_in_progress"), [volunteerProjects]);

  const activeProjects = activeTab === "volunteer" ? volunteerProjects : clientProjects;
  const openApplications = activeTab === "volunteer" ? volunteerOpenApplications : clientOpenApplications;
  const startingSoon = activeTab === "volunteer" ? volunteerStartingSoon : clientStartingSoon;
  const liveProjects = activeTab === "volunteer" ? volunteerLiveProjects : clientLiveProjects;

  /* ── Per-tab counts for tab badges ──────────────────────── */
  const clientOpenCount = clientOpenApplications.length;
  const volunteerOpenCount = volunteerOpenApplications.length;

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

      {/* Stats Cards (per active tab) — iconless, colored accent bar, ≥16px text */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
        {[
          { value: tabStats.projects_open_applications, label: "Open Applications", bar: "bg-success" },
          { value: tabStats.projects_coming_soon, label: "Opening Soon", bar: "bg-warning" },
          { value: startingSoon.length, label: "Starting Soon", bar: "bg-info" },
          { value: tabStats.projects_live, label: "Live", bar: "bg-primary" },
          { value: tabStats.projects_previously_completed, label: "Previously Completed", bar: "bg-muted-foreground" },
        ].map((s) => (
          <div key={s.label} className="card-elevated p-4 flex items-stretch gap-3">
            <div className={`w-1 rounded-full flex-shrink-0 ${s.bar}`} aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-2xl font-bold text-foreground leading-tight">{s.value}</p>
              <p className="text-base text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>



      <ProjectOpeningsTabs
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        clientOpenCount={clientOpenCount}
        volunteerOpenCount={volunteerOpenCount}
        clientContent={{ projects: clientProjects, openApplications: clientOpenApplications, comingSoon: clientComingSoon, startingSoon: clientStartingSoon, liveProjects: clientLiveProjects }}
        volunteerContent={{ projects: volunteerProjects, openApplications: volunteerOpenApplications, comingSoon: volunteerComingSoon, startingSoon: volunteerStartingSoon, liveProjects: volunteerLiveProjects }}
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

function ProjectSection({ items, emptyText, navigate, typeLabel, phaseLabel, statusLabel, statusClass }: { items: EnrichedProject[]; emptyText: string; navigate: (path: string) => void; typeLabel: (v: string) => string; phaseLabel: (v: string) => string; statusLabel: (v: string) => string; statusClass: (v: string) => string }) {
  if (items.length === 0) return (
    <div className="rounded-lg border bg-card p-6">
      <p className="text-base text-muted-foreground">{emptyText}</p>
    </div>
  );

  const sectionLabel = "text-base font-semibold uppercase tracking-wider text-muted-foreground";

  return (
    <div className="grid grid-cols-12 gap-4">
      {items.map((p) => {
        const href = `/project-openings/${p.id}${p.clientKind === "internal" ? "?from=volunteer" : ""}`;
        return (
          <div key={p.id} className="col-span-12 xl:col-span-6">
            <Card
              data-card="project-opening"
              role="link"
              tabIndex={0}
              className="flex flex-col h-full cursor-pointer hover:shadow-md transition-shadow p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => navigate(href)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(href); }
              }}
            >
              {/* Identity block — status, client, project, type */}
              <div className="space-y-3">
                <Badge className={`${statusClass(p.project_status)} px-3 py-1.5 text-base font-semibold uppercase tracking-wide`}>
                  {statusLabel(p.project_status)}
                </Badge>
                <ProjectOpeningHeading
                  clientName={p.clientName}
                  friendlyName={p.friendly_name}
                  size="xl-stacked"
                  as="h3"
                />
                <p className="text-base font-semibold uppercase tracking-wider text-muted-foreground">
                  {typeLabel(p.project_type)}
                </p>
              </div>

              {/* Meta sections */}
              <div className="mt-5 pt-5 border-t space-y-5">
                <div className="space-y-1.5">
                  <p className={sectionLabel}>Phase</p>
                  <p className="text-base text-foreground">{phaseLabel(p.phase)}</p>
                </div>

                {p.team_hats.length > 0 && (
                  <div className="space-y-1.5">
                    <p className={sectionLabel}>Team Hats</p>
                    <div className="flex flex-wrap gap-1.5">
                      {p.team_hats.map((h) => (
                        <Badge key={h} variant="outline" className="text-base font-normal px-2.5 py-0.5">{h}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <p className={sectionLabel}>Your Status</p>
                  <p className={`text-base ${p.userApplied ? "text-primary font-semibold" : "text-foreground"}`}>
                    {p.userApplied ? "Applied" : "Not yet applied"}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <p className={sectionLabel}>Applications</p>
                  <p className="text-base text-foreground">
                    <span className="font-semibold">{p.totalApps}</span> total
                  </p>
                  {p.team_hats.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {p.team_hats.map((hat) => (
                        <li key={hat} className="text-base text-muted-foreground">
                          <span className="text-foreground font-semibold">{p.hatCounts[hat] ?? 0}</span> — {hat}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Footer CTA — full-width primary button, stops card click to avoid double-nav */}
              <div className="mt-5 pt-5 border-t">
                <Button
                  type="button"
                  className="w-full"
                  onClick={(e) => { e.stopPropagation(); navigate(href); }}
                >
                  View opening
                </Button>
              </div>
            </Card>
          </div>
        );
      })}
    </div>
  );
}


interface OpeningsTabsProps {
  activeTab: "client" | "volunteer";
  setActiveTab: (v: "client" | "volunteer") => void;
  clientOpenCount: number;
  volunteerOpenCount: number;
  clientContent: OpeningsTabContentData;
  volunteerContent: OpeningsTabContentData;
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

interface OpeningsTabContentData {
  projects: EnrichedProject[];
  openApplications: EnrichedProject[];
  comingSoon: EnrichedProject[];
  startingSoon: EnrichedProject[];
  liveProjects: EnrichedProject[];
}

function OpeningsTabContent({ tab, content, emptyCopy, projLoading, view, setView, navigate, isAdmin, columnDefs, typeLabel, phaseLabel, statusLabel, statusClass }: {
  tab: "client" | "volunteer";
  content: OpeningsTabContentData;
  emptyCopy: { title: string; body: string; url: string };
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
}) {
  if (projLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (content.projects.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8">
        <h2 className="text-xl font-bold text-foreground mb-2">{emptyCopy.title}</h2>
        <p className="text-base text-muted-foreground max-w-md mb-4">{emptyCopy.body}</p>
        <a href={emptyCopy.url} target="_blank" rel="noopener noreferrer">
          <Button variant="outline">View on Guide</Button>
        </a>
      </div>
    );
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <div className="flex border rounded-md overflow-hidden">
          <Button variant={view === "card" ? "default" : "ghost"} size="sm" onClick={() => setView("card")} aria-label="Card view"><LayoutGrid className="h-4 w-4" /></Button>
          <Button variant={view === "table" ? "default" : "ghost"} size="sm" onClick={() => setView("table")} aria-label="Table view"><List className="h-4 w-4" /></Button>
        </div>
      </div>
      {view === "table" ? (
        <ThemedAgGrid<EnrichedProject>
          gridId={`project-openings-${tab}`}
          height="400px"
          rowData={content.projects}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          onRowClicked={(params) => params.data && navigate(`/project-openings/${params.data.id}${params.data.clientKind === "internal" ? "?from=volunteer" : ""}`)}
          rowStyle={{ cursor: "pointer" }}
          showExportCsv={isAdmin}
          exportFileName={`project-openings-${tab}`}
        />
      ) : (
        <div className="space-y-10">
          <div><h3 className="text-xl font-bold text-foreground mb-4">Open Applications</h3><ProjectSection items={content.openApplications} emptyText="No projects are currently accepting applications." navigate={navigate} typeLabel={typeLabel} phaseLabel={phaseLabel} statusLabel={statusLabel} statusClass={statusClass} /></div>
          <div><h3 className="text-xl font-bold text-foreground mb-4">Opening Soon</h3><ProjectSection items={content.comingSoon} emptyText="No projects are opening soon." navigate={navigate} typeLabel={typeLabel} phaseLabel={phaseLabel} statusLabel={statusLabel} statusClass={statusClass} /></div>
          <div><h3 className="text-xl font-bold text-foreground mb-4">Starting Soon</h3><ProjectSection items={content.startingSoon} emptyText="No projects are starting soon." navigate={navigate} typeLabel={typeLabel} phaseLabel={phaseLabel} statusLabel={statusLabel} statusClass={statusClass} /></div>
          <div><h3 className="text-xl font-bold text-foreground mb-4">Live Projects</h3><ProjectSection items={content.liveProjects} emptyText="No projects are currently in progress." navigate={navigate} typeLabel={typeLabel} phaseLabel={phaseLabel} statusLabel={statusLabel} statusClass={statusClass} /></div>
        </div>
      )}
    </>
  );

}

function ProjectOpeningsTabs(props: OpeningsTabsProps) {
  const {
    activeTab, setActiveTab, clientOpenCount, volunteerOpenCount,
    clientContent, volunteerContent,
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

  return (
    <ResponsiveTabs value={activeTab} onValueChange={(v) => setActiveTab(v as "client" | "volunteer")} className="w-full">
      <ResponsiveTabsList tabs={tabs} value={activeTab} onValueChange={(v) => setActiveTab(v as "client" | "volunteer")} className="mb-6" />
      <ResponsiveTabsContent value="client">
        {activeTab === "client" && (
          <OpeningsTabContent
            tab="client"
            content={clientContent}
            emptyCopy={{ title: "No Openings Right Now", body: "There are no client projects currently available. Check back soon or visit the guide for more details.", url: "https://guide.techfleet.org/training-openings/current-and-upcoming-program-openings/project-training-openings" }}
            {...{ projLoading, view, setView, navigate, isAdmin, columnDefs, typeLabel, phaseLabel, statusLabel, statusClass }}
          />
        )}
      </ResponsiveTabsContent>
      <ResponsiveTabsContent value="volunteer">
        {activeTab === "volunteer" && (
          <OpeningsTabContent
            tab="volunteer"
            content={volunteerContent}
            emptyCopy={{ title: "No Volunteer Openings Right Now", body: "There are no volunteer team openings currently available. Check back soon or visit the guide for more details.", url: "https://guide.techfleet.org/training-openings/current-and-upcoming-program-openings/volunteer-project-openings" }}
            {...{ projLoading, view, setView, navigate, isAdmin, columnDefs, typeLabel, phaseLabel, statusLabel, statusClass }}
          />
        )}
      </ResponsiveTabsContent>
    </ResponsiveTabs>
  );
}

