import { useMemo, useState } from "react";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import {
  Loader2,
  Building2,
  ExternalLink,
  Briefcase,
  Users,
  FileText,
  Lightbulb,
  ClipboardList,
  Target,
  Clock,
  Link2,
  Trophy,
  Sparkles,
  ArrowLeft,
  LogOut,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PROJECT_TYPES, PROJECT_PHASES, PROJECT_STATUSES } from "@/data/project-constants";
import { FolderKanban } from "lucide-react";
import { SectionEmptyState } from "@/components/SectionEmptyState";
import { SafeExternalLink, getSafeLinkHostname } from "@/components/security/SafeExternalLink";
import { ProjectOpeningHeading } from "@/components/projects/ProjectOpeningHeading";
import { HandoffPanel } from "@/components/HandoffPanel";
import { useAdmin } from "@/hooks/use-admin";

/* ── Label helpers ───────────────────────────────────────── */
const typeLabel = (v: string) => PROJECT_TYPES.find((t) => t.value === v)?.label ?? v;
const phaseLabel = (v: string) => PROJECT_PHASES.find((p) => p.value === v)?.label ?? v;
const statusLabel = (v: string) => PROJECT_STATUSES.find((s) => s.value === v)?.label ?? v;

/* ── Pill list ───────────────────────────────────────────── */
function PillList({
  items,
  variant = "outline",
}: {
  items: string[];
  variant?: "outline" | "secondary";
}) {
  if (!items.length) return <p className="text-sm text-muted-foreground italic">None specified</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Badge key={item} variant={variant} className="text-xs">
          {item}
        </Badge>
      ))}
    </div>
  );
}

/* ── Info Section ────────────────────────────────────────── */
function InfoSection({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <div className="text-sm text-muted-foreground">
        {value || <span className="italic">Not provided</span>}
      </div>
    </div>
  );
}

/* ── Types ───────────────────────────────────────────────── */
interface ProjectData {
  id: string;
  project_type: string;
  phase: string;
  project_status: string;
  team_hats: string[];
  current_phase_milestones: string[];
  timezone_range: string;
  anticipated_start_date: string | null;
  anticipated_end_date: string | null;
  // Operational links are fetched separately via roster-gated RPC.
  client_intake_url?: string | null;
  notion_repository_url?: string | null;
  created_at: string;
  friendly_name?: string;
  description?: string;
  clients: {
    name: string;
    website: string;
    mission: string;
    project_summary: string;
    primary_contact: string;
    kind?: "external" | "internal";
  } | null;
}

interface ProjectWithStatus extends ProjectData {
  applicant_status: string;
}

/* ── Project Summary Card (clickable) ────────────────────── */
function ProjectSummaryCard({
  project,
  onClick,
}: {
  project: ProjectWithStatus;
  onClick: () => void;
}) {
  const client = project.clients;
  const isActive = project.applicant_status === "active_participant";

  return (
    <button
      type="button"
      onClick={onClick}
      className="card-elevated p-5 w-full text-left transition-all duration-200 hover:border-primary/50 hover:shadow-md hover:shadow-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
      aria-label={`View details for ${client?.name ?? "Project"}`}
    >
      <div className="flex items-center gap-4">
        <div
          className={`h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
            isActive ? "bg-primary/10" : "bg-muted"
          }`}
        >
          {isActive ? (
            <Trophy className="h-6 w-6 text-primary" aria-hidden="true" />
          ) : (
            <LogOut className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <ProjectOpeningHeading
              clientName={client?.name}
              friendlyName={project.friendly_name}
              size="md"
              as="h3"
              truncate
              className="flex-1"
            />
            {isActive ? (
              <Badge className="bg-success/10 text-success border-success/30 gap-1 text-xs">
                <Sparkles className="h-3 w-3" /> Active Teammate
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 text-xs">
                <LogOut className="h-3 w-3" /> Left the Team
              </Badge>
            )}
            {client?.kind === "internal" && (
              <Badge className="bg-info/10 text-info border-info/30 text-xs">
                Volunteer Opening
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {typeLabel(project.project_type)} · {phaseLabel(project.phase)}
          </p>
          {project.description?.trim() ? (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{project.description}</p>
          ) : client?.project_summary ? (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
              {client.project_summary}
            </p>
          ) : null}
        </div>
        <ArrowLeft
          className="h-5 w-5 text-muted-foreground rotate-180 flex-shrink-0"
          aria-hidden="true"
        />
      </div>
    </button>
  );
}

/* ── Active Project Detail View ──────────────────────────── */
function ActiveProjectDetail({
  project,
  onBack,
}: {
  project: ProjectWithStatus;
  onBack: () => void;
}) {
  const client = project.clients;
  const isActive = project.applicant_status === "active_participant";
  const { isAdmin } = useAdmin();
  // Hand-off production is available to active teammates on the project AND to admins.
  const canUseHandoff = isActive || isAdmin;

  const { data: milestoneData } = useQuery({
    queryKey: ["milestone-data", project.current_phase_milestones],
    queryFn: async () => {
      if (!project.current_phase_milestones.length) {
        return { deliverables: [], activities: [], skills: [] };
      }
      const { data } = await supabase
        .from("milestone_reference")
        .select("deliverables, activities, skills")
        .in("milestone_name", project.current_phase_milestones);

      const deliverables = [...new Set((data ?? []).flatMap((m) => m.deliverables))];
      const activities = [...new Set((data ?? []).flatMap((m) => m.activities))];
      const skills = [...new Set((data ?? []).flatMap((m) => m.skills))];
      return { deliverables, activities, skills };
    },
    staleTime: 5 * 60 * 1000,
  });

  // Operational links require a roster-gated RPC because column SELECT was
  // revoked from authenticated for security. As of the 2026-05-30 refactor,
  // get_project_internal_links returns an empty rowset (instead of raising
  // 42501) when the caller isn't on the roster, so the client no longer needs
  // to swallow a permission-denied error.
  const { data: links } = useQuery({
    queryKey: ["project-internal-links", project.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_project_internal_links", {
        p_project_id: project.id,
      });
      if (error) throw error;
      return (data?.[0] ?? null) as {
        client_intake_url: string | null;
        notion_repository_url: string | null;
      } | null;
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const clientIntakeUrl = links?.client_intake_url ?? "";
  const notionRepoUrl = links?.notion_repository_url ?? "";

  const hasDateRange = project.anticipated_start_date || project.anticipated_end_date;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-2 -ml-2">
        <ArrowLeft className="h-4 w-4" />
        Back to My Projects
      </Button>

      {/* Hero */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Trophy className="h-6 w-6 text-primary" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <div className="flex items-start gap-2 flex-wrap">
                <ProjectOpeningHeading
                  clientName={client?.name}
                  friendlyName={project.friendly_name}
                  size="lg"
                  as="h2"
                />
                {isActive ? (
                  <Badge className="bg-success/10 text-success border-success/30 gap-1">
                    <Sparkles className="h-3 w-3" /> Active Teammate
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="gap-1">
                    <LogOut className="h-3 w-3" /> Left the Team
                  </Badge>
                )}
                {client?.kind === "internal" && (
                  <Badge className="bg-info/10 text-info border-info/30">Volunteer Opening</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {typeLabel(project.project_type)} · {phaseLabel(project.phase)}
              </p>
            </div>
          </div>
          {project.description?.trim() ? (
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {project.description}
            </p>
          ) : client?.project_summary ? (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {client.project_summary}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Client Info */}
      {client && (
        <InfoSection icon={Building2} title="About the Client">
          <DetailRow label="Organization" value={client.name} />
          {client.mission && (
            <DetailRow
              label="Mission"
              value={<p className="whitespace-pre-wrap leading-relaxed">{client.mission}</p>}
            />
          )}
          {client.website && (
            <DetailRow
              label="Website"
              value={
                <a
                  href={
                    client.website.startsWith("http") ? client.website : `https://${client.website}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  {client.website}
                  <ExternalLink className="h-3 w-3" />
                </a>
              }
            />
          )}
          {client.primary_contact && (
            <DetailRow label="Primary Contact" value={client.primary_contact} />
          )}
        </InfoSection>
      )}

      {/* Project Details */}
      <InfoSection icon={Briefcase} title="Project Details">
        <div className="grid sm:grid-cols-2 gap-4">
          <DetailRow label="Project Type" value={typeLabel(project.project_type)} />
          <DetailRow label="Current Phase" value={phaseLabel(project.phase)} />
          <DetailRow label="Status" value={statusLabel(project.project_status)} />
          <DetailRow label="Posted" value={format(new Date(project.created_at), "MMMM d, yyyy")} />
        </div>
      </InfoSection>

      {/* Schedule */}
      {(project.timezone_range || hasDateRange) && (
        <InfoSection icon={Clock} title="Schedule & Timezone">
          <div className="grid sm:grid-cols-2 gap-4">
            {project.timezone_range && (
              <DetailRow label="Timezone Range" value={project.timezone_range} />
            )}
            {project.anticipated_start_date && (
              <DetailRow
                label="Anticipated Start"
                value={format(
                  new Date(project.anticipated_start_date + "T00:00:00"),
                  "MMMM d, yyyy"
                )}
              />
            )}
            {project.anticipated_end_date && (
              <DetailRow
                label="Anticipated End"
                value={format(new Date(project.anticipated_end_date + "T00:00:00"), "MMMM d, yyyy")}
              />
            )}
          </div>
        </InfoSection>
      )}

      {/* External Links */}
      {(clientIntakeUrl || notionRepoUrl) && (
        <InfoSection icon={Link2} title="External Links">
          <div className="grid sm:grid-cols-2 gap-4">
            {clientIntakeUrl && (
              <DetailRow
                label="Client Intake"
                value={
                  <SafeExternalLink
                    href={clientIntakeUrl}
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    {getSafeLinkHostname(clientIntakeUrl) ?? "Unavailable"}
                    <ExternalLink className="h-3 w-3" />
                  </SafeExternalLink>
                }
              />
            )}
            {notionRepoUrl && (
              <DetailRow
                label="Project Repository (Notion)"
                value={
                  <SafeExternalLink
                    href={notionRepoUrl}
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    {getSafeLinkHostname(notionRepoUrl) ?? "Unavailable"}
                    <ExternalLink className="h-3 w-3" />
                  </SafeExternalLink>
                }
              />
            )}
          </div>
        </InfoSection>
      )}

      {/* Team Hats */}
      <InfoSection icon={Users} title="Team Hats (Roles)">
        <PillList items={project.team_hats} variant="secondary" />
      </InfoSection>

      {/* Milestones */}
      {project.current_phase_milestones.length > 0 && (
        <InfoSection icon={Target} title="Current Phase Milestones">
          <PillList items={project.current_phase_milestones} variant="secondary" />
        </InfoSection>
      )}

      {/* Deliverables */}
      {(milestoneData?.deliverables?.length ?? 0) > 0 && (
        <InfoSection icon={FileText} title="Deliverables">
          <p className="text-sm text-muted-foreground">
            Key outputs your team will produce during this phase.
          </p>
          <PillList items={milestoneData!.deliverables} />
        </InfoSection>
      )}

      {/* Activities */}
      {(milestoneData?.activities?.length ?? 0) > 0 && (
        <InfoSection icon={ClipboardList} title="Activities">
          <p className="text-sm text-muted-foreground">
            Core activities your team engages in during this phase.
          </p>
          <PillList items={milestoneData!.activities} />
        </InfoSection>
      )}

      {/* Skills */}
      {(milestoneData?.skills?.length ?? 0) > 0 && (
        <InfoSection icon={Lightbulb} title="Skills You're Developing">
          <p className="text-sm text-muted-foreground">
            Skills and competencies you're building on this project.
          </p>
          <PillList items={milestoneData!.skills} />
        </InfoSection>
      )}

      {/* Hand-Off Production — active teammates on the project, plus admins */}
      {canUseHandoff && <HandoffPanel projectId={project.id} phase={project.phase} />}
    </div>
  );
}

/* ── Main Tab Component ──────────────────────────────────── */
export function MyProjectsTab() {
  const { user } = useAuth();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Fetch applications where user is active or left
  const { data: myApps, isLoading } = useQuery({
    queryKey: ["my-project-apps", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_applications")
        .select("project_id, applicant_status")
        .eq("user_id", user!.id)
        .in("applicant_status", ["active_participant", "left_the_team"]);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const projectIds = useMemo(() => (myApps ?? []).map((a) => a.project_id), [myApps]);
  const statusMap = useMemo(() => {
    const map: Record<string, string> = {};
    (myApps ?? []).forEach((a) => {
      map[a.project_id] = a.applicant_status;
    });
    return map;
  }, [myApps]);

  // Fetch full project details with client info
  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ["my-project-details", projectIds],
    queryFn: async () => {
      if (!projectIds.length) return [];
      const { data, error } = await supabase
        .from("projects")
        .select(
          `
          id, project_type, phase, project_status, team_hats,
          current_phase_milestones, timezone_range,
          anticipated_start_date, anticipated_end_date,
          created_at,
          friendly_name, description,
          clients!projects_client_id_fkey ( name, website, mission, project_summary, primary_contact, kind )
        `
        )
        .in("id", projectIds);
      if (error) throw error;
      return (data ?? []).map((p) => ({
        ...p,
        applicant_status: statusMap[p.id] ?? "active_participant",
      })) as unknown as ProjectWithStatus[];
    },
    enabled: projectIds.length > 0,
  });

  const loading = isLoading || projectsLoading;

  // Detail view
  const selectedProject = projects?.find((p) => p.id === selectedProjectId);
  if (selectedProject) {
    return (
      <ActiveProjectDetail project={selectedProject} onBack={() => setSelectedProjectId(null)} />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!projects?.length) {
    return (
      <SectionEmptyState
        title="No Projects Yet"
        description="Once you're selected as an active teammate on a project, or if you've left a team, it will appear here."
        icon={FolderKanban}
      />
    );
  }

  // Sort: active first, then left
  const sorted = [...projects].sort((a, b) => {
    if (a.applicant_status === "active_participant" && b.applicant_status !== "active_participant")
      return -1;
    if (a.applicant_status !== "active_participant" && b.applicant_status === "active_participant")
      return 1;
    return 0;
  });

  return (
    <div className="space-y-3">
      {sorted.map((project) => (
        <ProjectSummaryCard
          key={project.id}
          project={project}
          onClick={() => setSelectedProjectId(project.id)}
        />
      ))}
    </div>
  );
}
