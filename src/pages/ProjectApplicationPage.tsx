import { useState, useMemo, useCallback, useEffect, useRef, useLayoutEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeRecordFields } from "@/lib/validators/shared-input";
import { assertWritten } from "@/lib/db-helpers";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { showFormErrors, scrollToFirstError } from "@/lib/form-validation";
import { DiscordNotifyService } from "@/services/discord-notify.service";
import {
  Loader2, CheckCircle2, Globe, User, ExternalLink,
  PartyPopper, AlertTriangle, Pencil, AlertCircle,
} from "lucide-react";
import { StepProgressBar } from "@/components/StepProgressBar";
import { FlowMobileNav } from "@/components/FlowMobileNav";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { MultiSelect } from "@/components/ui/multi-select";
import { usePageHeader } from "@/contexts/PageHeaderContext";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { ProjectOpeningHeading } from "@/components/projects/ProjectOpeningHeading";
import {
  PROJECT_TYPES, PROJECT_PHASES, TEAM_HATS,
} from "@/data/project-constants";
import { format } from "date-fns";
import { useAutosave } from "@/hooks/use-autosave";
import { AutosaveStatus } from "@/components/ui/AutosaveStatus";


/* ── types ─────────────────────────────────────────────────── */
interface ProjectApp {
  id: string;
  user_id: string;
  project_id: string;
  status: string;
  current_step: number;
  team_hats_interest: string[];
  participated_previous_phase: boolean;
  previous_phase_position: string;
  previous_phase_learnings: string;
  previous_phase_help_teammates: string;
  prior_engagement_preparation: string;
  passion_for_project: string;
  client_project_knowledge: string;
  cross_functional_contribution: string;
  project_success_contribution: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ProjectInfo {
  id: string;
  client_id: string;
  project_type: string;
  phase: string;
  project_status: string;
  team_hats: string[];
  current_phase_milestones: string[];
  coordinator_id?: string | null;
  friendly_name?: string;
  description?: string;
}

interface ClientInfo {
  id: string;
  name: string;
  website: string;
  mission: string;
  project_summary: string;
  primary_contact: string;
}

const STEP_LABELS = ["Review General App", "Project Questions", "Client Questions", "Review & Submit"];

/* ── read-only display helpers ───────────────────────────── */
function ReadOnlyField({ label, value }: { label: string; value: string }) {
  const hasValue = !!value?.trim();
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <p className={`text-sm whitespace-pre-wrap leading-relaxed ${hasValue ? "text-muted-foreground" : "text-muted-foreground/50 italic"}`}>
        {hasValue ? value : "Not provided"}
      </p>
    </div>
  );
}

function ReadOnlyArrayField({ label, items }: { label: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge key={item} variant="outline" className="text-xs">{item}</Badge>
        ))}
      </div>
    </div>
  );
}

/* ── component ────────────────────────────────────────────── */
export default function ProjectApplicationPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading, profileLoaded } = useAuth();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(1);
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  /* form state */
  const [teamHatsInterest, setTeamHatsInterest] = useState<string[]>([]);
  const [participatedPrev, setParticipatedPrev] = useState(false);
  const [prevPosition, setPrevPosition] = useState("");
  const [prevLearnings, setPrevLearnings] = useState("");
  const [prevHelpTeammates, setPrevHelpTeammates] = useState("");
  const [priorPreparation, setPriorPreparation] = useState("");
  const [passion, setPassion] = useState("");
  const [clientKnowledge, setClientKnowledge] = useState("");
  const [crossFunctional, setCrossFunctional] = useState("");
  const [successContribution, setSuccessContribution] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);
  const [genAppDialogOpen, setGenAppDialogOpen] = useState(false);
  const [genAppDialogShown, setGenAppDialogShown] = useState(false);

  /* ── fetch project info ────────────────────────────────── */
  const { data: project, isLoading: projLoading } = useQuery({
    queryKey: ["project-detail", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects").select("*").eq("id", projectId!).single();
      if (error) throw error;
      return data as unknown as ProjectInfo;
    },
    enabled: !!projectId,
  });

  const { data: client } = useQuery({
    queryKey: ["client-detail", project?.client_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients").select("*").eq("id", project!.client_id).single();
      if (error) throw error;
      return data as unknown as ClientInfo;
    },
    enabled: !!project?.client_id,
  });

  /* ── fetch coordinator name ─────────────────────────────── */
  const { data: coordProfile } = useQuery({
    queryKey: ["coordinator-for-app", project?.coordinator_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, first_name, last_name")
        .eq("user_id", project!.coordinator_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!project?.coordinator_id,
  });

  const coordinatorName = coordProfile
    ? (coordProfile.display_name || [coordProfile.first_name, coordProfile.last_name].filter(Boolean).join(" ") || null)
    : null;

  /* ── fetch user's general application ──────────────────── */
  const { data: genApp, isSuccess: genAppLoaded } = useQuery({
    queryKey: ["general-app-for-review", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("general_applications")
        .select("*")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as Record<string, unknown> | null;
    },
    enabled: !!user,
  });

  /* ── fetch user's profile for step 1 review ───────────── */
  const { data: userProfile } = useQuery({
    queryKey: ["profile-for-review", user?.id],
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

  const { data: existingApp, isLoading: appLoading } = useQuery({
    queryKey: ["project-application", user?.id, projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_applications")
        .select("*")
        .eq("user_id", user!.id)
        .eq("project_id", projectId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ProjectApp | null;
    },
    enabled: !!user && !!projectId,
  });

  /* populate form from existing app */
  useEffect(() => {
    if (existingApp && !initialized) {
      setTeamHatsInterest(existingApp.team_hats_interest ?? []);
      setParticipatedPrev(existingApp.participated_previous_phase ?? false);
      setPrevPosition(existingApp.previous_phase_position ?? "");
      setPrevLearnings(existingApp.previous_phase_learnings ?? "");
      setPrevHelpTeammates(existingApp.previous_phase_help_teammates ?? "");
      setPriorPreparation(existingApp.prior_engagement_preparation ?? "");
      setPassion(existingApp.passion_for_project ?? "");
      setClientKnowledge(existingApp.client_project_knowledge ?? "");
      setCrossFunctional(existingApp.cross_functional_contribution ?? "");
      setSuccessContribution(existingApp.project_success_contribution ?? "");
      setStep(existingApp.status === "completed" ? 1 : existingApp.current_step);
      setInitialized(true);
    }
    if (!existingApp && !appLoading && !initialized) {
      setInitialized(true);
    }
  }, [existingApp, appLoading, initialized]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [step]);

  const isCompleted = existingApp?.status === "completed";

  /* ── helpers ───────────────────────────────────────────── */
  const typeLabel = (v: string) => PROJECT_TYPES.find((t) => t.value === v)?.label ?? v;
  const phaseLabel = (v: string) => PROJECT_PHASES.find((p) => p.value === v)?.label ?? v;

  /* ── push page context into the global header ──────────── */
  const { setHeader } = usePageHeader();
  const headline = client?.name
    ? (project?.friendly_name?.trim() ? `${client.name} — ${project.friendly_name}` : client.name)
    : undefined;
  const description = headline
    ? `${headline} — ${typeLabel(project?.project_type ?? "")} · ${phaseLabel(project?.phase ?? "")}`
    : undefined;

  useLayoutEffect(() => {
    if (!project) return;
    setHeader({
      breadcrumbs: [
        { label: "Project Openings", href: "/project-openings" },
        { label: "Project Overview", href: `/project-openings/${projectId}` },
        { label: "Create Application" },
      ],
      title: "Project Application",
      description,
      badge:
        isCompleted && existingApp?.completed_at ? (
          <Badge className="bg-success/10 text-success border-success/30 gap-1.5 whitespace-nowrap text-xs">
            <CheckCircle2 className="h-3 w-3" />
            Submitted {format(new Date(existingApp.completed_at), "MMM d, yyyy")}
          </Badge>
        ) : undefined,
    });
    return () => setHeader(null);
  }, [project, client, isCompleted, existingApp?.completed_at, projectId, setHeader, description]);

  /* ── available team hats scoped to project ─────────────── */
  const availableHats = useMemo(
    () => (project?.team_hats ?? TEAM_HATS.map(String)).map((h) => ({ label: h, value: h })),
    [project],
  );

  /* ── collect form data ─────────────────────────────────── */
  const collectFields = useCallback(() => ({
    team_hats_interest: teamHatsInterest,
    participated_previous_phase: participatedPrev,
    previous_phase_position: prevPosition,
    previous_phase_learnings: prevLearnings,
    previous_phase_help_teammates: prevHelpTeammates,
    prior_engagement_preparation: priorPreparation,
    passion_for_project: passion,
    client_project_knowledge: clientKnowledge,
    cross_functional_contribution: crossFunctional,
    project_success_contribution: successContribution,
  }), [teamHatsInterest, participatedPrev, prevPosition, prevLearnings, prevHelpTeammates, priorPreparation, passion, clientKnowledge, crossFunctional, successContribution]);

  /* ── save draft mutation ───────────────────────────────── */
  const saveMutation = useMutation({
    mutationFn: async (opts: { fields: Record<string, unknown>; newStep?: number; submit?: boolean }) => {
      const payload: Record<string, unknown> = sanitizeRecordFields({
        ...opts.fields,
        current_step: opts.newStep ?? step,
      });
      if (opts.submit) {
        payload.status = "completed";
        payload.completed_at = new Date().toISOString();
      }

      if (existingApp) {
        const result = await supabase
          .from("project_applications")
          .update(payload as any)
          .eq("id", existingApp.id)
          .select("id");
        if (result.error) throw result.error;
        assertWritten(result, "project-application.update", { id: existingApp.id });
      } else {
        const result = await supabase
          .from("project_applications")
          .insert({
            user_id: user!.id,
            project_id: projectId!,
            ...payload,
          } as any)
          .select("id");
        if (result.error) throw result.error;
        assertWritten(result, "project-application.insert", { projectId });
      }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["project-application", user?.id, projectId] });
      queryClient.invalidateQueries({ queryKey: ["my-project-apps-for-openings", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["my-project-apps-count", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["my-project-applications", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["project-opening-app-stats"] });
      queryClient.invalidateQueries({ queryKey: ["public-project-openings"] });
      queryClient.invalidateQueries({ queryKey: ["public-project-detail", projectId] });
      if (vars.submit) {
        setCelebrationOpen(true);
        // Fire-and-forget Discord notification for project application
        const profileData = userProfile as Record<string, string> | undefined;
        const displayName = profileData?.display_name || profileData?.first_name || "A member";
        const discord = profileData?.discord_username || undefined;
        const discordId = profileData?.discord_user_id || undefined;
        const projectName = client?.name ? `${client.name} (${typeLabel(project?.project_type ?? "")})` : "a project";
        DiscordNotifyService.projectApplied(displayName, projectName, discord, discordId);
      } else {
        toast.success("Draft saved — you can resume anytime");
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  /* ── validation ────────────────────────────────────────── */
  const validateStep2 = useCallback(() => {
    const errs: Record<string, string> = {};
    if (teamHatsInterest.length === 0) errs.team_hats_interest = "Select at least one team hat";
    if (participatedPrev) {
      if (!prevPosition.trim()) errs.previous_phase_position = "Required";
      if (!prevLearnings.trim()) errs.previous_phase_learnings = "Required";
      if (!prevHelpTeammates.trim()) errs.previous_phase_help_teammates = "Required";
    } else {
      if (!priorPreparation.trim()) errs.prior_engagement_preparation = "Required";
    }
    return errs;
  }, [teamHatsInterest, participatedPrev, prevPosition, prevLearnings, prevHelpTeammates, priorPreparation]);

  const validateStep3 = useCallback(() => {
    const errs: Record<string, string> = {};
    if (!passion.trim()) errs.passion_for_project = "Required";
    if (!clientKnowledge.trim()) errs.client_project_knowledge = "Required";
    if (!crossFunctional.trim()) errs.cross_functional_contribution = "Required";
    if (!successContribution.trim()) errs.project_success_contribution = "Required";
    return errs;
  }, [passion, clientKnowledge, crossFunctional, successContribution]);

  /* ── error toast helper ─────────────────────────────────── */
  // Centralized: same toast + auto-scroll/focus pattern used by every
  // other form in the app.
  const PROJECT_APPLICATION_LABELS: Record<string, string> = {
    team_hats_interest: "Team Hats selection",
    previous_phase_position: "Previous phase position",
    previous_phase_learnings: "Previous phase learnings",
    previous_phase_help_teammates: "How you'll help teammates",
    prior_engagement_preparation: "Prior engagement preparation",
    passion_for_project: "Passion for project",
    client_project_knowledge: "Client & project knowledge",
    cross_functional_contribution: "Cross-functional contribution",
    project_success_contribution: "Project success contribution",
  };
  const PROJECT_APPLICATION_GUIDANCE: Record<string, string> = {
    team_hats_interest: "Pick at least one Team Hat from the list.",
    previous_phase_position: "Describe the role you held in your previous phase.",
    previous_phase_learnings: "Share at least one specific takeaway.",
    previous_phase_help_teammates: "Explain how you'll support teammates.",
    prior_engagement_preparation: "Outline what you've done to prepare.",
    passion_for_project: "Explain what excites you about the project.",
    client_project_knowledge: "Show what you know about the client.",
    cross_functional_contribution: "Describe how you'll work across roles.",
    project_success_contribution: "Describe how you'll drive project success.",
  };
  const showValidationErrorToast = useCallback((errs: Record<string, string>) => {
    showFormErrors(errs, PROJECT_APPLICATION_LABELS, PROJECT_APPLICATION_GUIDANCE);
    scrollToFirstError();
  }, []);

  /* ── navigation ────────────────────────────────────────── */
  const handleNext = useCallback(() => {
    if (step === 1) {
      saveMutation.mutate({ fields: collectFields(), newStep: 2 });
      setStep(2);
      return;
    }
    if (step === 2) {
      const errs = validateStep2();
      if (Object.keys(errs).length > 0) { setErrors(errs); showValidationErrorToast(errs); return; }
      setErrors({});
      saveMutation.mutate({ fields: collectFields(), newStep: 3 });
      setStep(3);
      return;
    }
    if (step === 3) {
      const errs3 = validateStep3();
      if (Object.keys(errs3).length > 0) { setErrors(errs3); showValidationErrorToast(errs3); return; }
      setErrors({});
      saveMutation.mutate({ fields: collectFields(), newStep: 4 });
      setStep(4);
      return;
    }
    if (step === 4) {
      const errs2 = validateStep2();
      const errs3 = validateStep3();
      const allErrs = { ...errs2, ...errs3 };
      if (Object.keys(allErrs).length > 0) { setErrors(allErrs); showValidationErrorToast(allErrs); return; }
      setErrors({});
      saveMutation.mutate({ fields: collectFields(), submit: true });
    }
  }, [step, collectFields, saveMutation, validateStep2, validateStep3, showValidationErrorToast]);

  const handleSubmit = useCallback(() => {
    const errs2 = validateStep2();
    const errs3 = validateStep3();
    const allErrs = { ...errs2, ...errs3 };
    if (Object.keys(allErrs).length > 0) { setErrors(allErrs); showValidationErrorToast(allErrs); return; }
    setErrors({});
    saveMutation.mutate({ fields: collectFields(), submit: true });
  }, [collectFields, validateStep2, validateStep3, saveMutation, showValidationErrorToast]);

  const handleBack = useCallback(() => {
    if (step > 1) {
      saveMutation.mutate({ fields: collectFields(), newStep: step - 1 });
      setStep(step - 1);
    }
  }, [step, collectFields, saveMutation]);

  const handleSaveDraft = useCallback(() => {
    saveMutation.mutate({ fields: collectFields(), newStep: step });
  }, [collectFields, step, saveMutation]);

  // ── Autosave: 30s, drafts only ─────────────────────────────────────────
  const autosaveValue = useMemo(
    () => ({ ...collectFields(), current_step: step }),
    [collectFields, step],
  );
  const autosave = useAutosave({
    value: autosaveValue,
    enabled: !!user && !!projectId && initialized && !isCompleted && step > 1,
    label: "project-application",
    onSave: async (fields) => {
      const payload: Record<string, unknown> = sanitizeRecordFields(fields);
      if (existingApp) {
        const result = await supabase
          .from("project_applications")
          .update(payload as any)
          .eq("id", existingApp.id)
          .select("id");
        if (result.error) throw result.error;
        assertWritten(result, "project-application.autosave", { id: existingApp.id });
      } else {
        const result = await supabase
          .from("project_applications")
          .insert({ user_id: user!.id, project_id: projectId!, ...payload } as any)
          .select("id");
        if (result.error) throw result.error;
        assertWritten(result, "project-application.autosave.insert", { projectId });
        queryClient.invalidateQueries({ queryKey: ["project-application", user?.id, projectId] });
      }
    },
  });


  const handleSaveCompleted = useCallback(() => {
    const errs2 = validateStep2();
    const errs3 = validateStep3();
    const allErrs = { ...errs2, ...errs3 };
    if (Object.keys(allErrs).length > 0) { setErrors(allErrs); showValidationErrorToast(allErrs); return; }
    setErrors({});
    saveMutation.mutate({ fields: collectFields(), submit: true });
  }, [collectFields, validateStep2, validateStep3, saveMutation]);

  /* Check if all fields are filled for submit button state */
  const isSubmitReady = useMemo(() => {
    const errs2 = validateStep2();
    const errs3 = validateStep3();
    return Object.keys(errs2).length === 0 && Object.keys(errs3).length === 0;
  }, [validateStep2, validateStep3]);

  const genAppComplete = genApp?.status === "completed" || genApp?.status === "submitted";

  /* Show dialog once when general app is not completed — only after query has resolved */
  useEffect(() => {
    if (!genAppDialogShown && genAppLoaded && !genAppComplete && initialized) {
      setGenAppDialogOpen(true);
      setGenAppDialogShown(true);
    }
  }, [genAppLoaded, genAppComplete, initialized, genAppDialogShown]);

  if (authLoading || !user || !profileLoaded || projLoading || appLoading || !initialized) {
    return (
      <div className="container-app py-12" role="status" aria-live="polite" aria-busy="true">
        <div className="space-y-4 max-w-3xl mx-auto">
          <div className="h-8 w-48 rounded-md bg-muted animate-pulse" />
          <div className="h-28 rounded-md bg-muted animate-pulse" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="h-36 rounded-md bg-muted animate-pulse" />
            <div className="h-36 rounded-md bg-muted animate-pulse" />
          </div>
          <span className="sr-only">Loading project application…</span>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="container-app py-12 text-center">
        <p className="text-muted-foreground">Project not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/project-openings")}>
          Back to Openings
        </Button>
      </div>
    );
  }

  const isSaving = saveMutation.isPending;

  return (
    <div className="relative">
      {/* General Application Warning Dialog */}
      <Dialog open={genAppDialogOpen} onOpenChange={() => { /* mandatory — cannot dismiss */ }}>
        <DialogContent onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()} className="[&>button[class*='close']]:hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">General Application Required
            </DialogTitle>
            <DialogDescription>
              You must complete your General Application before submitting a project application. Admins review it alongside project applications to evaluate your readiness.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => navigate("/applications/general")}>
              Go to General Application
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FlowMobileNav backTo="/project-openings" backLabel="Back to Openings" title="Project Application" />

      <div className="sticky top-[65px] z-20 border-b bg-background px-4 sm:px-6 py-3 md:top-0">
        <div className="max-w-3xl w-full mx-auto">
        <StepProgressBar
          steps={STEP_LABELS.map((label, i) => {
            const stepNum = i + 1;
            const status = isCompleted || step > stepNum
              ? "completed"
              : step === stepNum
                ? "started"
                : "not_started";
            return { label, status };
          })}
          currentStep={step}
          onStepClick={(s) => {
            if (s === step) return;
            // Soft-warn when jumping forward past an unvalidated step.
            if (!isCompleted && s > step) {
              const errs2 = s >= 2 ? validateStep2() : {};
              const errs3 = s >= 3 ? validateStep3() : {};
              const missing = Object.keys(errs2).length + Object.keys(errs3).length;
              if (missing > 0) {
                toast.info(`You can fill this out, but earlier steps still have ${missing} field${missing === 1 ? "" : "s"} to complete.`);
              }
            }
            setErrors({});
            setStep(s);
            // Persist progress so refresh lands here.
            saveMutation.mutate({ fields: collectFields(), newStep: s });
          }}
        />
        </div>
      </div>

      {/* ── Content ────────────────────────────── */}
      <div ref={scrollRef}>
        <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
          {step === 1 && (
          <Card>
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <ProjectOpeningHeading
                  clientName={client?.name}
                  friendlyName={project?.friendly_name}
                  size="md"
                  as="p"
                />
                <Badge className="bg-warning/10 text-warning border-warning/20 shrink-0">Apply Now</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{typeLabel(project.project_type)} · {phaseLabel(project.phase)}</p>
              {client && (
                <div className="space-y-2 text-sm pt-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Globe className="h-3.5 w-3.5 shrink-0" />
                    <a href={client.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">
                      {(() => { try { return new URL(client.website).hostname; } catch { return client.website; } })()}
                      <ExternalLink className="h-3 w-3 inline ml-1" />
                    </a>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <User className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{client.primary_contact}</span>
                  </div>
                </div>
              )}
              {coordinatorName && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Project Coordinator</p>
                  <p className="text-sm text-foreground font-medium">{coordinatorName}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Team Hats</p>
                <div className="flex flex-wrap gap-1">
                  {project.team_hats.map((h) => <Badge key={h} variant="outline" className="text-xs">{h}</Badge>)}
                </div>
              </div>
            </CardContent>
          </Card>
          )}

          {/* ── STEP 1: Review General App ────────────────── */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="rounded-lg border bg-card p-6 space-y-4">
                <h2 className="text-lg font-semibold text-foreground">Step 1: Review General App</h2>
                <p className="text-sm text-muted-foreground">
                  Please review your general application below before proceeding. If anything needs updating, go to the General App to make edits.
                </p>
              </div>

              {genApp ? (
                <>
                  <div className="rounded-lg border bg-card p-6 space-y-4">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Profile Information</h3>
                    <ReadOnlyField label="Name" value={`${(userProfile?.first_name as string) ?? ""} ${(userProfile?.last_name as string) ?? ""}`.trim()} />
                    <ReadOnlyField label="Email" value={(genApp.email as string) ?? ""} />
                    <ReadOnlyField label="Country" value={(userProfile?.country as string) ?? ""} />
                    <ReadOnlyField label="Timezone" value={(userProfile?.timezone as string) ?? ""} />
                    <ReadOnlyField label="LinkedIn" value={(genApp.linkedin_url as string) ?? ""} />
                    <ReadOnlyField label="Portfolio" value={(genApp.portfolio_url as string) ?? ""} />
                    <ReadOnlyField label="Hours Commitment" value={(genApp.hours_commitment as string) ?? ""} />
                  </div>


                  <div className="rounded-lg border bg-card p-6 space-y-4">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Engagement History</h3>
                    <ReadOnlyField label="Previous engagement with Tech Fleet" value={(genApp.previous_engagement as string) ?? ""} />
                    <ReadOnlyArrayField label="Previous engagement ways" items={(genApp.previous_engagement_ways as string[]) ?? []} />
                    <ReadOnlyField label="What have you learned from teammates?" value={(genApp.teammate_learnings as string) ?? ""} />
                  </div>

                  <div className="rounded-lg border bg-card p-6 space-y-4">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Agile Mindset</h3>
                    <ReadOnlyField label="Agile vs Waterfall" value={(genApp.agile_vs_waterfall as string) ?? ""} />
                    <ReadOnlyField label="Psychological Safety" value={(genApp.psychological_safety as string) ?? ""} />
                    <ReadOnlyField label="Agile Philosophies" value={(genApp.agile_philosophies as string) ?? ""} />
                    <ReadOnlyField label="Collaboration Challenges" value={(genApp.collaboration_challenges as string) ?? ""} />
                  </div>

                  <div className="rounded-lg border bg-card p-6 space-y-4">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Service Leadership</h3>
                    <ReadOnlyField label="Servant Leadership Definition" value={(genApp.servant_leadership_definition as string) ?? ""} />
                    <ReadOnlyField label="Servant Leadership Actions" value={(genApp.servant_leadership_actions as string) ?? ""} />
                    <ReadOnlyField label="Servant Leadership Challenges" value={(genApp.servant_leadership_challenges as string) ?? ""} />
                    <ReadOnlyField label="Servant Leadership Situation" value={(genApp.servant_leadership_situation as string) ?? ""} />
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-6 text-center space-y-3">
                  <AlertTriangle className="h-8 w-8 text-warning mx-auto" />
                  <p className="text-sm font-medium text-foreground">General Application Required</p>
                  <p className="text-sm text-muted-foreground">You must complete your General Application before you can proceed with a project application.</p>
                  <Button onClick={() => navigate("/applications/general")} className="mt-2">
                    Go to General Application
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Project Questions ─────────────────── */}
          {step === 2 && (
            <div className="rounded-lg border bg-card p-6 space-y-5">
              <h2 className="text-lg font-semibold text-foreground">Step 2: Project Questions</h2>

              <div className="space-y-1.5">
                <Label>Select all of the team hats you want to contribute to on the project <span className="text-destructive">*</span></Label>
                <MultiSelect
                  options={availableHats}
                  selected={teamHatsInterest}
                  onChange={setTeamHatsInterest}
                  placeholder="Select team hats..."
                />
                {errors.team_hats_interest && <p className="text-xs text-destructive">{errors.team_hats_interest}</p>}
              </div>

              <Separator />

              <div className="space-y-2">
                <Label className="text-foreground font-semibold">
                  Did you participate in a previous phase of this project? <span className="text-destructive">*</span>
                </Label>
                <RadioGroup
                  value={participatedPrev ? "yes" : "no"}
                  onValueChange={(v) => setParticipatedPrev(v === "yes")}
                  className="flex gap-6"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="no" id="prev-phase-no" />
                    <Label htmlFor="prev-phase-no" className="text-foreground font-medium cursor-pointer">No</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="yes" id="prev-phase-yes" />
                    <Label htmlFor="prev-phase-yes" className="text-foreground font-medium cursor-pointer">Yes</Label>
                  </div>
                </RadioGroup>
              </div>

              {participatedPrev ? (
                <div className="space-y-4 pl-1 border-l-2 border-primary/20 ml-2 pl-4">
                   <div className="space-y-1.5">
                     <Label htmlFor="prev-position">What team position did you join in the previous phase? <span className="text-destructive">*</span></Label>
                     <Textarea id="prev-position" value={prevPosition} onChange={(e) => setPrevPosition(e.target.value)} rows={2} maxLength={5000} aria-describedby="prev-position-count" />
                     <p id="prev-position-count" className="text-xs text-muted-foreground text-right">{prevPosition.length} / 5,000</p>
                     {errors.previous_phase_position && <p className="text-xs text-destructive">{errors.previous_phase_position}</p>}
                   </div>
                   <div className="space-y-1.5">
                     <Label htmlFor="prev-learnings">What did you learn in the previous phase? <span className="text-destructive">*</span></Label>
                     <Textarea id="prev-learnings" value={prevLearnings} onChange={(e) => setPrevLearnings(e.target.value)} rows={3} maxLength={5000} aria-describedby="prev-learnings-count" />
                     <p id="prev-learnings-count" className="text-xs text-muted-foreground text-right">{prevLearnings.length} / 5,000</p>
                     {errors.previous_phase_learnings && <p className="text-xs text-destructive">{errors.previous_phase_learnings}</p>}
                   </div>
                   <div className="space-y-1.5">
                     <Label htmlFor="prev-help">How will you help your teammates succeed in this upcoming phase? <span className="text-destructive">*</span></Label>
                     <Textarea id="prev-help" value={prevHelpTeammates} onChange={(e) => setPrevHelpTeammates(e.target.value)} rows={3} maxLength={5000} aria-describedby="prev-help-count" />
                     <p id="prev-help-count" className="text-xs text-muted-foreground text-right">{prevHelpTeammates.length} / 5,000</p>
                     {errors.previous_phase_help_teammates && <p className="text-xs text-destructive">{errors.previous_phase_help_teammates}</p>}
                   </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="prior-prep">
                    How has your prior engagement (either in projects, in classes, or observing) in Tech Fleet community prepared you for this team role? <span className="text-destructive">*</span>
                  </Label>
                   <Textarea id="prior-prep" value={priorPreparation} onChange={(e) => setPriorPreparation(e.target.value)} rows={4} maxLength={5000} aria-describedby="prior-prep-count" />
                   <p id="prior-prep-count" className="text-xs text-muted-foreground text-right">{priorPreparation.length} / 5,000</p>
                   {errors.prior_engagement_preparation && <p className="text-xs text-destructive">{errors.prior_engagement_preparation}</p>}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Client Questions ──────────────────── */}
          {step === 3 && (
            <div className="rounded-lg border bg-card p-6 space-y-5">
              <h2 className="text-lg font-semibold text-foreground">Step 3: Client Questions</h2>

              <div className="space-y-1.5">
                <Label htmlFor="passion">Why are you passionate about being on this project? <span className="text-destructive">*</span></Label>
                 <Textarea id="passion" value={passion} onChange={(e) => setPassion(e.target.value)} rows={4} maxLength={5000} aria-describedby="passion-count" />
                 <p id="passion-count" className="text-xs text-muted-foreground text-right">{passion.length} / 5,000</p>
                 {errors.passion_for_project && <p className="text-xs text-destructive">{errors.passion_for_project}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="client-knowledge">
                  What do you know about the client and the project that you're applying to? Tell us about it. <span className="text-destructive">*</span>
                </Label>
                 <Textarea id="client-knowledge" value={clientKnowledge} onChange={(e) => setClientKnowledge(e.target.value)} rows={4} maxLength={5000} aria-describedby="client-knowledge-count" />
                 <p id="client-knowledge-count" className="text-xs text-muted-foreground text-right">{clientKnowledge.length} / 5,000</p>
                 {errors.client_project_knowledge && <p className="text-xs text-destructive">{errors.client_project_knowledge}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cross-functional">
                  How would you like to contribute to cross-functional teamwork on the team? <span className="text-destructive">*</span>
                </Label>
                 <Textarea id="cross-functional" value={crossFunctional} onChange={(e) => setCrossFunctional(e.target.value)} rows={4} maxLength={5000} aria-describedby="cross-functional-count" />
                 <p id="cross-functional-count" className="text-xs text-muted-foreground text-right">{crossFunctional.length} / 5,000</p>
                 {errors.cross_functional_contribution && <p className="text-xs text-destructive">{errors.cross_functional_contribution}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="success-contribution">
                  How will you contribute to this project's successful outcomes as an apprentice or a co-lead and as a teammate? <span className="text-destructive">*</span>
                </Label>
                 <Textarea id="success-contribution" value={successContribution} onChange={(e) => setSuccessContribution(e.target.value)} rows={4} maxLength={5000} aria-describedby="success-contribution-count" />
                 <p id="success-contribution-count" className="text-xs text-muted-foreground text-right">{successContribution.length} / 5,000</p>
                 {errors.project_success_contribution && <p className="text-xs text-destructive">{errors.project_success_contribution}</p>}
              </div>
            </div>
          )}

          {/* ── STEP 4: Review & Submit ───────────────────── */}
          {step === 4 && (() => {
            const s2Errs = validateStep2();
            const s3Errs = validateStep3();
            const s2HasErr = Object.keys(s2Errs).length > 0;
            const s3HasErr = Object.keys(s3Errs).length > 0;
            const totalIncomplete = (s2HasErr ? 1 : 0) + (s3HasErr ? 1 : 0);
            return (
              <div className="space-y-6">
                <div className="rounded-lg border bg-card p-6 space-y-2">
                  <h2 className="text-lg font-semibold text-foreground">Step 4: Review &amp; Submit</h2>
                  <p className="text-sm text-muted-foreground">
                    Please review your answers below before submitting. Click <strong>Edit</strong> on any section to make changes.
                  </p>
                  {totalIncomplete > 0 && (
                    <p className="text-sm text-destructive flex items-center gap-1.5 pt-1">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {totalIncomplete} {totalIncomplete === 1 ? "section needs" : "sections need"} to be completed before you can submit.
                    </p>
                  )}
                </div>

                {/* Section: Project Questions */}
                <div className="rounded-lg border bg-card p-6 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-semibold text-foreground">Step 2: Project Questions</h3>
                      {s2HasErr ? (
                        <Badge variant="destructive" className="text-xs gap-1">
                          <AlertCircle className="h-3 w-3" /> Incomplete
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs gap-1 bg-success/10 text-success border-success/30">
                          <CheckCircle2 className="h-3 w-3" /> Complete
                        </Badge>
                      )}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => { setErrors({}); setStep(2); }} className="gap-1.5 text-xs">
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                  </div>
                  <ReadOnlyArrayField label="Team Hats of Interest" items={teamHatsInterest} />
                  <ReadOnlyField label="Participated in a previous phase" value={participatedPrev ? "Yes" : "No"} />
                  {participatedPrev ? (
                    <>
                      <ReadOnlyField label="Previous phase position" value={prevPosition} />
                      <ReadOnlyField label="Previous phase learnings" value={prevLearnings} />
                      <ReadOnlyField label="How you'll help teammates" value={prevHelpTeammates} />
                    </>
                  ) : (
                    <ReadOnlyField label="Prior engagement preparation" value={priorPreparation} />
                  )}
                </div>

                {/* Section: Client Questions */}
                <div className="rounded-lg border bg-card p-6 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-semibold text-foreground">Step 3: Client Questions</h3>
                      {s3HasErr ? (
                        <Badge variant="destructive" className="text-xs gap-1">
                          <AlertCircle className="h-3 w-3" /> Incomplete
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs gap-1 bg-success/10 text-success border-success/30">
                          <CheckCircle2 className="h-3 w-3" /> Complete
                        </Badge>
                      )}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => { setErrors({}); setStep(3); }} className="gap-1.5 text-xs">
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                  </div>
                  <ReadOnlyField label="Why are you passionate about this project?" value={passion} />
                  <ReadOnlyField label="What do you know about the client and the project?" value={clientKnowledge} />
                  <ReadOnlyField label="How will you contribute to cross-functional teamwork?" value={crossFunctional} />
                  <ReadOnlyField label="How will you contribute to the project's success?" value={successContribution} />
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Sticky Footer Actions ─────────────────────────── */}
      <div className="sticky bottom-0 z-20 border-t bg-background px-4 sm:px-6 py-3">
        <div className="max-w-3xl w-full mx-auto flex items-center justify-between gap-3">
          {/* Left side */}
          <div className="flex items-center gap-2">
            {step === 1 && (
              <Button onClick={() => navigate("/applications/general")} disabled={isSaving}>
                Edit your general application
              </Button>
            )}
            {step > 1 && (
              <Button onClick={handleBack} disabled={isSaving}>
                Go back
              </Button>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <AutosaveStatus
              status={autosave.status}
              lastSavedAt={autosave.lastSavedAt}
              onRetry={autosave.retry}
            />

            {/* Save Draft — always available on steps 2 & 3 when not completed */}
            {!isCompleted && step > 1 && (
              <Button variant="secondary" onClick={handleSaveDraft} disabled={isSaving}>
                {isSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Save draft
              </Button>
            )}

            {/* Save Changes for completed apps */}
            {isCompleted && (
              <Button variant="secondary" onClick={handleSaveCompleted} disabled={isSaving}>
                {isSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Save changes
              </Button>
            )}

            {/* Step 1: Continue */}
            {step === 1 && (
              <Button onClick={handleNext} disabled={isSaving || !genAppComplete}>
                {isSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Continue to step 2
              </Button>
            )}

            {/* Steps 2 & 3: Next */}
            {(step === 2 || step === 3) && !isCompleted && (
              <Button onClick={handleNext} disabled={isSaving}>
                {isSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Continue
              </Button>
            )}

            {/* Step 4: Submit — blue only when all fields entered */}
            {step === 4 && !isCompleted && (
              <Button
                onClick={handleSubmit}
                disabled={isSaving || !isSubmitReady}
                variant={isSubmitReady ? "default" : "outline"}
              >
                {isSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Submit application
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Celebration dialog ────────────────────────────── */}
      <Dialog open={celebrationOpen} onOpenChange={setCelebrationOpen}>
        <DialogContent className="sm:max-w-md text-center">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-center gap-2 text-xl">Application submitted
            </DialogTitle>
            <DialogDescription>
              Your application for {client?.name}{project?.friendly_name?.trim() ? ` — ${project.friendly_name.trim()}` : ""} is in. The team will review it and follow up soon.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="justify-center sm:justify-center pt-2">
            <Button onClick={() => { setCelebrationOpen(false); navigate("/project-openings"); }}>
              Browse open projects
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
