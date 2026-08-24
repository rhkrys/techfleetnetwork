import { useState, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import {
  LayoutGrid,
  LayoutList,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Badge, Button, Card, CardContent } from "@/design-system";

import { PROJECT_TYPES, PROJECT_PHASES, PROJECT_STATUSES } from "@/data/project-constants";
import { ThemedAgGrid } from "@/components/AgGrid";
import {
  AllApplicationsColumnPicker,
  ALL_COLUMNS,
  DEFAULT_VISIBLE_KEYS,
} from "@/components/admin/AllApplicationsColumnPicker";
import type { ColDef, GridReadyEvent, GridApi, ICellRendererParams } from "ag-grid-community";
import { ClientLogo } from "@/components/ClientLogo";
import { ProjectOpeningHeading } from "@/components/projects/ProjectOpeningHeading";

interface ProjectApp {
  id: string;
  user_id: string;
  project_id: string;
  status: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  current_step: number;
  participated_previous_phase: boolean;
  team_hats_interest: string[];
  passion_for_project: string;
  client_project_knowledge: string;
  project_success_contribution: string;
  cross_functional_contribution: string;
  prior_engagement_preparation: string;
  previous_phase_position: string;
  previous_phase_learnings: string;
  previous_phase_help_teammates: string;
}

interface GeneralApp {
  id: string;
  user_id: string;
  email: string;
  title: string;
  status: string;
  current_section: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  linkedin_url: string;
  portfolio_url: string;
  hours_commitment: string;
  about_yourself: string;
  previous_engagement: string;
  previous_engagement_ways: string[];
  agile_philosophies: string;
  agile_vs_waterfall: string;
  collaboration_challenges: string;
  teammate_learnings: string;
  psychological_safety: string;
  service_leadership_definition: string;
  service_leadership_situation: string;
  service_leadership_actions: string;
  service_leadership_challenges: string;
}

interface ProjectRow {
  id: string;
  project_type: string;
  phase: string;
  project_status: string;
  client_id: string;
  friendly_name?: string | null;
}

interface ClientRow {
  id: string;
  name: string;
  logo_url?: string | null;
}

interface ProfileRow {
  user_id: string;
  display_name: string;
  first_name: string;
  last_name: string;
  email: string;
  country: string;
  timezone: string;
  discord_username: string;
  linkedin_url: string;
  portfolio_url: string;
  experience_areas: string[];
  education_background: string[];
  professional_goals: string;
  professional_background: string;
  bio: string;
  interests: string[];
}

interface EnrichedApp extends ProjectApp {
  project?: ProjectRow;
  client?: ClientRow;
  profile?: ProfileRow;
  generalApp?: GeneralApp;
  /** How many apply_now projects this user applied to */
  userApplyNowCount: number;
  /** Total number of projects currently accepting applications */
  totalApplyNowProjects: number;
  completedCoreCourses: number;
}

const CORE_COURSE_PHASES = [
  "first_steps",
  "second_steps",
  "discord_learning",
  "third_steps",
  "project_training",
  "volunteer",
] as const;
const REQUIRED_CORE_COURSES = CORE_COURSE_PHASES.length;

const typeLabel = (v: string) => PROJECT_TYPES.find((t) => t.value === v)?.label ?? v;
const phaseLabel = (v: string) => PROJECT_PHASES.find((p) => p.value === v)?.label ?? v;
const statusLabel = (v: string) => PROJECT_STATUSES.find((s) => s.value === v)?.label ?? v;
const truncate = (v: string, n = 100) => (v && v.length > n ? v.slice(0, n) + "…" : v || "—");

export default function SubmittedApplicationsTab() {
  const navigate = useNavigate();
  const [view, setView] = useState<"card" | "table">("table");
  const [visibleKeys, setVisibleKeys] = useState<string[]>([...DEFAULT_VISIBLE_KEYS]);
  const gridApiRef = useRef<GridApi<EnrichedApp> | null>(null);

  // Fetch project applications
  const { data: apps, isLoading: appsLoading } = useQuery({
    queryKey: ["admin-submitted-project-apps"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_applications")
        .select("*")
        .eq("status", "completed")
        .order("completed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ProjectApp[];
    },
  });

  // Fetch general applications
  const { data: generalApps } = useQuery({
    queryKey: ["admin-general-apps-for-submitted"],
    queryFn: async () => {
      const { data, error } = await supabase.from("general_applications").select("*");
      if (error) throw error;
      return (data ?? []) as unknown as GeneralApp[];
    },
    enabled: (apps ?? []).length > 0,
  });

  const projectIds = useMemo(() => [...new Set((apps ?? []).map((a) => a.project_id))], [apps]);
  const { data: projects } = useQuery({
    queryKey: ["admin-projects-for-apps", projectIds],
    queryFn: async () => {
      if (projectIds.length === 0) return [];
      const { data, error } = await supabase.from("projects").select("*").in("id", projectIds);
      if (error) throw error;
      return (data ?? []) as unknown as ProjectRow[];
    },
    enabled: projectIds.length > 0,
  });

  const clientIds = useMemo(
    () => [...new Set((projects ?? []).map((p) => p.client_id))],
    [projects]
  );
  const { data: clients } = useQuery({
    queryKey: ["admin-clients-for-apps", clientIds],
    queryFn: async () => {
      if (clientIds.length === 0) return [];
      const { data, error } = await supabase.from("clients").select("*").in("id", clientIds);
      if (error) throw error;
      return (data ?? []) as unknown as ClientRow[];
    },
    enabled: clientIds.length > 0,
  });

  // Fetch total count of projects currently accepting applications
  const { data: allApplyNowProjects } = useQuery({
    queryKey: ["admin-all-apply-now-projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id")
        .eq("project_status", "apply_now");
      if (error) throw error;
      return (data ?? []) as { id: string }[];
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ["admin-profiles-for-apps-full", apps?.map((a) => a.user_id)],
    queryFn: async () => {
      const userIds = [...new Set((apps ?? []).map((a) => a.user_id))];
      if (userIds.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "user_id, display_name, first_name, last_name, email, country, timezone, discord_username, linkedin_url, portfolio_url, experience_areas, education_background, professional_goals, professional_background, bio, interests"
        )
        .in("user_id", userIds);
      if (error) throw error;
      return (data ?? []) as unknown as ProfileRow[];
    },
    enabled: (apps ?? []).length > 0,
  });

  const userIds = useMemo(() => [...new Set((apps ?? []).map((a) => a.user_id))], [apps]);
  const { data: coreProgress = [] } = useQuery({
    queryKey: ["admin-applicant-core-course-progress", userIds],
    queryFn: async () => {
      if (userIds.length === 0) return [];
      const { data, error } = await supabase
        .from("journey_progress")
        .select("user_id, phase, completed")
        .in("user_id", userIds)
        .eq("completed", true);
      if (error) throw error;
      return data ?? [];
    },
    enabled: userIds.length > 0,
  });

  const projectMap = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects]);
  const clientMap = useMemo(() => new Map((clients ?? []).map((c) => [c.id, c])), [clients]);
  const profileMap = useMemo(
    () => new Map((profiles ?? []).map((p) => [p.user_id, p])),
    [profiles]
  );
  const generalAppMap = useMemo(() => {
    const map = new Map<string, GeneralApp>();
    (generalApps ?? []).forEach((g) => map.set(g.user_id, g));
    return map;
  }, [generalApps]);

  const totalApplyNowProjects = (allApplyNowProjects ?? []).length;
  const applyNowProjectIds = useMemo(
    () => new Set((allApplyNowProjects ?? []).map((p) => p.id)),
    [allApplyNowProjects]
  );
  const coreProgressMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    coreProgress.forEach((row) => {
      if (!CORE_COURSE_PHASES.includes(row.phase as (typeof CORE_COURSE_PHASES)[number])) return;
      const phases = map.get(row.user_id) ?? new Set<string>();
      phases.add(row.phase);
      map.set(row.user_id, phases);
    });
    return map;
  }, [coreProgress]);

  const enriched = useMemo<EnrichedApp[]>(() => {
    const items = (apps ?? []).map((a) => {
      const proj = projectMap.get(a.project_id);
      const cli = proj ? clientMap.get(proj.client_id) : undefined;
      const prof = profileMap.get(a.user_id);
      const genApp = generalAppMap.get(a.user_id);
      return { ...a, project: proj, client: cli, profile: prof, generalApp: genApp };
    });
    // Count how many apply_now projects each user applied to
    const userApplyNowCounts = new Map<string, number>();
    for (const item of items) {
      if (applyNowProjectIds.has(item.project_id)) {
        userApplyNowCounts.set(item.user_id, (userApplyNowCounts.get(item.user_id) ?? 0) + 1);
      }
    }
    return items.map((item) => ({
      ...item,
      userApplyNowCount: userApplyNowCounts.get(item.user_id) ?? 0,
      totalApplyNowProjects,
      completedCoreCourses: coreProgressMap.get(item.user_id)?.size ?? 0,
    }));
  }, [
    apps,
    projectMap,
    clientMap,
    profileMap,
    generalAppMap,
    applyNowProjectIds,
    totalApplyNowProjects,
    coreProgressMap,
  ]);

  // Build AG Grid columnDefs mapped by colId to the ALL_COLUMNS keys
  const columnDefs = useMemo<ColDef<EnrichedApp>[]>(() => {
    const defs: ColDef<EnrichedApp>[] = [
      // ── Core ──
      {
        headerName: "Applicant",
        colId: "applicant",
        flex: 2,
        valueGetter: (p) => {
          const pr = p.data?.profile;
          if (!pr) return "Unknown";
          return (
            pr.display_name || `${pr.first_name ?? ""} ${pr.last_name ?? ""}`.trim() || "Unknown"
          );
        },
      },
      {
        headerName: "Email",
        colId: "email",
        flex: 2,
        valueGetter: (p) => p.data?.profile?.email ?? "—",
        hide: !visibleKeys.includes("email"),
      },
      {
        headerName: "Client",
        colId: "client",
        flex: 1,
        valueGetter: (p) => p.data?.client?.name ?? "—",
      },
      {
        headerName: "Project",
        colId: "project_friendly",
        flex: 1,
        valueGetter: (p) => p.data?.project?.friendly_name?.trim() || "—",
        hide: !visibleKeys.includes("project_friendly"),
      },
      {
        headerName: "Project Type",
        colId: "project_type",
        flex: 1,
        valueGetter: (p) => typeLabel(p.data?.project?.project_type ?? ""),
      },
      {
        headerName: "Phase",
        colId: "phase",
        flex: 1,
        valueGetter: (p) => phaseLabel(p.data?.project?.phase ?? ""),
      },
      {
        headerName: "Project Status",
        colId: "project_status",
        flex: 1,
        valueGetter: (p) => statusLabel(p.data?.project?.project_status ?? ""),
      },
      {
        headerName: "Previous Participant?",
        colId: "previous_participant",
        flex: 1,
        minWidth: 120,
        valueGetter: (p) => (p.data?.participated_previous_phase ? "Yes" : "No"),
      },
      {
        headerName: "Core Courses",
        colId: "core_courses_completed",
        flex: 1,
        minWidth: 130,
        valueGetter: (p) => `${p.data?.completedCoreCourses ?? 0} of ${REQUIRED_CORE_COURSES}`,
      },
      {
        headerName: "Active Apps",
        colId: "other_active_apps",
        flex: 1,
        minWidth: 140,
        valueGetter: (p) => p.data?.userApplyNowCount ?? 0,
        valueFormatter: (p) =>
          `${p.data?.userApplyNowCount ?? 0} of ${p.data?.totalApplyNowProjects ?? 0}`,
      },
      {
        headerName: "Date Submitted",
        colId: "date_submitted",
        flex: 1,
        minWidth: 120,
        valueGetter: (p) => p.data?.completed_at,
        valueFormatter: (p) => (p.value ? format(new Date(p.value), "MMM d, yyyy") : "—"),
      },
      {
        headerName: "Team Hats Interest",
        colId: "team_hats_interest",
        flex: 2,
        valueGetter: (p) => (p.data?.team_hats_interest ?? []).join(", "),
      },

      // ── Profile ──
      {
        headerName: "Country",
        colId: "p_country",
        flex: 1,
        valueGetter: (p) => p.data?.profile?.country ?? "—",
      },
      {
        headerName: "Timezone",
        colId: "p_timezone",
        flex: 1,
        valueGetter: (p) => p.data?.profile?.timezone ?? "—",
      },
      {
        headerName: "Discord Username",
        colId: "p_discord",
        flex: 1,
        valueGetter: (p) => p.data?.profile?.discord_username ?? "—",
      },
      {
        headerName: "LinkedIn URL",
        colId: "p_linkedin",
        flex: 2,
        valueGetter: (p) => p.data?.profile?.linkedin_url ?? "—",
      },
      {
        headerName: "Portfolio URL",
        colId: "p_portfolio",
        flex: 2,
        valueGetter: (p) => p.data?.profile?.portfolio_url ?? "—",
      },
      {
        headerName: "Experience Areas",
        colId: "p_experience_areas",
        flex: 2,
        valueGetter: (p) => (p.data?.profile?.experience_areas ?? []).join(", "),
      },
      {
        headerName: "Education Background",
        colId: "p_education",
        flex: 2,
        valueGetter: (p) => (p.data?.profile?.education_background ?? []).join(", "),
      },
      {
        headerName: "Professional Goals",
        colId: "p_goals",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.profile?.professional_goals ?? ""),
      },
      {
        headerName: "Professional Background",
        colId: "p_background",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.profile?.professional_background ?? ""),
      },
      {
        headerName: "Bio",
        colId: "p_bio",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.profile?.bio ?? ""),
      },
      {
        headerName: "Interests",
        colId: "p_interests",
        flex: 2,
        valueGetter: (p) => (p.data?.profile?.interests ?? []).join(", "),
      },

      // ── General Application ──
      {
        headerName: "Hours Commitment",
        colId: "ga_hours_commitment",
        flex: 1,
        valueGetter: (p) => p.data?.generalApp?.hours_commitment ?? "—",
      },
      {
        headerName: "Previous Engagement",
        colId: "ga_previous_engagement",
        flex: 1,
        valueGetter: (p) => p.data?.generalApp?.previous_engagement ?? "—",
      },
      {
        headerName: "Previous Engagement Ways",
        colId: "ga_previous_engagement_ways",
        flex: 2,
        valueGetter: (p) => (p.data?.generalApp?.previous_engagement_ways ?? []).join(", "),
      },
      {
        headerName: "Teammate Learnings",
        colId: "ga_teammate_learnings",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.generalApp?.teammate_learnings ?? ""),
      },
      {
        headerName: "Agile vs Waterfall",
        colId: "ga_agile_vs_waterfall",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.generalApp?.agile_vs_waterfall ?? ""),
      },
      {
        headerName: "Psychological Safety",
        colId: "ga_psychological_safety",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.generalApp?.psychological_safety ?? ""),
      },
      {
        headerName: "Agile Philosophies",
        colId: "ga_agile_philosophies",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.generalApp?.agile_philosophies ?? ""),
      },
      {
        headerName: "Collaboration Challenges",
        colId: "ga_collaboration_challenges",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.generalApp?.collaboration_challenges ?? ""),
      },
      {
        headerName: "Service Leadership Def.",
        colId: "ga_service_leadership_definition",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.generalApp?.service_leadership_definition ?? ""),
      },
      {
        headerName: "Service Leadership Actions",
        colId: "ga_service_leadership_actions",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.generalApp?.service_leadership_actions ?? ""),
      },
      {
        headerName: "Service Leadership Challenges",
        colId: "ga_service_leadership_challenges",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.generalApp?.service_leadership_challenges ?? ""),
      },
      {
        headerName: "Service Leadership Sit.",
        colId: "ga_service_leadership_situation",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.generalApp?.service_leadership_situation ?? ""),
      },
      {
        headerName: "General App Status",
        colId: "ga_status",
        flex: 1,
        valueGetter: (p) => p.data?.generalApp?.status ?? "—",
      },
      {
        headerName: "General App Completed",
        colId: "ga_completed_at",
        flex: 1,
        valueGetter: (p) => p.data?.generalApp?.completed_at,
        valueFormatter: (p) => (p.value ? format(new Date(p.value), "MMM d, yyyy") : "—"),
      },

      // ── Project Application ──
      {
        headerName: "Passion for Project",
        colId: "pa_passion_for_project",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.passion_for_project ?? ""),
      },
      {
        headerName: "Client/Project Knowledge",
        colId: "pa_client_project_knowledge",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.client_project_knowledge ?? ""),
      },
      {
        headerName: "Cross-Functional Contrib.",
        colId: "pa_cross_functional_contribution",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.cross_functional_contribution ?? ""),
      },
      {
        headerName: "Project Success Contrib.",
        colId: "pa_project_success_contribution",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.project_success_contribution ?? ""),
      },
      {
        headerName: "Prior Engagement Prep.",
        colId: "pa_prior_engagement_preparation",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.prior_engagement_preparation ?? ""),
      },
      {
        headerName: "Previous Phase Position",
        colId: "pa_previous_phase_position",
        flex: 1,
        valueGetter: (p) => truncate(p.data?.previous_phase_position ?? ""),
      },
      {
        headerName: "Previous Phase Learnings",
        colId: "pa_previous_phase_learnings",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.previous_phase_learnings ?? ""),
      },
      {
        headerName: "Previous Phase Help",
        colId: "pa_previous_phase_help",
        flex: 2,
        valueGetter: (p) => truncate(p.data?.previous_phase_help_teammates ?? ""),
      },
      {
        headerName: "Actions",
        colId: "actions",
        sortable: false,
        filter: false,
        resizable: false,
        width: 120,
        minWidth: 120,
        maxWidth: 140,
        pinned: "right",
        lockPinned: true,
        cellRenderer: (params: ICellRendererParams<EnrichedApp>) => {
          if (!params.data) return null;
          return (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs h-7"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/admin/applications/${params.data!.id}`);
              }}
            >
              View <ExternalLink className="h-3 w-3" />
            </Button>
          );
        },
      },
    ];

    // Set hide based on visibleKeys
    return defs.map((d) => ({
      ...d,
      hide: d.colId ? !visibleKeys.includes(d.colId) : false,
    }));
  }, [visibleKeys]);

  const handleColumnChange = useCallback((keys: string[]) => {
    setVisibleKeys(keys);
    if (gridApiRef.current) {
      const allColIds = ALL_COLUMNS.map((c) => c.key);
      // Show selected, hide rest
      const toHide = allColIds.filter((k) => !keys.includes(k));
      const toShow = keys;
      gridApiRef.current.setColumnsVisible(toHide, false);
      gridApiRef.current.setColumnsVisible(toShow, true);
      gridApiRef.current.sizeColumnsToFit();
    }
  }, []);

  const handleGridReady = useCallback((e: GridReadyEvent<EnrichedApp>) => {
    gridApiRef.current = e.api;
  }, []);

  if (appsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (enriched.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-lg font-medium">No submitted applications yet</p>
        <p className="text-sm mt-1">Completed project applications will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <div className="flex border rounded-lg overflow-hidden">
          <button
            onClick={() => setView("card")}
            className={`p-2 transition-colors ${view === "card" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
            aria-label="Card view"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView("table")}
            className={`p-2 transition-colors ${view === "table" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
            aria-label="Table view"
          >
            <LayoutList className="h-4 w-4" />
          </button>
        </div>
      </div>

      {view === "card" ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {enriched.map((app) => (
            <Card
              key={app.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate(`/admin/applications/${app.id}`)}
            >
              <CardContent className="pt-5 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {app.profile?.display_name ||
                      `${app.profile?.first_name ?? ""} ${app.profile?.last_name ?? ""}`.trim() ||
                      "Unknown"}
                  </p>
                  <p className="text-xs text-muted-foreground">{app.profile?.email}</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-start gap-2">
                    <ClientLogo url={app.client?.logo_url} name={app.client?.name} size="sm" />
                    <ProjectOpeningHeading
                      clientName={app.client?.name ?? "Unknown Client"}
                      friendlyName={app.project?.friendly_name}
                      size="md"
                      as="p"
                      truncate
                      className="flex-1"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-xs">
                      {typeLabel(app.project?.project_type ?? "")}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {phaseLabel(app.project?.phase ?? "")}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {statusLabel(app.project?.project_status ?? "")}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {app.participated_previous_phase ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Previous Participant
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3.5 w-3.5 text-muted-foreground/60" /> New Participant
                    </>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Core courses:{" "}
                  <span className="font-medium text-foreground">
                    {app.completedCoreCourses} of {REQUIRED_CORE_COURSES}
                  </span>
                </div>
                {app.userApplyNowCount > 0 && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                    <span className="text-warning font-medium">
                      {app.userApplyNowCount} of {app.totalApplyNowProjects} active{" "}
                      {app.totalApplyNowProjects === 1 ? "project" : "projects"}
                    </span>
                  </div>
                )}
                {app.completed_at && (
                  <p className="text-xs text-muted-foreground">
                    Submitted {format(new Date(app.completed_at), "MMM d, yyyy")}
                  </p>
                )}
                <Button variant="outline" size="sm" className="w-full mt-2 gap-1">
                  View Full Application <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <ThemedAgGrid<EnrichedApp>
          gridId="submitted-applications"
          height="500px"
          rowData={enriched}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          onRowClicked={(params) =>
            params.data && navigate(`/admin/applications/${params.data.id}`)
          }
          onGridReady={handleGridReady}
          rowStyle={{ cursor: "pointer" }}
          pagination
          paginationPageSize={25}
          toolbarLeft={
            <AllApplicationsColumnPicker visibleKeys={visibleKeys} onChange={handleColumnChange} />
          }
          hideColumnsPicker
          exportFileName="applications-export"
        />
      )}
    </div>
  );
}
