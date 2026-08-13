// Hand-Off Production panel — mounts in a project's detail view for active teammates.
// Shows the strict 26-component gate, lets teammates add deliverables (text/link/file) per
// component, and — once every component is complete — produces + surfaces the four audience
// versions. All validation/gating/access control is enforced server-side; this is the UI.
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Check,
  Circle,
  Download,
  Eye,
  FileUp,
  Loader2,
  PackageCheck,
  PartyPopper,
  Plus,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  useDeleteSubmission,
  useHandoffCompleteness,
  useHandoffOutputs,
  useHandoffSubmissions,
  useLatestProduction,
  useProduceHandoffs,
  useRunBudget,
  useSubmitFeedback,
  useSubmitFile,
  useSubmitLink,
  useSubmitText,
} from "@/hooks/use-handoff";
import {
  activeStageIndex,
  getDownloadUrl,
  type HandoffAudience,
  type HandoffBudget,
  type HandoffComponentStatus,
  type HandoffOutputFile,
  type HandoffProduction,
  type HandoffRating,
  HANDOFF_STAGES,
  type HandoffSubmission,
  isTerminalStatus,
} from "@/services/handoff.service";

const ARC_ORDER = [
  "Pre-amble",
  "Part 1: Empathy Building",
  "Part 2: The Journey",
  "Part 3: The outcomes",
  "Part 4: The Sequel",
];

const AUDIENCE_LABEL: Record<HandoffAudience, string> = {
  client: "Client Hand-Off",
  teammate: "Teammate Hand-Off",
  teammate_case_study: "Teammate Case Study",
  org_case_study: "Tech Fleet Org Case Study",
};
const AUDIENCE_ORDER: HandoffAudience[] = [
  "client",
  "teammate",
  "teammate_case_study",
  "org_case_study",
];

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued…",
  parsing: "Reading your deliverables…",
  extracting: "Pulling out the facts…",
  writing: "Writing the four versions…",
  rendering: "Formatting the documents…",
  complete: "Done",
  failed: "Something went wrong",
  canceled: "Canceled",
};

export function HandoffPanel({ projectId, phase }: { projectId: string; phase: string }) {
  const completeness = useHandoffCompleteness(projectId, phase);
  const submissions = useHandoffSubmissions(projectId, phase);
  const production = useLatestProduction(projectId, phase);
  const produce = useProduceHandoffs(projectId, phase);

  const status = production.data?.status;
  const isRunning = !!status && !isTerminalStatus(status);
  const isComplete = status === "complete";
  const outputs = useHandoffOutputs(production.data?.id, isComplete);

  const subsByComponent = useMemo(() => {
    const map = new Map<string, HandoffSubmission[]>();
    for (const s of submissions.data ?? []) {
      const list = map.get(s.component_slug) ?? [];
      list.push(s);
      map.set(s.component_slug, list);
    }
    return map;
  }, [submissions.data]);

  const arcs = useMemo(() => {
    const comps = completeness.data?.components ?? [];
    const byArc = new Map<string, HandoffComponentStatus[]>();
    for (const c of comps) {
      const list = byArc.get(c.story_arc) ?? [];
      list.push(c);
      byArc.set(c.story_arc, list);
    }
    return ARC_ORDER.filter((a) => byArc.has(a)).map((a) => ({
      arc: a,
      components: byArc.get(a)!,
    }));
  }, [completeness.data]);

  if (completeness.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Hand-Off Production</CardTitle>
        </CardHeader>
        <CardContent>
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
        </CardContent>
      </Card>
    );
  }

  const gate = completeness.data;
  const pct = gate?.progress_pct ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <PackageCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          Hand-Off Production
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Add your team's deliverables for each part of the story. When all {gate?.total ?? 26} are
          in, produce the four hand-off versions.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress toward the strict gate */}
        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium">
              {gate?.completed ?? 0} of {gate?.total ?? 26} components complete
            </span>
            <span className="text-muted-foreground">{pct}%</span>
          </div>
          <Progress value={pct} aria-label={`Hand-off completeness: ${pct} percent`} />
        </div>

        {/* Components grouped by story arc */}
        <div className="space-y-5">
          {arcs.map(({ arc, components }) => (
            <section key={arc} aria-label={arc}>
              <h4 className="mb-2 text-sm font-semibold text-primary">{arc}</h4>
              <ul className="space-y-2">
                {components.map((c) => (
                  <ComponentRow
                    key={c.slug}
                    projectId={projectId}
                    phase={phase}
                    component={c}
                    entries={subsByComponent.get(c.slug) ?? []}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* Produce → progress → celebratory ready */}
        <div className="border-t pt-4">
          {isRunning ? (
            <ProduceStepper status={status!} writerOnly={production.data?.writer_only ?? false} />
          ) : isComplete && production.data ? (
            <ReadySection
              projectId={projectId}
              phase={phase}
              production={production.data}
              outputs={outputs.data ?? []}
            />
          ) : (
            <div className="space-y-3">
              <Button
                onClick={() =>
                  produce.mutate(undefined, {
                    onError: (e) =>
                      toast.error(e instanceof Error ? e.message : "Could not start production"),
                    onSuccess: () =>
                      toast.success(
                        "Producing your hand-offs — we'll notify you when they're ready."
                      ),
                  })
                }
                disabled={!gate?.is_ready || produce.isPending}
              >
                {produce.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                Produce hand-offs
              </Button>
              {!gate?.is_ready && (
                <p className="text-sm text-muted-foreground">
                  All {gate?.total ?? 26} components must be complete before you can produce.
                </p>
              )}
              {status === "failed" && (
                <p
                  className="text-sm text-destructive"
                  role="status"
                  data-no-translate
                  translate="no"
                >
                  The last run failed{production.data?.error ? `: ${production.data.error}` : "."}{" "}
                  You can try again.
                </p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ComponentRow({
  projectId,
  phase,
  component,
  entries,
}: {
  projectId: string;
  phase: string;
  component: HandoffComponentStatus;
  entries: HandoffSubmission[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm">
          {component.complete ? (
            <Check className="h-4 w-4 text-success" aria-label="complete" />
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground" aria-label="not yet provided" />
          )}
          {component.component}
          {entries.length > 0 && (
            <span className="text-xs text-muted-foreground">({entries.length})</span>
          )}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${open ? "Close" : "Add an entry for"} ${component.component}`}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add
        </Button>
      </div>
      {open && (
        <div className="mt-2">
          <AddEntryForm
            projectId={projectId}
            phase={phase}
            componentSlug={component.slug}
            onDone={() => setOpen(false)}
          />
          {entries.length > 0 && (
            <ul className="mt-2 space-y-1">
              {entries.map((e) => (
                <EntryRow key={e.id} projectId={projectId} phase={phase} entry={e} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function AddEntryForm({
  projectId,
  phase,
  componentSlug,
  onDone,
}: {
  projectId: string;
  phase: string;
  componentSlug: string;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"text" | "link" | "file">("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const submitText = useSubmitText(projectId, phase);
  const submitLink = useSubmitLink(projectId, phase);
  const submitFile = useSubmitFile(projectId, phase);
  const busy = submitText.isPending || submitLink.isPending || submitFile.isPending;

  const onErr = (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save");

  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-2">
      <div className="flex gap-1" role="tablist" aria-label="Entry type">
        {(["text", "link", "file"] as const).map((m) => (
          <Button
            key={m}
            size="sm"
            variant={mode === m ? "default" : "outline"}
            onClick={() => setMode(m)}
            role="tab"
            aria-selected={mode === m}
          >
            {m === "text" ? "Text" : m === "link" ? "Link" : "File"}
          </Button>
        ))}
      </div>

      {mode === "text" && (
        <div className="space-y-2">
          <Label htmlFor={`text-${componentSlug}`} className="sr-only">
            Text entry
          </Label>
          <Textarea
            id={`text-${componentSlug}`}
            value={text}
            maxLength={10000}
            placeholder="Describe this part in your own words…"
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || !text.trim()}
            onClick={() =>
              submitText.mutate(
                { componentSlug, text },
                {
                  onSuccess: () => {
                    setText("");
                    onDone();
                    toast.success("Saved");
                  },
                  onError: onErr,
                }
              )
            }
          >
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Save text
          </Button>
        </div>
      )}

      {mode === "link" && (
        <div className="space-y-2">
          <Label htmlFor={`link-${componentSlug}`} className="sr-only">
            Link URL
          </Label>
          <Input
            id={`link-${componentSlug}`}
            type="url"
            value={url}
            placeholder="https://figma.com/… or any https link"
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || !url.trim()}
            onClick={() => {
              const isFigma = /(^|\.)figma\.com$/i.test(safeHost(url));
              submitLink.mutate(
                { componentSlug, type: isFigma ? "figma" : "url", url },
                {
                  onSuccess: () => {
                    setUrl("");
                    onDone();
                    toast.success("Saved");
                  },
                  onError: onErr,
                }
              );
            }}
          >
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Save link
          </Button>
        </div>
      )}

      {mode === "file" && (
        <div className="space-y-2">
          <Label
            htmlFor={`file-${componentSlug}`}
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <FileUp className="h-4 w-4" aria-hidden="true" />
            Choose a PDF, image, or CSV
          </Label>
          <Input
            id={`file-${componentSlug}`}
            type="file"
            accept="application/pdf,image/png,image/jpeg,text/csv,text/plain"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              submitFile.mutate(
                { componentSlug, file },
                {
                  onSuccess: () => {
                    onDone();
                    toast.success("Uploaded");
                  },
                  onError: onErr,
                }
              );
            }}
          />
          {busy && <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}

function EntryRow({
  projectId,
  phase,
  entry,
}: {
  projectId: string;
  phase: string;
  entry: HandoffSubmission;
}) {
  const del = useDeleteSubmission(projectId, phase);
  const label =
    entry.submission_type === "text"
      ? (entry.text_content ?? "").slice(0, 60)
      : (entry.external_url ?? entry.file_name ?? entry.submission_type);
  return (
    <li className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span className="truncate">
        {entry.submission_type}: {label}
      </span>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Remove this entry"
        disabled={del.isPending}
        onClick={() =>
          del.mutate(entry.id, {
            onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove"),
          })
        }
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </li>
  );
}

function OutputButton({
  outputFileId,
  label,
  icon,
}: {
  outputFileId: string;
  label: string;
  icon: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { url } = await getDownloadUrl(outputFileId);
          window.open(url, "_blank", "noopener,noreferrer");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not open the document");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? (
        <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <span className="mr-1 inline-flex" aria-hidden="true">
          {icon}
        </span>
      )}
      {label}
    </Button>
  );
}

// ── C8: async production stepper ─────────────────────────────────────────────
function ProduceStepper({ status, writerOnly }: { status: string; writerOnly: boolean }) {
  const active = activeStageIndex(status);
  return (
    <div className="space-y-3" role="status" aria-live="polite" data-no-translate translate="no">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
        <span className="font-medium">
          {writerOnly ? "Re-creating your selected versions…" : "Producing your hand-offs…"}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        This runs in the background and can take a while. You can safely leave this page — we'll
        notify you when it's ready.
      </p>
      <ol className="flex items-start justify-between gap-1">
        {HANDOFF_STAGES.map((s, i) => {
          const state = i < active ? "done" : i === active ? "now" : "todo";
          return (
            <li key={s.key} className="flex flex-1 flex-col items-center gap-1 text-center">
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
                  state === "done" && "bg-success text-success-foreground",
                  state === "now" && "border-2 border-primary text-primary",
                  state === "todo" && "border border-muted-foreground/30 text-muted-foreground"
                )}
              >
                {state === "done" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-[11px]",
                  state === "now" ? "font-semibold text-foreground" : "text-muted-foreground"
                )}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-center text-xs text-muted-foreground">{STATUS_LABEL[status] ?? status}</p>
    </div>
  );
}

// ── C10: celebratory ready + versions, C9: review + re-create ────────────────
function ReadySection({
  projectId,
  phase,
  production,
  outputs,
}: {
  projectId: string;
  phase: string;
  production: HandoffProduction;
  outputs: HandoffOutputFile[];
}) {
  const budget = useRunBudget(projectId, phase);
  const producedAt = new Date(production.updated_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    <div className="space-y-4">
      <CelebrateHeader gapCount={production.gap_count} producedAt={producedAt} />
      <div className="grid gap-3 sm:grid-cols-2">
        {AUDIENCE_ORDER.map((aud) => {
          const files = outputs.filter((o) => o.audience === aud);
          if (!files.length) return null;
          return (
            <VersionCard key={aud} audience={aud} files={files} productionId={production.id} />
          );
        })}
      </div>
      <RecreateControl projectId={projectId} phase={phase} budget={budget.data} />
    </div>
  );
}

function CelebrateHeader({ gapCount, producedAt }: { gapCount: number; producedAt: string }) {
  const [burst, setBurst] = useState(true);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setBurst(false);
      return;
    }
    const t = setTimeout(() => setBurst(false), 2200);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="rounded-lg border border-success/40 bg-success/10 p-4 text-center">
      <PartyPopper
        className={cn("mx-auto mb-2 h-8 w-8 text-success", burst && "motion-safe:animate-bounce")}
        aria-hidden="true"
      />
      <h4 className="text-lg font-semibold text-success">Your hand-offs are ready! 🎉</h4>
      <p className="mt-1 text-sm text-muted-foreground">
        Four versions produced {producedAt}. Anyone on your project can view and download them.
      </p>
      {gapCount > 0 && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
          {gapCount} section{gapCount === 1 ? "" : "s"} came through as a placeholder — you can
          re-create to fill {gapCount === 1 ? "it" : "them"}.
        </p>
      )}
    </div>
  );
}

function VersionCard({
  audience,
  files,
  productionId,
}: {
  audience: HandoffAudience;
  files: HandoffOutputFile[];
  productionId: string;
}) {
  const html = files.find((f) => f.format === "html");
  const md = files.find((f) => f.format === "md");
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <span className="text-sm font-medium">{AUDIENCE_LABEL[audience]}</span>
      <div className="flex flex-wrap gap-2">
        {html && (
          <OutputButton outputFileId={html.id} label="View" icon={<Eye className="h-4 w-4" />} />
        )}
        {md && (
          <OutputButton
            outputFileId={md.id}
            label="Download .md"
            icon={<Download className="h-4 w-4" />}
          />
        )}
      </div>
      <FeedbackControls productionId={productionId} audience={audience} />
    </div>
  );
}

function FeedbackControls({
  productionId,
  audience,
}: {
  productionId: string;
  audience: HandoffAudience;
}) {
  const submit = useSubmitFeedback(productionId);
  // Start empty. Feedback RLS returns every member's rating and we can't cheaply tell which is the
  // current user's here (v1); the upsert is keyed to the caller, so submitting records/overwrites
  // only their own rating.
  const [rating, setRating] = useState<HandoffRating | "">("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  const send = (r: HandoffRating) => {
    setRating(r);
    submit.mutate(
      { audience, rating: r, note: note.trim() || undefined },
      {
        onSuccess: () => toast.success("Thanks — your feedback helps the writer improve."),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save feedback"),
      }
    );
  };

  return (
    <div className="space-y-2 border-t pt-2">
      <div className="flex items-center gap-2">
        <ToggleGroup
          type="single"
          value={rating}
          onValueChange={(v) => {
            if (v === "down") setShowNote(true);
            if (v) send(v as HandoffRating);
          }}
          aria-label={`Rate ${AUDIENCE_LABEL[audience]}`}
        >
          <ToggleGroupItem value="up" aria-label="Thumbs up">
            <ThumbsUp className="h-4 w-4" aria-hidden="true" />
          </ToggleGroupItem>
          <ToggleGroupItem value="down" aria-label="Thumbs down">
            <ThumbsDown className="h-4 w-4" aria-hidden="true" />
          </ToggleGroupItem>
        </ToggleGroup>
        <button
          type="button"
          className="text-xs text-muted-foreground underline underline-offset-2"
          onClick={() => setShowNote((v) => !v)}
        >
          {showNote ? "Hide note" : "Add a note"}
        </button>
      </div>
      {showNote && (
        <div className="space-y-1">
          <Textarea
            value={note}
            maxLength={2000}
            placeholder="What should change? Your note trains the writer for next time."
            onChange={(e) => setNote(e.target.value)}
            className="min-h-16 text-sm"
            aria-label={`Feedback note for ${AUDIENCE_LABEL[audience]}`}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!rating || submit.isPending}
            onClick={() => rating && send(rating)}
          >
            Save note
          </Button>
        </div>
      )}
    </div>
  );
}

function RecreateControl({
  projectId,
  phase,
  budget,
}: {
  projectId: string;
  phase: string;
  budget?: HandoffBudget;
}) {
  const produce = useProduceHandoffs(projectId, phase);
  const [selected, setSelected] = useState<Set<HandoffAudience>>(new Set());
  if (!budget) return null;
  if (!budget.can_retry) {
    return (
      <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        Your team has used its one re-create for this phase. Contact a Tech Fleet admin if you need
        another.
      </p>
    );
  }
  const toggle = (a: HandoffAudience) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });
  const chosen = AUDIENCE_ORDER.filter((a) => selected.has(a));
  return (
    <div className="rounded-md border p-3">
      <h5 className="text-sm font-semibold">Re-create versions</h5>
      <p className="mb-2 text-xs text-muted-foreground">
        Not happy with a version? Pick which to re-create. Your team gets <strong>one</strong>{" "}
        re-create for this phase — it re-writes only the versions you choose.
      </p>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {AUDIENCE_ORDER.map((a) => (
          <label key={a} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selected.has(a)}
              onCheckedChange={() => toggle(a)}
              aria-label={AUDIENCE_LABEL[a]}
            />
            {AUDIENCE_LABEL[a]}
          </label>
        ))}
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            disabled={!chosen.length || produce.isPending}
          >
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Re-create
            {chosen.length ? ` ${chosen.length} version${chosen.length === 1 ? "" : "s"}` : ""}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Use your team's one re-create?</AlertDialogTitle>
            <AlertDialogDescription>
              This re-writes {chosen.map((a) => AUDIENCE_LABEL[a]).join(", ")} and uses your team's
              single re-create for this phase. The current versions are kept in history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                produce.mutate(chosen, {
                  onSuccess: () => toast.success("Re-creating your selected versions…"),
                  onError: (e) =>
                    toast.error(e instanceof Error ? e.message : "Could not re-create"),
                })
              }
            >
              Re-create
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return "";
  }
}
