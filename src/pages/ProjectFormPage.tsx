import { useState, useMemo, useCallback } from "react";
import { useAutosave } from "@/hooks/use-autosave";
import { AutosaveStatus } from "@/components/ui/AutosaveStatus";

import { useNavigate, useParams } from "react-router-dom";
import { DiscordRolePicker } from "@/components/DiscordRolePicker";
import { useQuery, useMutation, useQueryClient } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { showFormErrors, scrollToFirstError } from "@/lib/form-validation";

const PROJECT_FIELD_LABELS: Record<string, string> = {
  name: "Project name",
  client_id: "Client",
  status: "Status",
  start_date: "Start date",
  end_date: "End date",
  description: "Description",
  discord_role_ids: "Discord roles",
  coordinator_id: "Project coordinator",
};
const PROJECT_FIELD_GUIDANCE: Record<string, string> = {
  name: "Give the project a clear, recognizable title.",
  client_id: "Pick the client this project belongs to.",
  start_date: "Choose a date in the future.",
  end_date: "Must be on or after the start date.",
  description: "Summarize the project's goals and scope.",
  discord_role_ids: "Select at least one Discord role for participants.",
};
import { z } from "zod";
import { sanitizeRecordFields } from "@/lib/validators/shared-input";
import { format } from "date-fns";
import {
  Loader2, ArrowLeft, Globe, User, ExternalLink, CalendarIcon, AlertTriangle,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import { CharCountTextarea } from "@/components/ui/char-count-textarea";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  PROJECT_TYPES, PROJECT_PHASES, PROJECT_STATUSES, TEAM_HATS, MILESTONE_OPTIONS, TIMEZONE_RANGES,
  type ProjectTypeValue, type ProjectPhaseValue, type ProjectStatusValue,
} from "@/data/project-constants";
import { useMilestoneReference, computeMilestoneData } from "@/hooks/use-milestone-reference";
import type { Client } from "@/components/clients/ClientsTab";
import { cn } from "@/lib/utils";
import { reportValidationRejection } from "@/services/error-reporter.service";

// ---------- Helpers ----------
const optionalUrl = z.string().refine(
  (v) => v === "" || /^https?:\/\/.+/.test(v),
  { message: "Must be a valid URL starting with http:// or https://" },
);

// ---------- Schema ----------
const projectSchema = z.object({
  client_id: z.string().uuid("Select a client"),
  friendly_name: z.string().trim().max(200, "Keep it under 200 characters").default(""),
  description: z.string().max(5000, "Keep it under 5,000 characters").default(""),
  project_type: z.enum(["website_design", "service_design", "application_design", "strategy", "discovery"] as const),
  phase: z.enum(["phase_1", "phase_2", "phase_3", "phase_4"] as const),
  team_hats: z.array(z.string()).min(1, "Select at least one team hat"),
  project_status: z.enum(["coming_soon", "apply_now", "recruiting", "team_onboarding", "project_in_progress", "project_complete"] as const),
  current_phase_milestones: z.array(z.string()).min(1, "Select at least one milestone"),
  timezone_range: z.string().min(1, "Select a timezone range"),
  anticipated_start_date: z.string().nullable(),
  anticipated_end_date: z.string().nullable(),
  client_intake_url: optionalUrl,
  notion_repository_url: optionalUrl,
  discord_role_id: z.string().min(1, "Discord role is required"),
  discord_role_name: z.string().min(1, "Discord role is required"),
  coordinator_id: z.string().nullable(),
  requires_interview: z.boolean().default(true),
});

type ProjectForm = z.infer<typeof projectSchema>;

const EMPTY_FORM: ProjectForm = {
  client_id: "",
  friendly_name: "",
  description: "",
  project_type: "website_design",
  phase: "phase_1",
  team_hats: [],
  project_status: "coming_soon",
  current_phase_milestones: [],
  timezone_range: "",
  anticipated_start_date: null,
  anticipated_end_date: null,
  client_intake_url: "",
  notion_repository_url: "",
  discord_role_id: "",
  discord_role_name: "",
  coordinator_id: null,
  requires_interview: true,
};

export default function ProjectFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEditing = !!id;
  const navigate = useNavigate();
  const { user } = useAuth();
  // Admin access is enforced by AdminRoute wrapper
  const queryClient = useQueryClient();

  const [form, setForm] = useState<ProjectForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof ProjectForm, string>>>({});
  const [initialized, setInitialized] = useState(!isEditing);

  // Fetch existing project when editing.
  // Sensitive operational columns were revoked from authenticated for security
  // and must be re-merged via the admin/roster-gated RPC.
  const fetchProjectWithLinks = async () => {
    const [{ data, error }, { data: linkRows, error: linkErr }] = await Promise.all([
      supabase.from("projects").select("*").eq("id", id!).single(),
      supabase.rpc("get_project_internal_links", { p_project_id: id! }),
    ]);
    if (error) throw error;
    if (linkErr) throw linkErr;
    const links = (linkRows?.[0] ?? {}) as Record<string, string | null>;
    return { ...(data as Record<string, unknown>), ...links };
  };

  const { isLoading: projectLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: fetchProjectWithLinks,
    enabled: isEditing,
    meta: {
      onSettled: (data: any) => {
        if (data && !initialized) {
          setForm({
            client_id: data.client_id,
            friendly_name: (data as any).friendly_name ?? "",
            description: (data as any).description ?? "",
            project_type: data.project_type as ProjectTypeValue,
            phase: data.phase as ProjectPhaseValue,
            team_hats: data.team_hats ?? [],
            project_status: data.project_status as ProjectStatusValue,
            current_phase_milestones: data.current_phase_milestones ?? [],
            timezone_range: data.timezone_range ?? "",
            anticipated_start_date: data.anticipated_start_date ?? null,
            anticipated_end_date: data.anticipated_end_date ?? null,
            client_intake_url: data.client_intake_url ?? "",
            notion_repository_url: data.notion_repository_url ?? "",
            discord_role_id: (data as any).discord_role_id ?? "",
            discord_role_name: (data as any).discord_role_name ?? "",
            coordinator_id: (data as any).coordinator_id ?? null,
            requires_interview: (data as any).requires_interview ?? true,
          });
          setInitialized(true);
        }
      },
    },
  });

  // Workaround: useQuery doesn't support meta.onSettled in all versions
  const { data: existingProject } = useQuery({
    queryKey: ["project-init", id],
    queryFn: fetchProjectWithLinks,
    enabled: isEditing && !initialized,
    staleTime: 0,
    gcTime: 0,
  });

  if (existingProject && !initialized) {
    setForm({
      client_id: (existingProject as any).client_id,
      friendly_name: (existingProject as any).friendly_name ?? "",
      description: (existingProject as any).description ?? "",
      project_type: (existingProject as any).project_type as ProjectTypeValue,
      phase: (existingProject as any).phase as ProjectPhaseValue,
      team_hats: ((existingProject as any).team_hats ?? []) as string[],
      project_status: (existingProject as any).project_status as ProjectStatusValue,
      current_phase_milestones: ((existingProject as any).current_phase_milestones ?? []) as string[],
      timezone_range: (existingProject as any).timezone_range ?? "",
      anticipated_start_date: (existingProject as any).anticipated_start_date ?? null,
      anticipated_end_date: (existingProject as any).anticipated_end_date ?? null,
      client_intake_url: (existingProject as any).client_intake_url ?? "",
      notion_repository_url: (existingProject as any).notion_repository_url ?? "",
      discord_role_id: (existingProject as any).discord_role_id ?? "",
      discord_role_name: (existingProject as any).discord_role_name ?? "",
      coordinator_id: (existingProject as any).coordinator_id ?? null,
      requires_interview: (existingProject as any).requires_interview ?? true,
    });
    setInitialized(true);
  }

  // Fetch active clients
  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Client[];
    },
  });

  const activeClients = useMemo(() => clients.filter((c) => c.status === "active"), [clients]);

  // Fetch admins for coordinator picker
  const { data: adminUsers = [] } = useQuery({
    queryKey: ["admin-users-for-coordinator"],
    queryFn: async () => {
      // Get all admin user_ids
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");
      if (rolesError) throw rolesError;
      const adminIds = (roles ?? []).map((r) => r.user_id);
      if (adminIds.length === 0) return [];
      // Get profiles for those admins
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, display_name, first_name, last_name, email")
        .in("user_id", adminIds);
      if (profilesError) throw profilesError;
      return (profiles ?? []).map((p) => ({
        user_id: p.user_id,
        label: p.display_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Unknown",
      })).sort((a, b) => a.label.localeCompare(b.label));
    },
    enabled: !!user,
  });
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const selectedClient = useMemo(() => clientMap.get(form.client_id), [form.client_id, clientMap]);

  // For the "interview toggle" warning when admins flip an existing project from
  // requires_interview=true to false while applicants are mid-interview.
  const { data: midInterviewCount = 0 } = useQuery({
    queryKey: ["project-mid-interview-count", id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("project_applications")
        .select("id", { count: "exact", head: true })
        .eq("project_id", id!)
        .in("applicant_status", ["invited_to_interview", "interview_scheduled"]);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: isEditing && !!id,
  });
  const showInterviewToggleWarning =
    isEditing && !form.requires_interview && midInterviewCount > 0;

  // Milestone reference
  const { data: milestoneRefs = [] } = useMilestoneReference();
  const computed = useMemo(
    () => computeMilestoneData(form.current_phase_milestones, milestoneRefs),
    [form.current_phase_milestones, milestoneRefs],
  );

  // Fire-and-forget Discord project update notification
  const notifyProjectUpdate = useCallback(async (
    action: "created" | "updated",
    values: ProjectForm,
    projectId: string,
    changes?: string[],
  ) => {
    try {
      const clientName = clientMap.get(values.client_id)?.name || "Unknown Client";
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await supabase.functions.invoke("discord-project-update", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {
          action,
          project_id: projectId,
          client_name: clientName,
          project_type: values.project_type,
          project_status: values.project_status,
          phase: values.phase,
          team_hats: values.team_hats,
          timezone_range: values.timezone_range,
          anticipated_start_date: values.anticipated_start_date,
          anticipated_end_date: values.anticipated_end_date,
          current_phase_milestones: values.current_phase_milestones,
          changes,
        },
      });
    } catch {
      // non-critical — ignore
    }
  }, [clientMap]);

  // Compute human-readable change descriptions for update diffs
  const computeChanges = useCallback((oldData: any, newValues: ProjectForm): string[] => {
    const changes: string[] = [];
    const statusLabel = (v: string) => PROJECT_STATUSES.find((s) => s.value === v)?.label || v;
    const typeLabel = (v: string) => PROJECT_TYPES.find((t) => t.value === v)?.label || v;
    const phaseLabel = (v: string) => PROJECT_PHASES.find((p) => p.value === v)?.label || v;

    if (oldData.project_status !== newValues.project_status)
      changes.push(`Status changed from **${statusLabel(oldData.project_status)}** → **${statusLabel(newValues.project_status)}**`);
    if (oldData.phase !== newValues.phase)
      changes.push(`Phase changed from **${phaseLabel(oldData.phase)}** → **${phaseLabel(newValues.phase)}**`);
    if (oldData.project_type !== newValues.project_type)
      changes.push(`Type changed from **${typeLabel(oldData.project_type)}** → **${typeLabel(newValues.project_type)}**`);
    if (oldData.client_id !== newValues.client_id)
      changes.push(`Client changed to **${clientMap.get(newValues.client_id)?.name || "Unknown"}**`);

    const oldHats = (oldData.team_hats ?? []).sort().join(",");
    const newHats = [...newValues.team_hats].sort().join(",");
    if (oldHats !== newHats) changes.push(`Team roles updated to: ${newValues.team_hats.join(", ")}`);

    const oldMilestones = (oldData.current_phase_milestones ?? []).sort().join(",");
    const newMilestones = [...newValues.current_phase_milestones].sort().join(",");
    if (oldMilestones !== newMilestones) changes.push(`Milestones updated`);

    if (oldData.timezone_range !== newValues.timezone_range) changes.push(`Timezone range updated`);
    if (oldData.anticipated_start_date !== newValues.anticipated_start_date) changes.push(`Start date updated`);
    if (oldData.anticipated_end_date !== newValues.anticipated_end_date) changes.push(`End date updated`);
    if (oldData.client_intake_url !== newValues.client_intake_url) changes.push(`Client intake URL updated`);
    if (oldData.notion_repository_url !== newValues.notion_repository_url) changes.push(`Repository URL updated`);

    return changes;
  }, [clientMap]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (values: ProjectForm) => {
      const { data, error } = await supabase.from("projects").insert(sanitizeRecordFields({ ...values, created_by: user!.id }) as any).select("id").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data, values) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", data.id] });
      queryClient.invalidateQueries({ queryKey: ["project-init", data.id] });
      toast.success("Project created");
      notifyProjectUpdate("created", values, data.id);
      navigate("/admin/clients?tab=projects");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (values: ProjectForm) => {
      const { error } = await supabase.from("projects").update(sanitizeRecordFields(values as unknown as Record<string, unknown>) as any).eq("id", id!);
      if (error) throw error;
    },
    onSuccess: (_, values) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", id] });
      queryClient.invalidateQueries({ queryKey: ["project-init", id] });
      toast.success("Project updated");
      const changes = existingProject ? computeChanges(existingProject, values) : [];
      notifyProjectUpdate("updated", values, id!, changes);
      navigate("/admin/clients?tab=projects");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSubmit = useCallback(() => {
    const result = projectSchema.safeParse(form);
    if (!result.success) {
      reportValidationRejection("projectSchema", result.error.issues, "ProjectFormPage.handleSubmit");
      const fieldErrors: Partial<Record<keyof ProjectForm, string>> = {};
      result.error.issues.forEach((i) => {
        const k = i.path[0] as keyof ProjectForm;
        if (!fieldErrors[k]) fieldErrors[k] = i.message;
      });
      setErrors(fieldErrors);
      showFormErrors(fieldErrors as Record<string, string>, PROJECT_FIELD_LABELS, PROJECT_FIELD_GUIDANCE);
      scrollToFirstError();
      return;
    }
    setErrors({});
    isEditing ? updateMutation.mutate(result.data) : createMutation.mutate(result.data);
  }, [form, isEditing, createMutation, updateMutation]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isEditing && !initialized) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container-app py-8 sm:py-12 space-y-6 max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin/clients">Clients &amp; Projects</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{isEditing ? "Edit Project" : "Create Project"}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin/clients?tab=projects")} aria-label="Back to projects">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold text-foreground">
          {isEditing ? "Edit Project" : "Create Project"}
        </h1>
      </div>

      {/* Form */}
      <div className="rounded-lg border bg-card p-6 space-y-5">
        {/* Client */}
        <div className="space-y-1.5">
          <Label htmlFor="client-select">Client <span className="text-destructive">*</span></Label>
          <Select value={form.client_id} onValueChange={(v) => setForm((f) => ({ ...f, client_id: v }))}>
            <SelectTrigger id="client-select" aria-invalid={!!errors.client_id}><SelectValue placeholder="Select a client" /></SelectTrigger>
            <SelectContent>
              {activeClients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {errors.client_id && <p className="text-xs text-destructive">{errors.client_id}</p>}
        </div>

        {/* Read-only client info */}
        {selectedClient && (
          <div className="rounded-md border p-4 bg-muted/30 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Client Details</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <a href={selectedClient.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">
                  {(() => { try { return new URL(selectedClient.website).hostname; } catch { return selectedClient.website; } })()}
                  <ExternalLink className="h-3 w-3 inline ml-1" />
                </a>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <User className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{selectedClient.primary_contact}</span>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Mission</p>
              <p className="text-sm text-foreground mt-0.5">{selectedClient.mission}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Project Summary</p>
              <p className="text-sm text-foreground mt-0.5">{selectedClient.project_summary}</p>
            </div>
          </div>
        )}

        {/* Friendly Name (project nickname) */}
        <div className="space-y-1.5">
          <Label htmlFor="friendly-name">Project Nickname</Label>
          <Input
            id="friendly-name"
            type="text"
            maxLength={200}
            placeholder="e.g. Member Experience Team"
            value={form.friendly_name}
            onChange={(e) => setForm((f) => ({ ...f, friendly_name: e.target.value }))}
            aria-invalid={!!errors.friendly_name}
            aria-describedby="friendly-name-help"
          />
          <p id="friendly-name-help" className="text-xs text-muted-foreground">
            Shown after the client name as <span className="font-medium">[Client] — [Nickname]</span>. Max 200 characters.
          </p>
          {errors.friendly_name && <p className="text-xs text-destructive">{errors.friendly_name}</p>}
        </div>

        {/* Project Description (long form) */}
        <div className="space-y-1.5">
          <Label htmlFor="project-description">Project Description</Label>
          <CharCountTextarea
            id="project-description"
            placeholder="Describe the project's goals, scope, and what teammates can expect…"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            aria-invalid={!!errors.description}
          />
          {errors.description && <p className="text-xs text-destructive">{errors.description}</p>}
        </div>

        {/* Project Type */}
        <div className="space-y-1.5">
          <Label htmlFor="project-type">Project Type <span className="text-destructive">*</span></Label>
          <Select value={form.project_type} onValueChange={(v) => setForm((f) => ({ ...f, project_type: v as ProjectTypeValue }))}>
            <SelectTrigger id="project-type"><SelectValue /></SelectTrigger>
            <SelectContent>{PROJECT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {/* Phase */}
        <div className="space-y-1.5">
          <Label htmlFor="phase">Phase <span className="text-destructive">*</span></Label>
          <Select value={form.phase} onValueChange={(v) => setForm((f) => ({ ...f, phase: v as ProjectPhaseValue }))}>
            <SelectTrigger id="phase"><SelectValue /></SelectTrigger>
            <SelectContent>{PROJECT_PHASES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {/* Timezone Range */}
        <div className="space-y-1.5">
          <Label htmlFor="timezone-range">Timezone Range <span className="text-destructive">*</span></Label>
          <Select value={form.timezone_range} onValueChange={(v) => setForm((f) => ({ ...f, timezone_range: v }))}>
            <SelectTrigger id="timezone-range" aria-invalid={!!errors.timezone_range}><SelectValue placeholder="Select a timezone range" /></SelectTrigger>
            <SelectContent>
              {TIMEZONE_RANGES.map((tz) => <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {errors.timezone_range && <p className="text-xs text-destructive">{errors.timezone_range}</p>}
        </div>

        {/* Anticipated Date Range */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <Label>Anticipated Start Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left text-sm tracking-normal font-normal",
                    !form.anticipated_start_date && "text-muted-foreground",
                  )}
                >
                  {form.anticipated_start_date ? format(new Date(form.anticipated_start_date + "T00:00:00"), "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={form.anticipated_start_date ? new Date(form.anticipated_start_date + "T00:00:00") : undefined}
                  onSelect={(d) => setForm((f) => ({ ...f, anticipated_start_date: d ? format(d, "yyyy-MM-dd") : null }))}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1.5">
            <Label>Anticipated End Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left text-sm tracking-normal font-normal",
                    !form.anticipated_end_date && "text-muted-foreground",
                  )}
                >
                  {form.anticipated_end_date ? format(new Date(form.anticipated_end_date + "T00:00:00"), "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={form.anticipated_end_date ? new Date(form.anticipated_end_date + "T00:00:00") : undefined}
                  onSelect={(d) => setForm((f) => ({ ...f, anticipated_end_date: d ? format(d, "yyyy-MM-dd") : null }))}
                  disabled={(date) =>
                    form.anticipated_start_date ? date < new Date(form.anticipated_start_date + "T00:00:00") : false
                  }
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Team Hats */}
        <div className="space-y-1.5">
          <Label>Team Hats <span className="text-destructive">*</span></Label>
          <MultiSelect
            options={TEAM_HATS.map((h) => ({ label: h, value: h }))}
            selected={form.team_hats}
            onChange={(v) => setForm((f) => ({ ...f, team_hats: v }))}
            placeholder="Select team hats..."
          />
          {errors.team_hats && <p className="text-xs text-destructive">{errors.team_hats}</p>}
        </div>

        {/* Project Status */}
        <div className="space-y-1.5">
          <Label htmlFor="project-status">Project Status <span className="text-destructive">*</span></Label>
          <Select value={form.project_status} onValueChange={(v) => setForm((f) => ({ ...f, project_status: v as ProjectStatusValue }))}>
            <SelectTrigger id="project-status"><SelectValue /></SelectTrigger>
            <SelectContent>{PROJECT_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {/* Project Coordinator */}
        <div className="space-y-1.5">
          <Label htmlFor="coordinator-select">Project Coordinator</Label>
          <Select value={form.coordinator_id ?? "__none__"} onValueChange={(v) => setForm((f) => ({ ...f, coordinator_id: v === "__none__" ? null : v }))}>
            <SelectTrigger id="coordinator-select"><SelectValue placeholder="Select a coordinator" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No coordinator assigned</SelectItem>
              {adminUsers.map((a) => <SelectItem key={a.user_id} value={a.user_id}>{a.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Only admins can be assigned as project coordinators.</p>
        </div>

        {/* Interview Toggle */}
        <div className="space-y-2 rounded-md border p-4 bg-muted/20">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="requires-interview" className="text-sm font-medium">
                This project includes applicant interviews
              </Label>
              <p id="requires-interview-help" className="text-xs text-muted-foreground">
                Turn off if the coordinator selects teammates directly from applications without scheduling interviews.
              </p>
            </div>
            <Switch
              id="requires-interview"
              checked={form.requires_interview}
              onCheckedChange={(v) => setForm((f) => ({ ...f, requires_interview: v }))}
              aria-describedby="requires-interview-help"
            />
          </div>
          {showInterviewToggleWarning && (
            <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="text-foreground">
                {midInterviewCount} applicant{midInterviewCount === 1 ? " is" : "s are"} mid-interview.
                Their flow will continue; the change applies to new applicants only.
              </p>
            </div>
          )}
        </div>

        {/* Current Phase Milestones */}
        <div className="space-y-1.5">
          <Label>Current Phase Milestones <span className="text-destructive">*</span></Label>
          <MultiSelect
            options={MILESTONE_OPTIONS.map((m) => ({ label: m, value: m }))}
            selected={form.current_phase_milestones}
            onChange={(v) => setForm((f) => ({ ...f, current_phase_milestones: v }))}
            placeholder="Select milestones..."
          />
          {errors.current_phase_milestones && <p className="text-xs text-destructive">{errors.current_phase_milestones}</p>}
        </div>

        {/* Computed read-only fields */}
        {form.current_phase_milestones.length > 0 && (
          <>
            <Separator />
            <div className="space-y-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Computed from Selected Milestones</p>

              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Current Phase Deliverables</Label>
                <div className="flex flex-wrap gap-1.5">
                  {computed.deliverables.length > 0
                    ? computed.deliverables.map((d) => <Badge key={d} variant="outline" className="text-xs bg-accent/50">{d}</Badge>)
                    : <span className="text-xs text-muted-foreground italic">No deliverables found</span>}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Expected Activities</Label>
                <div className="flex flex-wrap gap-1.5">
                  {computed.activities.length > 0
                    ? computed.activities.map((a) => <Badge key={a} variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">{a}</Badge>)
                    : <span className="text-xs text-muted-foreground italic">No activities found</span>}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Expected Skillsets for Teammates</Label>
                <div className="flex flex-wrap gap-1.5">
                  {computed.skills.length > 0
                    ? computed.skills.map((s) => <Badge key={s} variant="outline" className="text-xs bg-secondary text-secondary-foreground">{s}</Badge>)
                    : <span className="text-xs text-muted-foreground italic">No skills found</span>}
                </div>
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* Links */}
        <div className="space-y-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">External Links</p>

          <div className="space-y-1.5">
            <Label htmlFor="client-intake-url">Client Intake Link</Label>
            <Input
              id="client-intake-url"
              type="url"
              placeholder="https://..."
              value={form.client_intake_url}
              onChange={(e) => setForm((f) => ({ ...f, client_intake_url: e.target.value }))}
              aria-invalid={!!errors.client_intake_url}
            />
            {errors.client_intake_url && <p className="text-xs text-destructive">{errors.client_intake_url}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notion-url">Project Repository in Notion</Label>
            <Input
              id="notion-url"
              type="url"
              placeholder="https://..."
              value={form.notion_repository_url}
              onChange={(e) => setForm((f) => ({ ...f, notion_repository_url: e.target.value }))}
              aria-invalid={!!errors.notion_repository_url}
            />
            {errors.notion_repository_url && <p className="text-xs text-destructive">{errors.notion_repository_url}</p>}
          </div>
        </div>

        <Separator />

        {/* Discord Role */}
        <div className="space-y-1.5">
          <DiscordRolePicker
            selectedRoleId={form.discord_role_id}
            selectedRoleName={form.discord_role_name}
            onSelect={(roleId, roleName) => setForm((f) => ({ ...f, discord_role_id: roleId, discord_role_name: roleName }))}
          />
          {(errors.discord_role_id || errors.discord_role_name) && (
            <p className="text-xs text-destructive">Discord role is required. Please select or create a Discord role for this project.</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pb-8">
        <Button variant="outline" onClick={() => navigate("/admin/clients?tab=projects")} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={isSaving}>
          {isSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          {isEditing ? "Save Changes" : "Create Project"}
        </Button>
      </div>
    </div>
  );
}
