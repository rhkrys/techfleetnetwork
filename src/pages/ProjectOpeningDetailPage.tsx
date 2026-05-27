import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ReadinessChecklist } from "@/components/ReadinessChecklist";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Loader2, Send, Building2, ExternalLink, Briefcase,
  Users, Share2, CheckCircle2, FileText, Pencil,
  Lightbulb, ClipboardList, Target, Clock, Calendar, Link2,
  ScrollText, ShieldCheck, CalendarClock, UserSearch, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { NavLink } from "@/components/NavLink";
import { ClientLogo } from "@/components/ClientLogo";
import { ProjectOpeningHeading } from "@/components/projects/ProjectOpeningHeading";
import { SafeExternalLink, getSafeLinkHostname } from "@/components/security/SafeExternalLink";
import {
  PROJECT_TYPES, PROJECT_PHASES, PROJECT_STATUSES,
} from "@/data/project-constants";
import { format } from "date-fns";
import { toast } from "sonner";

/* ── Label helpers ───────────────────────────────────────── */
const typeLabel = (v: string) => PROJECT_TYPES.find((t) => t.value === v)?.label ?? v;
const phaseLabel = (v: string) => PROJECT_PHASES.find((p) => p.value === v)?.label ?? v;
const statusLabel = (v: string) => PROJECT_STATUSES.find((s) => s.value === v)?.label ?? v;

/* ── Types ───────────────────────────────────────────────── */
interface ProjectDetail {
  id: string;
  client_id: string;
  project_type: string;
  phase: string;
  project_status: string;
  team_hats: string[];
  current_phase_milestones: string[];
  created_at: string;
  timezone_range?: string;
  anticipated_start_date?: string | null;
  anticipated_end_date?: string | null;
  client_intake_url?: string;
  notion_repository_url?: string;
  coordinator_id?: string | null;
  friendly_name?: string;
  description?: string;
  requires_interview?: boolean;
}

interface ClientDetail {
  id: string;
  name: string;
  website: string;
  mission: string;
  project_summary: string;
  primary_contact: string;
  status: string;
  logo_url?: string | null;
  kind?: "external" | "internal";
}

interface MilestoneData {
  deliverables: string[];
  activities: string[];
  skills: string[];
}

interface ApiResponse {
  project: ProjectDetail;
  client: ClientDetail | null;
  milestoneData: MilestoneData;
  applicationCount: number;
  coordinatorName: string | null;
}

/* ── Pill list component ─────────────────────────────────── */
function PillList({ items, variant = "outline" }: { items: string[]; variant?: "outline" | "secondary" }) {
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

/* ── Section component ───────────────────────────────────── */
function InfoSection({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">{title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <div className="text-sm text-muted-foreground">{value || <span className="italic">Not provided</span>}</div>
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────── */
export default function ProjectOpeningDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromVolunteer = searchParams.get("from") === "volunteer";
  const openingsHref = fromVolunteer ? "/project-openings?tab=volunteer" : "/project-openings";
  const openingsLabel = fromVolunteer ? "Volunteer Openings" : "Project Openings";
  const { user } = useAuth();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    fetch(
      `${supabaseUrl}/functions/v1/public-project-detail?projectId=${encodeURIComponent(projectId)}`,
      {
        headers: {
          "apikey": anonKey,
          "Content-Type": "application/json",
        },
      }
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Failed to load project");
        }
        return res.json();
      })
      .then((d) => setData(d as ApiResponse))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  /* Check if user has already applied to this project */
  const { data: existingApp } = useQuery({
    queryKey: ["user-project-app", user?.id, projectId],
    queryFn: async () => {
      const { data: app } = await supabase
        .from("project_applications")
        .select("id")
        .eq("user_id", user!.id)
        .eq("project_id", projectId!)
        .maybeSingle();
      return app;
    },
    enabled: !!user && !!projectId,
  });

  const hasApplied = !!existingApp;

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/project-openings/${projectId}`;
  }, [projectId]);

  const pageTitle = useMemo(() => {
    if (!data) return "Project Opening | Tech Fleet";
    const clientName = data.client?.name ?? "Project Opening";
    const nick = data.project?.friendly_name?.trim();
    const headline = nick ? `${clientName} — ${nick}` : clientName;
    return `${headline} — ${typeLabel(data.project?.project_type ?? "")} | Tech Fleet`;
  }, [data]);

  useEffect(() => {
    document.title = pageTitle;
    return () => { document.title = "Tech Fleet Network"; };
  }, [pageTitle]);

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied to clipboard!");
    } catch {
      toast.error("We couldn't copy the link. Try again or copy it from the address bar.");
    }
  };

  const applicationPath = `/project-openings/${projectId}/apply`;

  const handleApply = () => {
    if (user) {
      navigate(applicationPath);
    } else {
      toast.info("Sign in to continue your application. We’ll bring you back here afterward.");
      navigate(`/login?redirect=${encodeURIComponent(applicationPath)}`, { state: { from: { pathname: applicationPath } } });
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container-app py-12 text-center space-y-4">
        <p className="text-lg font-medium text-foreground">{error || "Project not found"}</p>
        <p className="text-sm text-muted-foreground">
          This project may no longer be accepting applications.
        </p>
        <Button variant="outline" onClick={() => navigate(user ? "/project-openings" : "/login")}>
          {user ? "Back to Openings" : "Sign In"}
        </Button>
      </div>
    );
  }

  const { project, client, milestoneData, applicationCount, coordinatorName } = data;

  const hasDateRange = project.anticipated_start_date || project.anticipated_end_date;

  return (
    <div className="container-app py-8 sm:py-12 max-w-4xl mx-auto space-y-8">
      {/* ── Breadcrumbs ───────────────────────────────────── */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <NavLink to={user ? openingsHref : `/login?redirect=${encodeURIComponent(openingsHref)}`}>{openingsLabel}</NavLink>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Project Overview</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* ── Hero Header ───────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <ClientLogo url={client?.logo_url} name={client?.name} size="lg" className="mt-1" />
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {client?.kind === "internal" ? (
                <Badge className="bg-info/10 text-info border-info/30">Volunteer Opening</Badge>
              ) : (
                <Badge variant="outline" className="bg-muted text-muted-foreground border-border">Client Project</Badge>
              )}
              <Badge className="bg-success/10 text-success border-success/30 gap-1">
                <CheckCircle2 className="h-3 w-3" /> Accepting Applications
              </Badge>
              <Badge variant="secondary">{typeLabel(project.project_type)}</Badge>
              <Badge variant="outline">{phaseLabel(project.phase)}</Badge>
              {project.requires_interview === false ? (
                <Badge variant="outline" className="bg-muted text-muted-foreground border-border">
                  Selection by application
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                  Interview required
                </Badge>
              )}
            </div>
            <ProjectOpeningHeading
              clientName={client?.name}
              friendlyName={project.friendly_name}
              size="xl"
              as="h1"
            />
            {project.description?.trim() ? (
              <TranslatedContent
                entityTable="projects"
                entityId={project.id}
                columnName="description"
                sourceText={project.description}
                as="p"
                className="text-foreground whitespace-pre-wrap leading-relaxed"
              />
            ) : (
              <p className="text-muted-foreground">
                {client?.project_summary || `${typeLabel(project.project_type)} project — ${phaseLabel(project.phase)}`}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleShare}>
            <Share2 className="h-4 w-4" /> Share
          </Button>
          {project.project_status === "apply_now" && (
            <Button className="gap-1.5" onClick={handleApply}>
              {hasApplied ? <><Pencil className="h-4 w-4" /> Edit</> : <><Send className="h-4 w-4" /> Apply</>}
            </Button>
          )}
        </div>
      </div>

      <Separator />

      {/* ── Readiness Checklist ────────────────────────────── */}
      <ReadinessChecklist />

      {/* ── Client Information ────────────────────────────── */}
      {client && (
        <InfoSection icon={Building2} title="About the Client">
          <DetailRow label="Organization" value={client.name} />
          {client.mission && (
            <DetailRow label="Mission" value={<p className="whitespace-pre-wrap leading-relaxed">{client.mission}</p>} />
          )}
          {project.description?.trim() && (
            <DetailRow
              label="Project Summary"
              value={
                <TranslatedContent
                  entityTable="projects"
                  entityId={project.id}
                  columnName="description"
                  sourceText={project.description}
                  as="p"
                  className="whitespace-pre-wrap leading-relaxed"
                />
              }
            />
          )}
          {client.website && (
            <DetailRow
              label="Website"
              value={
                <SafeExternalLink
                  href={client.website.startsWith("http") ? client.website : `https://${client.website}`}
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  {client.website}
                  <ExternalLink className="h-3 w-3" />
                </SafeExternalLink>
              }
            />
          )}
          {client.primary_contact && (
            <DetailRow label="Primary Contact" value={client.primary_contact} />
          )}
        </InfoSection>
      )}

      {/* ── Project Details ───────────────────────────────── */}
      <InfoSection icon={Briefcase} title="Project Details">
        <div className="grid sm:grid-cols-2 gap-4">
          <DetailRow label="Project Type" value={typeLabel(project.project_type)} />
          <DetailRow label="Current Phase" value={phaseLabel(project.phase)} />
          <DetailRow label="Status" value={statusLabel(project.project_status)} />
          {coordinatorName && (
            <DetailRow
              label="Project Coordinator"
              value={
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <span className="font-medium text-foreground">{coordinatorName}</span>
                </span>
              }
            />
          )}
          <DetailRow
            label="Applications Submitted"
            value={
              <span className="font-medium text-foreground">
                {applicationCount} application{applicationCount !== 1 ? "s" : ""}
              </span>
            }
          />
          <DetailRow
            label="Posted"
            value={format(new Date(project.created_at), "MMMM d, yyyy")}
          />
        </div>
      </InfoSection>

      {/* ── Schedule & Timezone ────────────────────────────── */}
      {(project.timezone_range || hasDateRange) && (
        <InfoSection icon={Clock} title="Schedule & Timezone">
          <div className="grid sm:grid-cols-2 gap-4">
            {project.timezone_range && (
              <DetailRow label="Timezone Range" value={project.timezone_range} />
            )}
            {project.anticipated_start_date && (
              <DetailRow
                label="Anticipated Start Date"
                value={format(new Date(project.anticipated_start_date + "T00:00:00"), "MMMM d, yyyy")}
              />
            )}
            {project.anticipated_end_date && (
              <DetailRow
                label="Anticipated End Date"
                value={format(new Date(project.anticipated_end_date + "T00:00:00"), "MMMM d, yyyy")}
              />
            )}
          </div>
        </InfoSection>
      )}

      {/* External operational links (client intake / Notion repo) are intentionally
          NOT shown on this public-facing recruitment page. They are member-only and
          appear inside the project workspace once you join the roster. */}

      {/* ── Team Hats ─────────────────────────────────────── */}
      <InfoSection icon={Users} title="Team Hats (Roles)">
        <p className="text-sm text-muted-foreground">
          These are the roles available for this project. Select the ones you're interested in when you apply.
        </p>
        <PillList items={project.team_hats} variant="secondary" />
      </InfoSection>

      {/* ── Milestones ────────────────────────────────────── */}
      {project.current_phase_milestones.length > 0 && (
        <InfoSection icon={Target} title="Current Phase Milestones">
          <PillList items={project.current_phase_milestones} variant="secondary" />
        </InfoSection>
      )}

      {/* ── Deliverables ──────────────────────────────────── */}
      {milestoneData.deliverables.length > 0 && (
        <InfoSection icon={FileText} title="Deliverables">
          <p className="text-sm text-muted-foreground">
            Key outputs the team will produce during this phase.
          </p>
          <PillList items={milestoneData.deliverables} />
        </InfoSection>
      )}

      {/* ── Activities ────────────────────────────────────── */}
      {milestoneData.activities.length > 0 && (
        <InfoSection icon={ClipboardList} title="Activities">
          <p className="text-sm text-muted-foreground">
            Core activities the team will engage in during this phase.
          </p>
          <PillList items={milestoneData.activities} />
        </InfoSection>
      )}

      {/* ── Skills ────────────────────────────────────────── */}
      {milestoneData.skills.length > 0 && (
        <InfoSection icon={Lightbulb} title="Skills You'll Develop">
          <p className="text-sm text-muted-foreground">
            Skills and competencies you'll practice and build on this project.
          </p>
          <PillList items={milestoneData.skills} />
        </InfoSection>
      )}

      {/* ── Client Project Timeframe ─────────────────────── */}
      <InfoSection icon={CalendarClock} title="Client Project Timeframe">
        <p className="text-sm text-foreground">This is a 12-week project.</p>
      </InfoSection>

      {/* ── Contributor Agreement ─────────────────────────── */}
      <InfoSection icon={ScrollText} title="Contributor Agreement">
        <p className="text-sm text-foreground">
          All Tech Fleet community contributors who join project training must read and agree to the Contributor Terms and Conditions.
        </p>
        <p className="text-sm text-foreground">
          Read more in the Tech Fleet Contributor Terms:{" "}
          <a
            href="https://techfleet.org/community-contributor-terms-and-conditions"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            techfleet.org/community-contributor-terms-and-conditions
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">People on this team are considered trainees. This means:</p>
          <ul className="space-y-2 text-sm text-muted-foreground mt-2">
            <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">1.</span>They are in training.</li>
            <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">2.</span>They are not considered volunteers.</li>
            <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">3.</span>They are not considered employees.</li>
            <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">4.</span>They are unpaid and in apprenticeship training for the purposes of getting team experience while learning.</li>
            <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">5.</span>They are not required to work certain amounts of hours or time frames, but are expected to put in 15 hours a week with the team doing work.</li>
            <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">6.</span>They are on the team for the purposes of learning and experience building.</li>
            <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">7.</span>They are able to use the deliverables from the project on a case study or portfolio for the purposes of getting hired.</li>
            <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">8.</span>At the end of their training, they are not guaranteed future training positions or employment by Tech Fleet or the client.</li>
          </ul>
        </div>
      </InfoSection>

      {/* ── Tech Fleet Policies ────────────────────────────── */}
      <InfoSection icon={ShieldCheck} title="Tech Fleet Policies">
        <p className="text-sm text-foreground">
          All Tech Fleet community contributors must read and agree to Tech Fleet policies in order to interact with the community and be a part of project training.
        </p>
        <p className="text-sm text-foreground">
          Find the policies here:{" "}
          <a
            href="https://guide.techfleet.org/policies/tech-fleets-policies"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            guide.techfleet.org/policies/tech-fleets-policies
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </InfoSection>

      {/* ── Project Timeline ──────────────────────────────── */}
      <InfoSection icon={Calendar} title="Project Timeline">
        <p className="text-sm text-foreground">
          Learn more in the Tech Fleet user guide:{" "}
          <a
            href="https://guide.techfleet.org/project-portal/applying-to-tech-fleet-project-training"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            guide.techfleet.org/project-portal/applying-to-tech-fleet-project-training
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Rough timeline after applications close:</p>
          <ul className="space-y-2 text-sm text-muted-foreground mt-2">
            <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">1.</span>One week after applications close: Tech Fleet Project Coordinator will {project.requires_interview === false ? "review applications and choose teammates" : "interview and choose teammates"} for the project. The entire process of building team can take up to 3–4 weeks.</li>
            <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">2.</span>Project Week 1–3 (3 weeks): Pre-kickoff</li>
            <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">3.</span>Project Week 3–10 (8 weeks): Project teamwork</li>
            <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">4.</span>Project Week 11 (1 week): Hand-off</li>
          </ul>
        </div>
      </InfoSection>

      {/* ── Selection / Interview Process ─────────────────── */}
      {project.requires_interview === false ? (
        <InfoSection icon={UserSearch} title="Selection Process">
          <p className="text-sm text-foreground">
            This project does not include interviews. The project coordinator will review applications and select teammates directly. You'll be notified by email and on your application status page when a decision is made.
          </p>
        </InfoSection>
      ) : (
        <InfoSection icon={UserSearch} title="Interview Process">
          <p className="text-sm text-foreground">
            Learn more in the Tech Fleet user guide:{" "}
            <a
              href="https://guide.techfleet.org/project-portal/applying-to-tech-fleet-project-training/project-timelines-and-application-process"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              guide.techfleet.org/.../project-timelines-and-application-process
              <ExternalLink className="h-3 w-3" />
            </a>
          </p>
          <p className="text-sm text-foreground">
            Here are some important pieces of information about interviewing with Tech Fleet projects:
          </p>

          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">How leads get selected:</p>
            <ul className="space-y-2 text-sm text-muted-foreground mt-2">
              <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">1.</span>Fill out an application.</li>
              <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">2.</span>The project coordinator will interview selected leads.</li>
              <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">3.</span>The leads who interview may be chosen for the project team.</li>
              <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">4.</span>There may be times when people from a previous phase are chosen to automatically continue as teammates for the sake of keeping people with project experience and knowledge, but the coordinator will communicate this, and will provide as close to 100% fair treatment as possible.</li>
              <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">5.</span>All teammates train on the project with peer learning and are operating with pro bono volunteer work.</li>
              <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">6.</span>Not all teammates are experts or experienced, some teammates are doing this for the first-time ever, as is designed in Tech Fleet to open more space for first-time learners.</li>
            </ul>
          </div>

          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">How apprentices get selected:</p>
            <ul className="space-y-2 text-sm text-muted-foreground mt-2">
              <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">1.</span>Fill out an application.</li>
              <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">2.</span>Submit the video ask responses.</li>
              <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">3.</span>The project coordinators will interview selected apprentices.</li>
              <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">4.</span>Typically, for each team function, up to 4 apprentices will be chosen, but sometimes more or less will be chosen depending on circumstances.</li>
              <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">5.</span>All apprentices train on the project with peer learning and are operating with pro bono volunteer work.</li>
            </ul>
          </div>
        </InfoSection>
      )}

      {/* ── Considerations ────────────────────────────────── */}
      <InfoSection icon={AlertTriangle} title="Considerations">
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">1.</span>While the expectations are for projects to start 4 weeks after applications close, this is not guaranteed, as this is a community-driven effort with pro bono volunteers giving their time back to coordinate projects for the betterment of the community. Please provide them patience, and thanks for understanding that the community is doing the best it can to coordinate these projects.</li>
          <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">2.</span>Not everyone who applies will be {project.requires_interview === false ? "selected" : "interviewed"}, or contacted individually due to demand on the project applications.</li>
          <li className="flex gap-2"><span className="text-foreground font-medium shrink-0">3.</span>The project coordinators will communicate in the platform, through Email, and #project-openings channel in Tech Fleet Discord with updates.</li>
        </ul>
      </InfoSection>

      {/* ── Bottom CTA ────────────────────────────────────── */}
      <div className="rounded-lg border bg-card p-6 sm:p-8 text-center space-y-4">
        <h2 className="text-xl font-bold text-foreground">
          {project.project_status !== "apply_now"
            ? "Project Overview"
            : hasApplied
              ? "Review Your Application"
              : "Ready to Join This Project?"}
        </h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          {project.project_status !== "apply_now"
            ? "This project is not currently accepting applications. Share it with others who might be interested."
            : hasApplied
              ? "You've already submitted an application for this project. You can review or edit your responses."
              : user
                ? "Submit your application to be considered for this project team. You'll need to complete a General Application first if you haven't already."
                : "Sign in or create an account to apply. We’ll bring you back to this application afterward."
          }
        </p>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" className="gap-1.5" onClick={handleShare}>
            <Share2 className="h-4 w-4" /> Share This Opening
          </Button>
          {project.project_status === "apply_now" && (
            <Button size="lg" className="gap-2" onClick={handleApply}>
              {hasApplied ? <><Pencil className="h-5 w-5" /> Edit Application</> : <><Send className="h-5 w-5" /> Apply Now</>}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
