import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CohortService } from "@/services/cohort.service";
import { cohortFormSchema, type CohortFormValues } from "@/lib/validators/cohort";
import { useQueryClient } from "@/lib/react-query";
import { useServerDraft } from "@/hooks/use-server-draft";
import { DraftRestoredBanner } from "@/components/forms/DraftRestoredBanner";
import { AutosaveStatus } from "@/components/ui/AutosaveStatus";

export default function CohortFormPage() {
  const { id: classId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const EMPTY: CohortFormValues = {
    label: "",
    start_date: "",
    end_date: "",
    registration_url: "",
    meeting_url: "",
    timezone: "America/New_York",
    capacity: null,
  };

  const form = useForm<CohortFormValues>({
    resolver: zodResolver(cohortFormSchema),
    defaultValues: EMPTY,
  });

  // Server-side draft (cohort create is always create-mode on this page).
  const draft = useServerDraft<CohortFormValues>({
    draftKey: `cohort:new:${classId ?? "unknown"}`,
    schemaVersion: 1,
    initialValue: EMPTY,
    enabled: !!classId,
    label: "cohort-form",
  });

  const watched = form.watch();
  useEffect(() => { draft.setValue(watched as CohortFormValues); }, [watched, draft]);

  // Hydrate the form from the restored draft once on mount.
  useEffect(() => {
    if (draft.restored && !draft.hydrating) {
      form.reset(draft.value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.restored, draft.hydrating]);

  const onSubmit = async (values: CohortFormValues) => {
    if (!classId) return;
    setSubmitting(true);
    try {
      await CohortService.create(classId, values);
      await draft.clearDraft();
      toast.success("Cohort created");
      await queryClient.invalidateQueries({ queryKey: ["cohorts", "class", classId] });
      navigate(`/teach/classes/${classId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create cohort";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container-app py-8 sm:py-12 max-w-2xl">
      <Button asChild variant="ghost" size="sm" className="mb-3">
        <Link to={`/teach/classes/${classId}`}><ArrowLeft className="h-4 w-4 mr-1" />Back to class</Link>
      </Button>
      <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">New Cohort</h1>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
          <Input id="reg" placeholder="https://…" {...form.register("registration_url")} />
          {form.formState.errors.registration_url && <p className="text-xs text-destructive mt-1">{form.formState.errors.registration_url.message}</p>}
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

        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create cohort
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(`/teach/classes/${classId}`)}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
