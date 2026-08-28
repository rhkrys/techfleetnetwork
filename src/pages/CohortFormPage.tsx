import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextSection } from "@/components/forms/RichTextSection";
import { CohortService } from "@/services/cohort.service";
import { cohortFormSchema, type CohortFormValues } from "@/lib/validators/cohort";
import { useQueryClient } from "@/lib/react-query";
import { useServerDraft } from "@/hooks/use-server-draft";
import { DraftRestoredBanner } from "@/components/forms/DraftRestoredBanner";
import { AutosaveStatus } from "@/components/ui/AutosaveStatus";
import { useAutosave } from "@/hooks/use-autosave";
import { useCohortById } from "@/hooks/use-cohorts";
import { extractErrorMessage } from "@/lib/errors/extract";

/**
 * Create + edit form for a Cohort.
 *
 * Routes:
 *   /teach/classes/:id/cohorts/new                   → create
 *   /teach/classes/:id/cohorts/:cohortId/edit        → edit
 *
 * Edit mode mirrors ClassFormPage:
 *   - Loads the cohort via useCohortById and resets the form once.
 *   - Autosaves in-place while status is draft|pending_review (RLS-permitted).
 *   - Server-draft is create-only.
 */
export default function CohortFormPage() {
  const { id: classId, cohortId } = useParams<{ id: string; cohortId?: string }>();
  const isEdit = !!cohortId;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const { data: existing, isLoading: loadingExisting } = useCohortById(cohortId);

  const EMPTY = useMemo<CohortFormValues>(
    () => ({
      label: "",
      start_date: "",
      end_date: "",
      registration_url: "",
      discount_registration_url: "",
      meeting_url: "",
      timezone: "America/New_York",
      capacity: null,
      schedule: "",
    }),
    []
  );

  const form = useForm<CohortFormValues>({
    resolver: zodResolver(cohortFormSchema),
    defaultValues: EMPTY,
  });

  // Hydrate from existing cohort once it loads (edit mode only).
  useEffect(() => {
    if (!isEdit) return;
    if (!existing) return;
    form.reset({
      label: existing.label,
      start_date: existing.start_date,
      end_date: existing.end_date,
      registration_url: existing.registration_url,
      discount_registration_url:
        (existing as { discount_registration_url?: string | null }).discount_registration_url ?? "",
      meeting_url: existing.meeting_url ?? "",
      timezone: existing.timezone || "America/New_York",
      capacity: existing.capacity ?? null,
      schedule: (existing as { schedule?: string }).schedule ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, isEdit]);

  // Server-side draft for create mode only.
  const draft = useServerDraft<CohortFormValues>({
    draftKey: `cohort:new:${classId ?? "unknown"}`,
    schemaVersion: 1,
    initialValue: EMPTY,
    enabled: !isEdit && !!classId,
    label: "cohort-form",
  });

  const watched = form.watch();
  useEffect(() => {
    if (isEdit) return;
    draft.setValue(watched as CohortFormValues);
  }, [watched, draft, isEdit]);

  // Hydrate the form from the restored draft once on mount (create only).
  useEffect(() => {
    if (isEdit) return;
    if (draft.restored && !draft.hydrating) {
      form.reset(draft.value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.restored, draft.hydrating, isEdit]);

  // Edit-mode autosave (RLS-permitted statuses only).
  const canAutosave =
    isEdit &&
    !!cohortId &&
    !!existing &&
    (existing.status === "draft" || existing.status === "pending_review");
  const autosave = useAutosave({
    value: watched,
    enabled: !!canAutosave,
    label: "cohort-form",
    onSave: async (values) => {
      if (!cohortId) return;
      await CohortService.update(cohortId, values as CohortFormValues);
    },
  });

  const schedule = form.watch("schedule");

  const onSubmit = async (values: CohortFormValues) => {
    if (!classId) return;
    setSubmitting(true);
    try {
      if (isEdit && cohortId) {
        await CohortService.update(cohortId, values);
        toast.success("Cohort saved");
      } else {
        await CohortService.create(classId, values);
        await draft.clearDraft();
        toast.success("Cohort created");
      }
      await queryClient.invalidateQueries({ queryKey: ["cohorts", "class", classId] });
      if (cohortId) {
        await queryClient.invalidateQueries({ queryKey: ["cohorts", "byId", cohortId] });
      }
      navigate(`/teach/classes/${classId}`);
    } catch (err) {
      const { message, description } = extractErrorMessage(
        err,
        isEdit ? "We couldn't save your cohort." : "We couldn't create your cohort."
      );
      toast.error(message, description ? { description } : undefined);
    } finally {
      setSubmitting(false);
    }
  };

  if (isEdit && loadingExisting) {
    return (
      <div className="container-app py-12 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container-app py-8 sm:py-12 max-w-2xl">
      <Button asChild variant="ghost" size="sm" className="mb-3">
        <Link to={`/teach/classes/${classId}`}><ArrowLeft className="h-4 w-4 mr-1" />Back to class</Link>
      </Button>
      <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">
        {isEdit ? "Edit cohort" : "New cohort"}
      </h1>

      {!isEdit && draft.restored && (
        <div className="mb-4">
          <DraftRestoredBanner
            restoredAt={draft.restoredAt}
            onDiscard={async () => { await draft.clearDraft(); form.reset(EMPTY); }}
            noun="cohort draft"
          />
        </div>
      )}

      <form
        onSubmit={(e) => {
          // Swallow rejected resolver promise so it never leaks to the global
          // error reporter as a severity=error client_error (field errors are
          // already rendered inline).
          void form.handleSubmit(onSubmit)(e).catch(() => {});
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="label">Label</Label>
          <Input id="label" placeholder="e.g. Spring 2026" {...form.register("label")} />
          {form.formState.errors.label && <p className="text-xs text-destructive mt-1">{form.formState.errors.label.message}</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="start">Start date</Label>
            <Input id="start" type="date" {...form.register("start_date")} />
            {form.formState.errors.start_date && <p className="text-xs text-destructive mt-1">{form.formState.errors.start_date.message}</p>}
          </div>
          <div>
            <Label htmlFor="end">End date</Label>
            <Input id="end" type="date" {...form.register("end_date")} />
            {form.formState.errors.end_date && <p className="text-xs text-destructive mt-1">{form.formState.errors.end_date.message}</p>}
          </div>
        </div>
        <div>
          <Label htmlFor="reg">Registration URL</Label>
          <Input id="reg" placeholder="https://techfleet.gumroad.com/l/…" {...form.register("registration_url")} />
          <p className="text-xs text-muted-foreground mt-1">
            The public, list-price link. Shown to everyone on the course catalog.
          </p>
          {form.formState.errors.registration_url && <p className="text-xs text-destructive mt-1">{form.formState.errors.registration_url.message}</p>}
        </div>
        <div>
          <Label htmlFor="discount-reg">Member registration URL (optional)</Label>
          <Input
            id="discount-reg"
            placeholder="https://techfleet.gumroad.com/l/…/tfmember"
            {...form.register("discount_registration_url")}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Same product, with the member discount code applied. Shown only to signed-in
            members — never on the public catalog. Leave blank to show everyone the public link.
          </p>
          {form.formState.errors.discount_registration_url && <p className="text-xs text-destructive mt-1">{form.formState.errors.discount_registration_url.message}</p>}
        </div>
        <div>
          <Label htmlFor="meeting">Meeting URL (optional)</Label>
          <Input id="meeting" placeholder="https://…" {...form.register("meeting_url")} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="tz">Timezone</Label>
            <Input id="tz" {...form.register("timezone")} />
          </div>
          <div>
            <Label htmlFor="cap">Capacity (optional)</Label>
            <Input id="cap" type="number" min={1} {...form.register("capacity")} />
          </div>
        </div>

        <RichTextSection
          id="rts-schedule"
          label="Schedule of Classes"
          placeholder="Session dates and times, meeting cadence, holidays (optional)…"
          value={schedule}
          onChange={(html) => form.setValue("schedule", html, { shouldDirty: true })}
          error={form.formState.errors.schedule?.message}
        />


        <div className="flex gap-2 items-center flex-wrap">
          {canAutosave && (
            <AutosaveStatus status={autosave.status} lastSavedAt={autosave.lastSavedAt} onRetry={autosave.retry} />
          )}
          {!isEdit && (
            <AutosaveStatus status={draft.status} lastSavedAt={draft.lastSavedAt} onRetry={() => void draft.flush()} />
          )}
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "Save changes" : "Create cohort"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(`/teach/classes/${classId}`)}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
