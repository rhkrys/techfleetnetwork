import { useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/hooks/use-admin";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import {
  ArrowLeft, ArrowRight, Share2, CheckCircle2, XCircle, User,
  Briefcase, GraduationCap, Loader2, Copy, ShieldAlert,
} from "lucide-react";
import { PageTitle } from "@/components/ui/typography";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ReadOnlyField, ReadOnlyLinkField, ReadOnlyArrayField } from "@/components/ReadOnlyField";
import { PROJECT_TYPES, PROJECT_PHASES, PROJECT_STATUSES } from "@/data/project-constants";
import { toast } from "sonner";
import { ApplicantStatusDropdown, applicantStatusLabel } from "@/components/admin/ApplicantStatusDropdown";
import { DiscordRoleAssignment } from "@/components/admin/DiscordRoleAssignment";
import { AgreementResendButton } from "@/components/agreements/AgreementResendButton";
import { CompletedCoursesPanel } from "@/components/admin/CompletedCoursesPanel";
import { useCourseCatalogPrep } from "@/hooks/use-course-catalog-prep";

const typeLabel = (v: string) => PROJECT_TYPES.find((t) => t.value === v)?.label ?? v;
const phaseLabel = (v: string) => PROJECT_PHASES.find((p) => p.value === v)?.label ?? v;
const statusLabel = (v: string) => PROJECT_STATUSES.find((s) => s.value === v)?.label ?? v;

export default function RosterApplicantDetailPage() {
  const { projectId, applicationId } = useParams<{ projectId: string; applicationId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdmin();

  // Fetch all completed apps for this project (for next/prev navigation)
  const { data: allApps } = useQuery({
    queryKey: ["roster-project-apps-nav", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_applications")
        .select("id, user_id, completed_at")
        .eq("project_id", projectId!)
        .eq("status", "completed")
        .order("completed_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!projectId && !!user && isAdmin,
  });

  // Fetch current application
  const { data: projApp, isLoading: projAppLoading } = useQuery({
    queryKey: ["roster-app-detail", applicationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_applications")
        .select("*")
        .eq("id", applicationId!)
        .single();
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    enabled: !!applicationId && !!user && isAdmin,
  });

  // Fetch project (broad fields). Operational/internal links (discord_role_id,
  // notion_repository_url, etc.) are revoked from authenticated for security
  // and must be fetched via get_project_internal_links RPC.
  const { data: project } = useQuery({
    queryKey: ["roster-proj-detail", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, clients(name)")
        .eq("id", projectId!)
        .single();
      if (error) throw error;
      return data as Record<string, unknown> & { clients: { name: string } | null };
    },
    enabled: !!projectId && !!user && isAdmin,
  });

  // Admin-only operational links (discord role, notion, intake URL)
  const { data: projectLinks } = useQuery({
    queryKey: ["roster-proj-links", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("get_project_internal_links", { p_project_id: projectId! });
      if (error) throw error;
      return (data?.[0] ?? null) as {
        discord_role_id: string | null;
        discord_role_name: string | null;
      } | null;
    },
    enabled: !!projectId && !!user && isAdmin,
  });

  // Fetch applicant profile
  const { data: profile } = useQuery({
    queryKey: ["roster-profile-for-app", projApp?.user_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", projApp!.user_id as string)
        .single();
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    enabled: !!projApp?.user_id,
  });

  // Fetch general application
  const { data: genApp } = useQuery({
    queryKey: ["roster-gen-app", projApp?.user_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("general_applications")
        .select("*")
        .eq("user_id", projApp!.user_id as string)
        .eq("status", "completed")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as Record<string, unknown> | null;
    },
    enabled: !!projApp?.user_id,
  });

  // Course catalog (core + onboarding) and applicant's completions for the
  // "Completed courses" recruiting-prep panel.
  const { catalog: prepCatalog } = useCourseCatalogPrep(!!user && isAdmin);
  const { data: applicantCompletions } = useQuery({
    queryKey: ["roster-app-completions", projApp?.user_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_completions")
        .select("course_key")
        .eq("user_id", projApp!.user_id as string);
      if (error) throw error;
      return (data ?? []) as { course_key: string }[];
    },
    enabled: !!projApp?.user_id && isAdmin,
    staleTime: 60 * 1000,
  });
  const completedKeys = useMemo(
    () => new Set((applicantCompletions ?? []).map((r) => r.course_key)),
    [applicantCompletions],
  );

  const clientName = (project?.clients as { name: string } | null)?.name ?? "Project";

  const applicantName = useMemo(() => {
    if (!profile) return "Applicant";
    const dn = profile.display_name as string;
    if (dn) return dn;
    return `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || "Applicant";
  }, [profile]);

  // Next/Previous navigation
  const { prevId, nextId, currentIndex, totalCount } = useMemo(() => {
    if (!allApps || !applicationId) return { prevId: null, nextId: null, currentIndex: -1, totalCount: 0 };
    const idx = allApps.findIndex((a) => a.id === applicationId);
    return {
      prevId: idx > 0 ? allApps[idx - 1].id : null,
      nextId: idx < allApps.length - 1 ? allApps[idx + 1].id : null,
      currentIndex: idx,
      totalCount: allApps.length,
    };
  }, [allApps, applicationId]);

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copied to clipboard");
    } catch {
      toast.info(window.location.href);
    }
  };

  if (adminLoading || projAppLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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

  if (!projApp) {
    return (
      <div className="container-app py-12 text-center">
        <p className="text-muted-foreground">Application not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate(`/admin/roster/project/${projectId}`)}>
          Back to Project Roster
        </Button>
      </div>
    );
  }

  const participatedPrev = projApp.participated_previous_phase as boolean;

  return (
    <div className="container-app py-8 sm:py-12 max-w-4xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/roster">Recruiting Center</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to={`/admin/roster/project/${projectId}`}>{clientName}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{applicantName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <PageTitle>{applicantName}</PageTitle>
          <p className="text-sm text-muted-foreground">{clientName} — Applicant Details</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 self-start" onClick={handleShare}>
          <Share2 className="h-4 w-4" />
          Share
        </Button>
      </div>

      {/* Next/Previous Navigation — placed directly under header so coordinators always see it */}
      {totalCount > 1 && (
        <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={!prevId}
            onClick={() => prevId && navigate(`/admin/roster/project/${projectId}/applicant/${prevId}`)}
          >
            <ArrowLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            {currentIndex + 1} of {totalCount} applicants
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={!nextId}
            onClick={() => nextId && navigate(`/admin/roster/project/${projectId}/applicant/${nextId}`)}
          >
            Next
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}


      {/* Application Status Card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-6">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Application Status</p>
            <Badge variant="secondary" className="text-sm px-3 py-1">
              {applicantStatusLabel((projApp.applicant_status as string) ?? "pending_review")}
            </Badge>
            <p className="text-xs text-muted-foreground mt-1">
              {(project as any)?.requires_interview === false
                ? "This project does not include interviews. Applicants move directly from Pending Review to Active Participant."
                : "Changing status to \"Invite to Interview\" will send an email and in-app notification to the applicant."}
            </p>
          </div>
          <ApplicantStatusDropdown
            applicationId={applicationId!}
            applicantUserId={projApp.user_id as string}
            applicantFirstName={(profile?.first_name as string) ?? ""}
            applicantEmail={(profile?.email as string) ?? ""}
            projectId={projectId!}
            currentStatus={(projApp.applicant_status as string) ?? "pending_review"}
            requiresInterview={(project as any)?.requires_interview !== false}
            triggerLabel="Change Status"
            invalidateKeys={[
              ["roster-app-detail", applicationId!],
              ["roster-project-apps", projectId!],
            ]}
          />
        </CardContent>
      </Card>

      {/* Community Agreement Status */}
      {projApp.community_agreement_required_at ? (
        <Card className={projApp.community_agreement_signed_at ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}>
          <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-6">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Community Contributor Agreement</p>
              {projApp.community_agreement_signed_at ? (
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                  Signed {format(new Date(projApp.community_agreement_signed_at as string), "MMMM d, yyyy")}
                </Badge>
              ) : (
                <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                  Pending since {format(new Date(projApp.community_agreement_required_at as string), "MMMM d, yyyy")}
                </Badge>
              )}
            </div>
            {!projApp.community_agreement_signed_at && (
              <AgreementResendButton applicationId={applicationId!} />
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Completed courses — recruiting prep snapshot */}
      <Card>
        <CardContent className="pt-6">
          <CompletedCoursesPanel
            completedKeys={completedKeys}
            catalog={prepCatalog}
            variant="full"
          />
        </CardContent>
      </Card>


      {/* Submission meta */}
      <div className="flex flex-col gap-2">
        {projApp.completed_at && (
          <Badge className="bg-success/10 text-success border-success/30 gap-1 w-fit">
            <CheckCircle2 className="h-3 w-3" />
            Submitted {format(new Date(projApp.completed_at as string), "MMMM d, yyyy")}
          </Badge>
        )}
        <Badge variant="secondary" className="w-fit">{typeLabel((project?.project_type as string) ?? "")}</Badge>
        <Badge variant="outline" className="w-fit">{phaseLabel((project?.phase as string) ?? "")}</Badge>
        <Badge variant="outline" className="w-fit">{statusLabel((project?.project_status as string) ?? "")}</Badge>
        {participatedPrev
          ? <Badge className="bg-success/10 text-success border-success/30 gap-1 w-fit"><CheckCircle2 className="h-3 w-3" />Previous Participant</Badge>
          : <Badge variant="outline" className="gap-1 w-fit"><XCircle className="h-3 w-3" />New Participant</Badge>}
      </div>

      <Separator />

      {/* SECTION 1: Applicant Profile */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">Applicant Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ReadOnlyField label="Name" value={applicantName} />
          <ReadOnlyField label="Email" value={(profile?.email as string) ?? "—"} />
          <ReadOnlyField label="Country" value={(profile?.country as string) || "—"} />
          <ReadOnlyField label="Timezone" value={(profile?.timezone as string) || "—"} />
          {(profile?.discord_username as string) && (
            <ReadOnlyField label="Discord" value={profile!.discord_username as string} />
          )}
          {(profile?.linkedin_url as string) && (
            <ReadOnlyLinkField label="LinkedIn" href={profile!.linkedin_url as string} linkText="Profile" />
          )}
          {(profile?.portfolio_url as string) && (
            <ReadOnlyLinkField label="Portfolio" href={profile!.portfolio_url as string} linkText="View" />
          )}
          <ReadOnlyArrayField label="Experience Areas" items={(profile?.experience_areas as string[]) ?? []} />
          <ReadOnlyArrayField label="Education Background" items={(profile?.education_background as string[]) ?? []} />
          <ReadOnlyArrayField label="Interests" items={(profile?.interests as string[]) ?? []} />
          <ReadOnlyField label="Professional Background" value={(profile?.professional_background as string) ?? ""} entityTable="profiles" entityId={profile?.id as string} columnName="professional_background" />
          <ReadOnlyField label="Professional Goals" value={(profile?.professional_goals as string) ?? ""} entityTable="profiles" entityId={profile?.id as string} columnName="professional_goals" />
          <ReadOnlyField label="Bio" value={(profile?.bio as string) ?? ""} entityTable="profiles" entityId={profile?.id as string} columnName="bio" />

        </CardContent>
      </Card>

      {/* SECTION: Discord Role Management */}
      {project && (
        <DiscordRoleAssignment
          discordRoleId={projectLinks?.discord_role_id ?? ""}
          discordRoleName={projectLinks?.discord_role_name ?? ""}
          applicantDiscordUserId={(profile?.discord_user_id as string) ?? ""}
          applicantDiscordUsername={(profile?.discord_username as string) ?? ""}
          applicantName={applicantName}
        />
      )}

      {/* SECTION 2: General Application */}
      {genApp && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">General Application
            </CardTitle>
            {genApp.completed_at && (
              <p className="text-xs text-muted-foreground">
                Completed {format(new Date(genApp.completed_at as string), "MMMM d, yyyy")}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <ReadOnlyField label="Hours commitment" value={(genApp.hours_commitment as string) ?? ""} />

            <Separator className="my-2" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Engagement History</p>
            <ReadOnlyField label="Previous engagement with Tech Fleet" value={(genApp.previous_engagement as string) ?? ""} />
            <ReadOnlyArrayField label="Previous engagement ways" items={(genApp.previous_engagement_ways as string[]) ?? []} />
            <ReadOnlyField label="What have you learned from teammates?" value={(genApp.teammate_learnings as string) ?? ""} />

            <Separator className="my-2" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agile Mindset</p>
            <ReadOnlyField label="Agile vs Waterfall" value={(genApp.agile_vs_waterfall as string) ?? ""} />
            <ReadOnlyField label="Psychological Safety" value={(genApp.psychological_safety as string) ?? ""} />
            <ReadOnlyField label="Agile Philosophies" value={(genApp.agile_philosophies as string) ?? ""} />
            <ReadOnlyField label="Collaboration Challenges" value={(genApp.collaboration_challenges as string) ?? ""} />

            <Separator className="my-2" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Service Leadership</p>
            <ReadOnlyField label="Service Leadership Definition" value={(genApp.service_leadership_definition as string) ?? ""} />
            <ReadOnlyField label="Service Leadership Actions" value={(genApp.service_leadership_actions as string) ?? ""} />
            <ReadOnlyField label="Service Leadership Challenges" value={(genApp.service_leadership_challenges as string) ?? ""} />
            <ReadOnlyField label="Service Leadership Situation" value={(genApp.service_leadership_situation as string) ?? ""} />
          </CardContent>
        </Card>
      )}

      {/* SECTION 3: Project Application */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">Project Application — {clientName}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ReadOnlyArrayField label="Team Hats of Interest" items={(projApp.team_hats_interest as string[]) ?? []} />

          <Separator className="my-2" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {participatedPrev ? "Previous Phase Experience" : "Prior Engagement"}
          </p>

          {participatedPrev ? (
            <>
              <ReadOnlyField label="What team position did you join in the previous phase?" value={(projApp.previous_phase_position as string) ?? ""} />
              <ReadOnlyField label="What did you learn in the previous phase?" value={(projApp.previous_phase_learnings as string) ?? ""} />
              <ReadOnlyField label="How will you help your teammates succeed in this upcoming phase?" value={(projApp.previous_phase_help_teammates as string) ?? ""} />
            </>
          ) : (
            <ReadOnlyField
              label="How has your prior engagement in Tech Fleet prepared you for this team role?"
              value={(projApp.prior_engagement_preparation as string) ?? ""}
            />
          )}

          <Separator className="my-2" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Client Questions</p>
          <ReadOnlyField label="Why are you passionate about being on this project?" value={(projApp.passion_for_project as string) ?? ""} />
          <ReadOnlyField label="What do you know about the client and the project?" value={(projApp.client_project_knowledge as string) ?? ""} />
          <ReadOnlyField label="How would you like to contribute to cross-functional teamwork?" value={(projApp.cross_functional_contribution as string) ?? ""} />
          <ReadOnlyField label="How will you contribute to this project's successful outcomes?" value={(projApp.project_success_contribution as string) ?? ""} />
        </CardContent>
      </Card>

      {/* Bottom nav */}
      <div className="flex items-center justify-between pb-8">
        <Button
          variant="outline"
          onClick={() => navigate(`/admin/roster/project/${projectId}`)}
          className="gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Project Roster
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleShare}>
          <Copy className="h-4 w-4" /> Copy Link
        </Button>
      </div>
    </div>
  );
}
