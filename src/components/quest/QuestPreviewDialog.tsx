import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Clock, Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useQuestPaths, useQuestSteps, useAddQuestPath } from "@/hooks/use-quest";
import { cn } from "@/lib/utils";

const STEP_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  course: { label: "COURSE", color: "bg-primary/10 text-primary" },
  self_report: { label: "SELF-REPORT", color: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  system_verified: { label: "VERIFIED", color: "bg-success/10 text-success" },
  application: { label: "APPLICATION", color: "bg-accent/50 text-accent-foreground" },
};

interface QuestPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pathId: string;
  completedPathSlugs: Set<string>;
  onQuestSelected: (pathId: string) => void;
  onFindAnother: () => void;
}

export function QuestPreviewDialog({
  open,
  onOpenChange,
  pathId,
  completedPathSlugs,
  onQuestSelected,
  onFindAnother,
}: QuestPreviewDialogProps) {
  const { data: paths } = useQuestPaths();
  const { data: steps, isLoading: stepsLoading } = useQuestSteps(pathId);
  const addPath = useAddQuestPath();

  const pathBySlug = useMemo(() => {
    const m = new Map<string, NonNullable<typeof paths>[number]>();
    if (paths) for (const p of paths) m.set(p.slug, p);
    return m;
  }, [paths]);
  const path = useMemo(() => paths?.find((p) => p.id === pathId), [paths, pathId]);


  const missingPrereqs = useMemo(() => {
    if (!path) return [];
    return path.prerequisites
      .filter((slug) => !completedPathSlugs.has(slug))
      .map((slug) => pathBySlug.get(slug)?.title ?? slug);
  }, [path, pathBySlug, completedPathSlugs]);

  const handleSelectQuest = async () => {
    try {
      await addPath.mutateAsync(pathId);
      onQuestSelected(pathId);
    } catch {
      // Error handled by hook
    }
  };

  if (!path) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <span className={cn(
              "text-xs font-medium px-2 py-0.5 rounded-full",
              path.level === "advanced"
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "bg-primary/10 text-primary"
            )}>
              {path.level === "advanced" ? "Advanced" : "Beginner"}
            </span>
          </div>
          <DialogTitle className="text-xl">{path.title}</DialogTitle>
          <DialogDescription>{path.description}</DialogDescription>
        </DialogHeader>

        {/* Duration info */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              Estimated Duration: {path.estimated_duration}
            </span>
          </div>

          {path.duration_phases.length > 1 && (
            <div className="flex gap-0.5 rounded-lg overflow-hidden">
              {path.duration_phases.map((phase, i) => (
                <div key={i} className="flex-1 py-2 px-3 text-center bg-muted/50">
                  <p className="text-xs font-medium text-foreground">{phase.duration}</p>
                  <p className="text-xs text-muted-foreground">{phase.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Prerequisites info */}
        {missingPrereqs.length > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border">
            <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Includes Prerequisites</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                This quest includes completing: {missingPrereqs.join(", ")}
              </p>
            </div>
          </div>
        )}

        {/* Steps preview */}
        <div>
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">
            What You'll Do ({steps?.length ?? "..."} steps)
          </h3>
          {stepsLoading ? (
            <div className="flex justify-center py-4">
              <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              {steps?.map((step, index) => {
                const typeInfo = STEP_TYPE_LABELS[step.step_type] ?? { label: "STEP", color: "bg-muted text-muted-foreground" };
                return (
                  <div key={step.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                    <div className="flex-shrink-0 h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-mono text-muted-foreground">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h4 className="text-sm font-medium text-foreground">{step.title}</h4>
                        <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", typeInfo.color)}>
                          {typeInfo.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{step.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          <Button variant="outline" onClick={onFindAnother} className="w-full sm:w-auto">
            Find Another Quest
          </Button>
          <Button
            onClick={handleSelectQuest}
            disabled={addPath.isPending}
            className="w-full sm:w-auto"
          >
            {addPath.isPending ? "Selecting..." : "Select This Quest"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
