import { useMemo, useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import { CommunityAgreementSheet } from "@/components/agreements/CommunityAgreementSheet";
import { useAgreementStatus } from "@/hooks/use-agreement-status";
import { useQuery, useMutation, useQueryClient } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  ArrowLeft, CheckCircle2, Clock, Calendar, UserCheck,
  XCircle, Users, LogOut, Loader2, FolderKanban, PartyPopper,
  Trophy, Star, Sparkles, Mail, User, Briefcase, GraduationCap,
  Trash2, FileCheck2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ClientLogo } from "@/components/ClientLogo";
import { ProjectOpeningHeading } from "@/components/projects/ProjectOpeningHeading";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PROJECT_TYPES, PROJECT_PHASES, PROJECT_STATUSES } from "@/data/project-constants";
import { ReadOnlyField, ReadOnlyLinkField, ReadOnlyArrayField } from "@/components/ReadOnlyField";
import { sanitizeHtml } from "@/lib/security";

/* ── status display config ─────────────────────────────────── */

const STATUS_CONFIG: Record<string, {
  label: string;
  icon: typeof Clock;
  variant: "default" | "success" | "warning" | "destructive" | "info";
  description: string;
}> = {
  pending_review: {
    label: "Pending Review",
    icon: Clock,
    variant: "warning",
    description: "Your application is being reviewed by the project coordinator. You'll be notified when there's an update.",
  },
  invited_to_interview: {
    label: "Invited to Interview",
    icon: Calendar,
    variant: "info",
    description: "You've been invited to an interview! Please schedule your interview using the link provided in your notification, then accept this invitation below to confirm.",
  },
  interview_scheduled: {
    label: "Interview Scheduled",
    icon: Calendar,
    variant: "info",
    description: "You've indicated that your interview has been scheduled. The project coordinator has been notified.",
  },
  not_selected: {
    label: "Not Selected",
    icon: XCircle,
    variant: "destructive",
    description: "Unfortunately, you were not selected for this project at this time. We encourage you to apply to other project openings.",
  },
  active_participant: {
    label: "Active Teammate",
    icon: Users,
    variant: "success",
    description: "You're an active teammate on this project. Keep up the great work!",
  },
  left_the_project: {
    label: "Left the Project",
    icon: LogOut,
    variant: "default",
    description: "You are no longer active on this project.",
  },
};

const typeLabel = (v: string) => PROJECT_TYPES.find((t) => t.value === v)?.label ?? v;
const phaseLabel = (v: string) => PROJECT_PHASES.find((p) => p.value === v)?.label ?? v;
const statusLabel = (v: string) => PROJECT_STATUSES.find((s) => s.value === v)?.label ?? v;

function getStatusBadgeClasses(variant: string): string {
  switch (variant) {
    case "success": return "bg-success/10 text-success border-success/30";
    case "warning": return "bg-warning/10 text-warning border-warning/30";
    case "destructive": return "bg-destructive/10 text-destructive border-destructive/30";
    case "info": return "bg-primary/10 text-primary border-primary/30";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

/* ── Timeline Step type ───────────────────────────────────── */

interface TimelineStep {
  key: string;
  label: string;
  icon: typeof Clock;
  status: "completed" | "active" | "upcoming" | "failed";
  description?: string;
}

/** Build the timeline steps based on the current applicant status and whether the project requires interviews. */
function buildTimeline(applicantStatus: string, requiresInterview: boolean = true): TimelineStep[] {
  const NOT_SELECTED_STATUSES = new Set(["not_selected"]);
  const isNotSelected = NOT_SELECTED_STATUSES.has(applicantStatus);

  const steps: TimelineStep[] = [
    {
      key: "submitted",
      label: "Application Submitted",
      icon: CheckCircle2,
      status: "completed",
      description: "Your application has been submitted and received.",
    },
  ];

  if (isNotSelected) {
    steps.push({
      key: "not_selected",
      label: "Not Selected",
      icon: XCircle,
      status: "failed",
      description: "You were not selected for this project. We encourage you to apply to other openings.",
    });
    return steps;
  }

  if (!requiresInterview) {
    // No-interview flow: Submitted → Under Review → Active Teammate
    const isActive = applicantStatus === "active_participant";
    steps.push({
      key: "review",
      label: "Under Review",
      icon: Clock,
      status: isActive ? "completed" : "active",
      description: isActive
        ? "The coordinator has reviewed your application and selected you for the team."
        : "The coordinator is reviewing applications and selecting teammates directly. You'll be notified by email and on this page when a decision is made.",
    });
    steps.push({
      key: "active",
      label: "Active Teammate",
      icon: Users,
      status: isActive ? "active" : "upcoming",
      description: isActive
        ? "You're actively contributing to the project team!"
        : "You'll become an active teammate once the coordinator selects you and onboarding is complete.",
    });
    return steps;
  }

  // Interview flow: Submitted → Invited for Interview → Active Teammate
  const STATUS_ORDER: Record<string, number> = {
    pending_review: 0,
    invited_to_interview: 1,
    interview_scheduled: 1.5,
    active_participant: 2,
    not_selected: -1,
    left_the_project: -2,
  };

  const currentOrder = STATUS_ORDER[applicantStatus] ?? 0;

  const interviewCompleted = currentOrder >= 1;
  const isScheduled = applicantStatus === "interview_scheduled";
  steps.push({
    key: "interview",
    label: "Invited for Interview",
    icon: Calendar,
    status: interviewCompleted ? "completed" : "upcoming",
    description: isScheduled
      ? "You've scheduled your interview. The coordinator has been notified."
      : interviewCompleted
      ? "You were invited and completed the interview process."
      : "Awaiting interview invitation from the coordinator.",
  });

  const activeCompleted = currentOrder >= 2;
  steps.push({
    key: "active",
    label: "Active Teammate",
    icon: Users,
    status: activeCompleted ? "completed" : "upcoming",
    description: activeCompleted
      ? "You're actively contributing to the project team!"
      : "You'll become an active teammate once you're selected and onboarding is complete.",
  });

  const currentStepMap: Record<string, string> = {
    pending_review: "submitted",
    invited_to_interview: "interview",
    interview_scheduled: "interview",
    active_participant: "active",
  };
  const activeKey = currentStepMap[applicantStatus];
  if (activeKey) {
    const idx = steps.findIndex((s) => s.key === activeKey);
    if (idx >= 0 && steps[idx].status === "completed") {
      steps[idx].status = "active";
    }
  }

  return steps;
}

/* ── Active Teammate Celebration ──────────────────────────── */

function ActiveTeammateCelebration({ clientName, friendlyName }: { clientName: string; friendlyName?: string | null }) {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <div className="relative overflow-hidden rounded-xl border-2 border-success/30 bg-gradient-to-br from-success/5 via-primary/5 to-success/10 p-8 text-center space-y-6">
      {/* Decorative elements */}
      <div className="absolute top-2 left-4 text-success/20 animate-pulse">
        <Sparkles className="h-6 w-6" />
      </div>
      <div className="absolute top-4 right-6 text-primary/20 animate-pulse delay-300">
        <Star className="h-5 w-5" />
      </div>
      <div className="absolute bottom-3 left-8 text-success/15 animate-pulse delay-500">
        <Star className="h-4 w-4" />
      </div>
      <div className="absolute bottom-4 right-4 text-primary/15 animate-pulse delay-700">
        <Sparkles className="h-5 w-5" />
      </div>

      <div className="flex justify-center mb-2">
        <div className="h-20 w-20 rounded-full bg-success/15 border-2 border-success/30 flex items-center justify-center">
          <Trophy className="h-10 w-10 text-success" />
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-foreground flex items-center justify-center gap-2">Congratulations!
          <PartyPopper className="h-6 w-6 text-success" />
        </h2>
        <p className="text-lg font-medium text-foreground">
          You're an Active Teammate on <span className="text-primary font-semibold">{clientName}</span>!
        </p>
        {friendlyName?.trim() && (
          <p className="text-base text-muted-foreground">{friendlyName}</p>
        )}
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          You've made it through the entire application process and are now contributing to your project team.
          Keep up the amazing work — your dedication makes a difference!
        </p>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => setVisible(false)}
      >
        Dismiss
      </Button>
    </div>
  );
}

/* ── Timeline Component ───────────────────────────────────── */

function StatusTimeline({ steps, onViewInvite, onMarkScheduled, applicantStatus }: { steps: TimelineStep[]; onViewInvite?: () => void; onMarkScheduled?: () => void; applicantStatus?: string }) {
  return (
    <div className="relative pl-10 space-y-0" role="list" aria-label="Application progress timeline">
      {steps.map((step, idx) => {
        const isLast = idx === steps.length - 1;
        const StepIcon = step.icon;

        const iconBg =
          step.status === "completed" ? "bg-success text-success-foreground" :
          step.status === "active" ? "bg-primary text-primary-foreground ring-4 ring-primary/20" :
          step.status === "failed" ? "bg-destructive text-destructive-foreground" :
          "bg-muted text-muted-foreground";

        const lineColor =
          step.status === "completed" ? "bg-success/40" :
          step.status === "failed" ? "bg-destructive/30" :
          "bg-border";

        const showInviteButton = step.key === "interview" && step.status !== "upcoming" && onViewInvite;
        const showScheduleButton = step.key === "interview" && step.status !== "upcoming" && onMarkScheduled && applicantStatus !== "interview_scheduled" && applicantStatus !== "active_participant" && applicantStatus !== "left_the_project";

        return (
          <div key={step.key} className="relative pb-8 last:pb-0" role="listitem">
            {/* Vertical connector line */}
            {!isLast && (
              <div
                className={`absolute left-[-20px] top-[20px] w-0.5 ${lineColor}`}
                style={{ height: "calc(100% - 12px)" }}
              />
            )}

            {/* Icon circle */}
            <div className={`absolute left-[-28px] top-1 h-8 w-8 rounded-full flex items-center justify-center ${iconBg} transition-all duration-300`}>
              <StepIcon className="h-4 w-4" />
            </div>

            {/* Content */}
            <div className="space-y-1 ml-6">
              <div className="flex items-center gap-2">
                <h4 className={`text-sm font-semibold ${
                  step.status === "upcoming" ? "text-muted-foreground" : "text-foreground"
                }`}>
                  {step.label}
                </h4>
                {step.status === "active" && (
                  <Badge className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border-primary/30">
                    Current
                  </Badge>
                )}
              </div>
              {step.description && (
                <p className={`text-xs ${
                  step.status === "upcoming" ? "text-muted-foreground/60" : "text-muted-foreground"
                }`}>
                  {step.description}
                </p>
              )}
              {(showInviteButton || showScheduleButton) && (
                <div className="flex items-center gap-2 mt-2">
                  {showInviteButton && (
                    <Button
                      variant="default"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={onViewInvite}
                    >
                      <Mail className="h-3.5 w-3.5" />
                      View Interview Invitation
                    </Button>
                  )}
                  {showScheduleButton && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={onMarkScheduled}
                    >
                      <Calendar className="h-3.5 w-3.5" />
                      I have Scheduled
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── main component ───────────────────────────────────────── */

export default function ProjectApplicationStatusPage() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [invitePanelOpen, setInvitePanelOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [agreementOpen, setAgreementOpen] = useState(false);
  const agreement = useAgreementStatus(applicationId);
  useEffect(() => {
    if (searchParams.get("agreement") === "open") {
      setAgreementOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("agreement");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  /* ── poll for status updates (realtime removed for security) ── */
  useEffect(() => {
    if (!applicationId) return;
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["my-project-app-status", applicationId] });
      queryClient.invalidateQueries({ queryKey: ["my-project-applications"] });
    }, 30_000);
    return () => clearInterval(interval);
  }, [applicationId, queryClient]);

  /* ── fetch application ──────────────────────────────────── */
  const { data: app, isLoading: appLoading } = useQuery({
    queryKey: ["my-project-app-status", applicationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_applications")
        .select("*")
        .eq("id", applicationId!)
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    enabled: !!applicationId && !!user,
  });

  /* ── fetch project ──────────────────────────────────────── */
  const { data: project } = useQuery({
    queryKey: ["project-for-app-status", app?.project_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, project_type, phase, project_status, team_hats, client_id, coordinator_id, requires_interview, friendly_name")
        .eq("id", app!.project_id as string)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!app?.project_id,
  });

  /* ── fetch coordinator name ─────────────────────────────── */
  const { data: coordinatorProfile } = useQuery({
    queryKey: ["coordinator-profile", (project as any)?.coordinator_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, first_name, last_name")
        .eq("user_id", (project as any).coordinator_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!(project as any)?.coordinator_id,
  });

  const coordinatorName = coordinatorProfile
    ? (coordinatorProfile.display_name || [coordinatorProfile.first_name, coordinatorProfile.last_name].filter(Boolean).join(" ") || null)
    : null;

  /* ── fetch client ───────────────────────────────────────── */
  const { data: client } = useQuery({
    queryKey: ["client-for-app-status", project?.client_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, website, mission, logo_url")
        .eq("id", project!.client_id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!project?.client_id,
  });

  /* ── fetch own profile ──────────────────────────────────── */
  const { data: profile } = useQuery({
    queryKey: ["my-profile-for-app-status", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    enabled: !!user,
  });

  /* ── fetch general application ──────────────────────────── */
  const { data: genApp } = useQuery({
    queryKey: ["my-gen-app-for-status", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("general_applications")
        .select("*")
        .eq("user_id", user!.id)
        .eq("status", "completed")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as Record<string, unknown> | null;
    },
    enabled: !!user,
  });

  const applicantStatus = (app?.applicant_status as string) ?? "pending_review";
  const config = STATUS_CONFIG[applicantStatus] ?? STATUS_CONFIG.pending_review;
  const StatusIcon = config.icon;
  const clientName = client?.name ?? "Project";
  const isActiveTeammate = applicantStatus === "active_participant";

  /* ── fetch interview invite notification ─────────────────── */
  const showInviteStatuses = ["invited_to_interview", "interview_scheduled", "active_participant"];
  const { data: interviewNotification } = useQuery({
    queryKey: ["interview-invite-notification", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user!.id)
        .eq("notification_type", "interview_invite")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user && showInviteStatuses.includes(applicantStatus),
  });

  /* ── build timeline ─────────────────────────────────────── */
  const requiresInterview = (project as any)?.requires_interview !== false;
  const timelineSteps = useMemo(
    () => buildTimeline(applicantStatus, requiresInterview),
    [applicantStatus, requiresInterview],
  );

  /* ── mark interview scheduled mutation ──────────────────── */
  const scheduleMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("mark-interview-scheduled", {
        body: { application_id: applicationId },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Interview marked as scheduled!", {
        description: "The project coordinator has been notified.",
        position: "top-center",
      });
      queryClient.invalidateQueries({ queryKey: ["my-project-app-status", applicationId] });
      queryClient.invalidateQueries({ queryKey: ["my-project-applications"] });
    },
    onError: (err: Error) => {
      toast.error("We couldn't update the status. Please try again.", { description: err.message });
    },
  });

  const handleMarkScheduled = useCallback(() => {
    scheduleMutation.mutate();
  }, [scheduleMutation]);

  /* ── delete application mutation ────────────────────────── */
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("project_applications")
        .delete()
        .eq("id", applicationId!)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Application deleted", {
        description: "Your project application has been permanently removed.",
        position: "top-center",
      });
      queryClient.invalidateQueries({ queryKey: ["my-project-applications"] });
      queryClient.invalidateQueries({ queryKey: ["my-project-apps-count"] });
      navigate("/applications/projects", { replace: true });
    },
    onError: (err: Error) => {
      toast.error("We couldn't delete that application. Please try again.", { description: err.message });
    },
  });

  /* ── loading / not found states ─────────────────────────── */
  if (appLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Loading application status" />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="container-app py-12 text-center">
        <FolderKanban className="h-12 w-12 mx-auto mb-4 opacity-40 text-muted-foreground" />
        <p className="text-muted-foreground">Application not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/applications/projects")}>
          Back to Project Applications
        </Button>
      </div>
    );
  }

  return (
    <div className="container-app py-8 sm:py-12 max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/applications">Applications</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/applications/projects">Project Applications</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Application Status</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/applications/projects")} aria-label="Back to Project Applications">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-3">
            <ClientLogo url={(client as any)?.logo_url} name={clientName} size="md" />
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-3 flex-wrap">
                <ProjectOpeningHeading
                  clientName={clientName}
                  friendlyName={(project as any)?.friendly_name}
                  size="xl"
                  as="h1"
                />
                <Badge className={`gap-1 mt-1 ${getStatusBadgeClasses(config.variant)}`}>
                  <StatusIcon className="h-3 w-3" />
                  {config.label}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">Application Status</p>
            </div>
          </div>
        </div>
      </div>

      {/* Active Teammate Celebration */}
      {isActiveTeammate && <ActiveTeammateCelebration clientName={clientName} friendlyName={(project as any)?.friendly_name} />}

      {/* Community Agreement callout */}
      {agreement.data?.status === "pending" && (
        <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="pt-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-foreground">Sign your Community Contributor Terms</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Before you start training on {clientName}, please review and agree to the Community Contributor Terms.
              </p>
            </div>
            <Button onClick={() => setAgreementOpen(true)} className="gap-2 self-start sm:self-auto">
              <FileCheck2 className="h-4 w-4" />
              Review and agree
            </Button>
          </CardContent>
        </Card>
      )}
      {agreement.data?.status === "signed" && (
        <p className="text-xs text-muted-foreground">
          Community Contributor Terms signed{agreement.data.signedAt ? ` on ${format(new Date(agreement.data.signedAt), "MMMM d, yyyy")}` : ""}.
        </p>
      )}

      <CommunityAgreementSheet
        open={agreementOpen}
        onOpenChange={setAgreementOpen}
        applicationId={applicationId!}
        projectName={(project as any)?.friendly_name ?? clientName}
        clientName={clientName}
      />


      {/* Timeline Card */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Your Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <StatusTimeline
            steps={timelineSteps}
            onViewInvite={showInviteStatuses.includes(applicantStatus) ? () => setInvitePanelOpen(true) : undefined}
            onMarkScheduled={showInviteStatuses.includes(applicantStatus) ? handleMarkScheduled : undefined}
            applicantStatus={applicantStatus}
          />
        </CardContent>
      </Card>

      {/* What to Expect Timeline — shown for early-stage applicants on interview projects only */}
      {requiresInterview && ["pending_review", "invited_to_interview", "interview_scheduled"].includes(applicantStatus) && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">What to Expect
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-5">
              Here's a general timeline of what happens after you submit your application:
            </p>
            <div className="relative pl-8 space-y-6">
              {/* Vertical connector line */}
              <div className="absolute left-[11px] top-1 bottom-1 w-0.5 bg-border" aria-hidden="true" />

              {/* Week 1–2 */}
              <div className="relative flex gap-4">
                <div className="absolute -left-8 top-0.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary bg-primary/10">
                  <Mail className="h-3 w-3 text-primary" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">Week 1–2: Interview Invitation</p>
                  <p className="text-sm text-muted-foreground">
                    You'll hear back from a coordinator about scheduling an interview. Keep an eye on your notifications!
                  </p>
                </div>
              </div>

              {/* Week 3–4 */}
              <div className="relative flex gap-4">
                <div className="absolute -left-8 top-0.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-muted-foreground/30 bg-muted">
                  <Briefcase className="h-3 w-3 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">Week 3–4: Recruitment & Interviews</p>
                  <p className="text-sm text-muted-foreground">
                    The coordinator will conduct interviews and recruit trainees for the project team.
                  </p>
                </div>
              </div>

              {/* Week 5–6 */}
              <div className="relative flex gap-4">
                <div className="absolute -left-8 top-0.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-muted-foreground/30 bg-muted">
                  <GraduationCap className="h-3 w-3 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">Week 5–6: Team Selection & Onboarding</p>
                  <p className="text-sm text-muted-foreground">
                    The team gets selected and starts onboarding together. You'll be notified if you're selected!
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Interview Invitation Side Panel */}
      <Sheet open={invitePanelOpen} onOpenChange={setInvitePanelOpen}>
        <SheetContent resizeKey="interview-invite" className="sm:max-w-lg">
          <SheetHeader className="pb-4">
            <SheetTitle className="flex items-center gap-2 text-lg">{interviewNotification?.title ?? "Interview Invitation"}
            </SheetTitle>
            <SheetDescription>
              {interviewNotification
                ? `Received ${format(new Date(interviewNotification.created_at), "MMM d, yyyy 'at' h:mm a")}`
                : "Interview details"}
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="h-[calc(100dvh-14rem)] pr-4">
            {interviewNotification?.body_html ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none [&_a]:text-primary [&_a]:underline"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(interviewNotification.body_html) }}
              />
            ) : (
              <p className="text-muted-foreground text-sm">No invitation details available.</p>
            )}
          </ScrollArea>
          {applicantStatus === "invited_to_interview" && (
            <div className="border-t pt-4 mt-4">
              <p className="text-sm text-muted-foreground mb-3">
                Once you've scheduled your interview, let the coordinator know:
              </p>
              <Button
                className="w-full"
                onClick={() => { handleMarkScheduled(); setInvitePanelOpen(false); }}
              >
                <Calendar className="h-4 w-4 mr-2" />
                I have Scheduled
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Schedule Interview CTA */}
      {applicantStatus === "invited_to_interview" && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6 text-center space-y-4">
            <PartyPopper className="h-8 w-8 text-primary mx-auto" />
            <h3 className="text-lg font-semibold text-foreground">
              You've been invited to interview!
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Please schedule your interview using the scheduling link in your notification email, 
              then click the button below to let the coordinator know you've scheduled it.
            </p>
            <Button
              size="lg"
              className="gap-2"
              onClick={handleMarkScheduled}
              disabled={scheduleMutation.isPending}
            >
              {scheduleMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Calendar className="h-4 w-4" />
              )}
              I have Scheduled
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Submission & Project Details */}
      <Card>
        <CardContent className="pt-6 space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Submission Details</h3>
            <div className="space-y-3 text-sm">
              {app.completed_at && (
                <div>
                  <p className="text-muted-foreground">Submitted</p>
                  <p className="font-medium text-foreground">
                    {format(new Date(app.completed_at as string), "MMM d, yyyy")}
                  </p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground">Team Hats</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {((app.team_hats_interest as string[]) ?? []).map((h) => (
                    <Badge key={h} variant="outline" className="text-xs">{h}</Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {project && (
            <>
              <Separator />
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Project Details</h3>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="text-xs">{typeLabel(project.project_type)}</Badge>
                  <Badge variant="outline" className="text-xs">{phaseLabel(project.phase)}</Badge>
                  <Badge variant="outline" className="text-xs">{statusLabel(project.project_status)}</Badge>
                </div>
                {coordinatorName && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Project Coordinator</p>
                    <p className="text-sm text-foreground font-medium">{coordinatorName}</p>
                  </div>
                )}
                {client?.mission && (
                  <p className="text-sm text-muted-foreground">{client.mission}</p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Profile Information ──────────────────────────────── */}
      {profile && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">Your Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ReadOnlyField label="Name" value={`${(profile.first_name as string) ?? ""} ${(profile.last_name as string) ?? ""}`.trim() || (profile.display_name as string) || "—"} />
            <ReadOnlyField label="Email" value={(profile.email as string) ?? "—"} />
            <ReadOnlyField label="Country" value={(profile.country as string) || "—"} />
            <ReadOnlyField label="Timezone" value={(profile.timezone as string) || "—"} />
            {(profile.discord_username as string) && (
              <ReadOnlyField label="Discord" value={profile.discord_username as string} />
            )}
            {(profile.linkedin_url as string) && (
              <ReadOnlyLinkField label="LinkedIn" href={profile.linkedin_url as string} linkText="Profile" />
            )}
            {(profile.portfolio_url as string) && (
              <ReadOnlyLinkField label="Portfolio" href={profile.portfolio_url as string} linkText="View" />
            )}
            <ReadOnlyArrayField label="Experience Areas" items={(profile.experience_areas as string[]) ?? []} />
            <ReadOnlyArrayField label="Education Background" items={(profile.education_background as string[]) ?? []} />
            <ReadOnlyArrayField label="Interests" items={(profile.interests as string[]) ?? []} />
            <ReadOnlyField label="Professional Background" value={(profile.professional_background as string) ?? ""} />
            <ReadOnlyField label="Professional Goals" value={(profile.professional_goals as string) ?? ""} />
            <ReadOnlyField label="Bio" value={(profile.bio as string) ?? ""} />
          </CardContent>
        </Card>
      )}

      {/* ── General Application ──────────────────────────────── */}
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
            <ReadOnlyField label="Service Leadership Definition" value={(genApp.servant_leadership_definition as string) ?? ""} />
            <ReadOnlyField label="Service Leadership Actions" value={(genApp.servant_leadership_actions as string) ?? ""} />
            <ReadOnlyField label="Service Leadership Challenges" value={(genApp.servant_leadership_challenges as string) ?? ""} />
            <ReadOnlyField label="Service Leadership Situation" value={(genApp.servant_leadership_situation as string) ?? ""} />
          </CardContent>
        </Card>
      )}

      {/* ── Project Application Responses ─────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">Project Application — {clientName}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ReadOnlyArrayField label="Team Hats of Interest" items={(app.team_hats_interest as string[]) ?? []} />

          <Separator className="my-2" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {(app.participated_previous_phase as boolean) ? "Previous Phase Experience" : "Prior Engagement"}
          </p>

          {(app.participated_previous_phase as boolean) ? (
            <>
              <ReadOnlyField label="What team position did you join in the previous phase?" value={(app.previous_phase_position as string) ?? ""} />
              <ReadOnlyField label="What did you learn in the previous phase?" value={(app.previous_phase_learnings as string) ?? ""} />
              <ReadOnlyField label="How will you help your teammates succeed in this upcoming phase?" value={(app.previous_phase_help_teammates as string) ?? ""} />
            </>
          ) : (
            <ReadOnlyField
              label="How has your prior engagement in Tech Fleet prepared you for this team role?"
              value={(app.prior_engagement_preparation as string) ?? ""}
            />
          )}

          <Separator className="my-2" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Client Questions</p>
          <ReadOnlyField label="Why are you passionate about being on this project?" value={(app.passion_for_project as string) ?? ""} />
          <ReadOnlyField label="What do you know about the client and the project?" value={(app.client_project_knowledge as string) ?? ""} />
          <ReadOnlyField label="How would you like to contribute to cross-functional teamwork?" value={(app.cross_functional_contribution as string) ?? ""} />
          <ReadOnlyField label="How will you contribute to this project's successful outcomes?" value={(app.project_success_contribution as string) ?? ""} />
        </CardContent>
      </Card>

      {/* Bottom nav */}
      <div className="flex justify-between pb-8">
        <Button variant="outline" onClick={() => navigate("/applications/projects")} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back to Project Applications
        </Button>

        {applicantStatus === "pending_review" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="gap-1.5" disabled={deleteMutation.isPending}>
                <Trash2 className="h-4 w-4" />
                {deleteMutation.isPending ? "Deleting…" : "Delete Application"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete project application?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your application for <span className="font-semibold">{clientName}</span> and all of your responses will be permanently removed. You can't undo this.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete application
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}
