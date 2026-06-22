import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import { RichTextEditor } from "@/components/RichTextEditor";
import { RichTextSection } from "@/components/forms/RichTextSection";
import { ClassImageUpload } from "@/components/ClassImageUpload";
import { useAuth } from "@/contexts/AuthContext";
import { useClassById } from "@/hooks/use-classes";
import { ClassService } from "@/services/class.service";
import { classFormSchema, type ClassFormValues } from "@/lib/validators/class";
import { useQueryClient } from "@/lib/react-query";
import { SKILLS_OPTIONS as SKILLS_FALLBACK } from "@/lib/skills-framework";
import { useReferenceList } from "@/hooks/use-reference";
import { useAutosave } from "@/hooks/use-autosave";
import { AutosaveStatus } from "@/components/ui/AutosaveStatus";
import { useServerDraft } from "@/hooks/use-server-draft";
import { DraftRestoredBanner } from "@/components/forms/DraftRestoredBanner";
import { extractErrorMessage } from "@/lib/errors/extract";


function csvToList(s: string): string[] {
  return s.split(/[\n,]/).map((t) => t.trim()).filter(Boolean);
}

export default function ClassFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: existing, isLoading } = useClassById(id);
  const [submitting, setSubmitting] = useState(false);

  const defaults = useMemo<ClassFormValues>(
    () => ({
      title: "",
      summary: "",
      description: "",
      track: "basic_training",
      hero_image_url: "",
      skills: [],
      outcomes: "",
      why_take: "",
      audiences: "",
      prerequisites: [],
      curriculum: "",
      reading_assignments: "",
      class_expectations: "",
    }),
    []
  );

  const form = useForm<ClassFormValues>({
    resolver: zodResolver(classFormSchema),
    defaultValues: defaults,
  });

  const [prereqText, setPrereqText] = useState("");

  const watched = form.watch();
  const canAutosave = isEdit && !!id && !!existing
    && (existing as { status?: string }).status !== "pending_review"
    && (existing as { status?: string }).status !== "approved"
    && (existing as { status?: string }).status !== "archived";
  const autosave = useAutosave({
    value: watched,
    enabled: !!canAutosave,
    label: "class-form",
    onSave: async (values) => {
      if (!id) return;
      await ClassService.update(id, { ...values, prerequisites: values.prerequisites ?? [] } as ClassFormValues);
    },
  });

  // Server-side draft for create mode only. Edit-mode pages already autosave
  // straight to the real row above.
  const draft = useServerDraft<{ form: ClassFormValues; prereqText: string }>({
    draftKey: "class:new",
    schemaVersion: 1,
    initialValue: { form: defaults, prereqText: "" },
    enabled: !isEdit,
    label: "class-form",
  });

  // Mirror watched form state + prereqText into the draft buffer.
  useEffect(() => {
    if (isEdit) return;
    draft.setValue({ form: watched as ClassFormValues, prereqText });
  }, [watched, prereqText, isEdit, draft]);

  // Hydrate the form once when an existing draft is restored.
  useEffect(() => {
    if (isEdit) return;
    if (draft.restored && !draft.hydrating) {
      form.reset(draft.value.form);
      setPrereqText(draft.value.prereqText ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.restored, draft.hydrating, isEdit]);



  useEffect(() => {
    if (existing) {
      form.reset({
        title: existing.title,
        summary: existing.summary,
        description: existing.description ?? "",
        track: existing.track,
        hero_image_url: existing.hero_image_url ?? "",
        skills: existing.skills ?? [],
        outcomes: existing.outcomes ?? "",
        why_take: existing.why_take ?? "",
        audiences: existing.audiences ?? "",
        prerequisites: existing.prerequisites ?? [],
        curriculum: (existing as { curriculum?: string }).curriculum ?? "",
        reading_assignments: (existing as { reading_assignments?: string }).reading_assignments ?? "",
        class_expectations: (existing as { class_expectations?: string }).class_expectations ?? "",
      });
      setPrereqText((existing.prerequisites ?? []).join("\n"));
    }
  }, [existing, form]);

  const onSubmit = async (values: ClassFormValues) => {
    if (!user) return;
    const payload: ClassFormValues = {
      ...values,
      prerequisites: csvToList(prereqText),
    };
    setSubmitting(true);
    try {
      if (isEdit && id) {
        await ClassService.update(id, payload);
        toast.success("Class saved");
      } else {
        const newId = await ClassService.create(user.id, payload);
        await draft.clearDraft();
        toast.success("Class created");
        await queryClient.invalidateQueries({ queryKey: ["classes"] });
        navigate(`/teach/classes/${newId}`);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["classes"] });
      navigate(`/teach/classes/${id}`);
    } catch (err) {
      const { message, description } = extractErrorMessage(err, "We couldn't save your class.");
      toast.error(message, description ? { description } : undefined);
    } finally {
      setSubmitting(false);
    }
  };

  if (isEdit && isLoading) {
    return (
      <div className="container-app py-12 flex justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const skills = form.watch("skills");
  const summary = form.watch("summary");

  const outcomes = form.watch("outcomes");
  const whyTake = form.watch("why_take");
  const audiences = form.watch("audiences");
  const curriculum = form.watch("curriculum");
  const readingAssignments = form.watch("reading_assignments");
  const classExpectations = form.watch("class_expectations");
  const heroUrl = form.watch("hero_image_url");

  return (
    <div className="container-app py-8 sm:py-12 max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="mb-3">
        <Link to="/teach/classes"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link>
      </Button>
      <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">
        {isEdit ? "Edit Class" : "New Class"}
      </h1>

      {!isEdit && draft.restored && (
        <div className="mb-4">
          <DraftRestoredBanner
            restoredAt={draft.restoredAt}
            onDiscard={async () => {
              await draft.clearDraft();
              form.reset(defaults);
              setPrereqText("");
            }}
            noun="class draft"
          />
        </div>
      )}

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

        <div>
          <Label htmlFor="title">Title</Label>
          <Input id="title" {...form.register("title")} />
          {form.formState.errors.title && (
            <p className="text-xs text-destructive mt-1">{form.formState.errors.title.message}</p>
          )}
        </div>

        <div>
          <Label htmlFor="track">Track</Label>
          <Select
            value={form.watch("track")}
            onValueChange={(v) => form.setValue("track", v as ClassFormValues["track"], { shouldValidate: true })}
          >
            <SelectTrigger id="track"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="basic_training">Basic Training</SelectItem>
              <SelectItem value="advanced_training">Advanced Training</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Hero image</Label>
          {user && (
            <ClassImageUpload
              userId={user.id}
              classId={id}
              value={heroUrl || null}
              onChange={(url) => form.setValue("hero_image_url", url ?? "", { shouldValidate: true, shouldDirty: true })}
            />
          )}
        </div>

        <RichTextSection
          id="rts-summary"
          label="Summary"
          placeholder="A short overview of the class…"
          value={summary}
          onChange={(html) => form.setValue("summary", html, { shouldValidate: true, shouldDirty: true })}
          error={form.formState.errors.summary?.message}
        />

        <RichTextSection
          id="rts-why-take"
          label="Why take this course?"
          placeholder="What learners gain, the value of taking this course…"
          value={whyTake}
          onChange={(html) => form.setValue("why_take", html, { shouldDirty: true })}
          error={form.formState.errors.why_take?.message}
        />

        <RichTextSection
          id="rts-outcomes"
          label="Outcomes"
          placeholder="What learners will be able to do after completing this class…"
          value={outcomes}
          onChange={(html) => form.setValue("outcomes", html, { shouldDirty: true })}
          error={form.formState.errors.outcomes?.message}
        />

        <RichTextSection
          id="rts-audiences"
          label="Audiences"
          placeholder="Who this class is for…"
          value={audiences}
          onChange={(html) => form.setValue("audiences", html, { shouldDirty: true })}
          error={form.formState.errors.audiences?.message}
        />

        <RichTextSection
          id="rts-curriculum"
          label="Curriculum"
          placeholder="Outline the modules, topics, and flow of the class (optional)…"
          value={curriculum}
          onChange={(html) => form.setValue("curriculum", html, { shouldDirty: true })}
          error={form.formState.errors.curriculum?.message}
        />

        <RichTextSection
          id="rts-reading-assignments"
          label="Reading Assignments"
          placeholder="Books, articles, or links learners should read (optional)…"
          value={readingAssignments}
          onChange={(html) => form.setValue("reading_assignments", html, { shouldDirty: true })}
          error={form.formState.errors.reading_assignments?.message}
        />

        <RichTextSection
          id="rts-class-expectations"
          label="Class Expectations"
          placeholder="Attendance, participation, time commitment, code of conduct (optional)…"
          value={classExpectations}
          onChange={(html) => form.setValue("class_expectations", html, { shouldDirty: true })}
          error={form.formState.errors.class_expectations?.message}
        />

        <div>
          <Label htmlFor="skills">Skills</Label>
          <SkillsPicker
            value={skills}
            onChange={(v) => form.setValue("skills", v, { shouldValidate: true, shouldDirty: true })}
          />
          {form.formState.errors.skills && (
            <p className="text-xs text-destructive mt-1">{form.formState.errors.skills.message}</p>
          )}
        </div>

        <div>
          <Label htmlFor="prereq">Prerequisites (one per line)</Label>
          <Textarea id="prereq" rows={3} value={prereqText} onChange={(e) => setPrereqText(e.target.value)} />
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          {canAutosave && (
            <AutosaveStatus
              status={autosave.status}
              lastSavedAt={autosave.lastSavedAt}
              onRetry={autosave.retry}
            />
          )}
          {!isEdit && (
            <AutosaveStatus
              status={draft.status}
              lastSavedAt={draft.lastSavedAt}
              onRetry={() => void draft.flush()}
            />
          )}
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "Save changes" : "Create draft"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate("/teach/classes")}>
            Cancel
          </Button>
        </div>

      </form>
    </div>
  );
}

/**
 * SkillsPicker — DB-backed Tech Fleet skills selector.
 * Pulls from `reference_skills` via React Query (24h cache). If the table is
 * empty (admin hasn't synced yet) it falls back to the bundled framework list
 * so the form never renders an empty dropdown — graceful degradation.
 */
function SkillsPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { data, isLoading, isError } = useReferenceList("skills");
  const options = useMemo(() => {
    const fromDb = (data ?? []).map((r) => ({ value: r.name, label: r.name }));
    if (fromDb.length > 0) return fromDb;
    return SKILLS_FALLBACK;
  }, [data]);
  const placeholder = isLoading
    ? "Loading skills…"
    : isError
      ? "Skills (fallback list — DB unavailable)"
      : "Search the Tech Fleet skills framework…";
  return (
    <MultiSelect
      options={options}
      selected={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-label="Skills"
    />
  );
}
