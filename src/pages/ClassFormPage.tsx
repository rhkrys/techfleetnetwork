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
        toast.success("Class created");
        await queryClient.invalidateQueries({ queryKey: ["classes"] });
        navigate(`/teach/classes/${newId}`);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["classes"] });
      navigate(`/teach/classes/${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save class";
      toast.error(msg);
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
  const heroUrl = form.watch("hero_image_url");

  return (
    <div className="container-app py-8 sm:py-12 max-w-3xl">
      <Button asChild variant="ghost" size="sm" className="mb-3">
        <Link to="/teach/classes"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link>
      </Button>
      <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-6">
        {isEdit ? "Edit Class" : "New Class"}
      </h1>

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

        <div>
          <Label>Summary</Label>
          <RichTextEditor
            content={summary}
            onChange={(html) => form.setValue("summary", html, { shouldValidate: true, shouldDirty: true })}
            placeholder="A short overview of the class…"
          />
          {form.formState.errors.summary && (
            <p className="text-xs text-destructive mt-1">{form.formState.errors.summary.message}</p>
          )}
        </div>

        <div>
          <Label>Why take this course?</Label>
          <RichTextEditor
            content={whyTake}
            onChange={(html) => form.setValue("why_take", html, { shouldDirty: true })}
            placeholder="What learners gain, the value of taking this course…"
          />
        </div>

        <div>
          <Label>Outcomes</Label>
          <RichTextEditor
            content={outcomes}
            onChange={(html) => form.setValue("outcomes", html, { shouldDirty: true })}
            placeholder="What learners will be able to do after completing this class…"
          />
        </div>

        <div>
          <Label>Audiences</Label>
          <RichTextEditor
            content={audiences}
            onChange={(html) => form.setValue("audiences", html, { shouldDirty: true })}
            placeholder="Who this class is for…"
          />
        </div>

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
