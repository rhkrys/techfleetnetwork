import { useMemo, useState, useCallback, memo } from "react";
import { Button, Progress } from "@/design-system";

import {
  CheckCircle2,
  Circle,
  Lock,
  ArrowRight,
  Plus,
  Eye,
  BookOpen,
  Rocket,
  Map as MapIcon,
  Shield,
  BarChart2,
  Zap,
  Briefcase,
  Heart,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useQuestPaths,
  useAllQuestSteps,
  useUserQuestSelections,
  useSelfReportProgress,
  useAllJourneyProgress,
  useSystemVerificationData,
} from "@/hooks/use-quest";
import { cn } from "@/lib/utils";
import { QuestPathDetail } from "./QuestPathDetail";
import { QuestExploreDialog } from "./QuestExploreDialog";
import type { QuestPath, QuestPathStep, SystemVerificationData } from "@/services/quest.service";
import { useQuestPathMaps } from "@/lib/quest/path-maps";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  rocket: Rocket,
  map: MapIcon,
  eye: Eye,
  "book-open": BookOpen,
  shield: Shield,
  "bar-chart-2": BarChart2,
  zap: Zap,
  briefcase: Briefcase,
  heart: Heart,
  circle: Circle,
};

interface QuestRoadmapProps {
  onNeedIntake: () => void;
}

export function QuestRoadmap({ onNeedIntake }: QuestRoadmapProps) {
  const { user, profile } = useAuth();
  const { data: paths, isLoading: pathsLoading } = useQuestPaths();
  const { data: allSteps } = useAllQuestSteps();
  const { data: selections, isLoading: selectionsLoading } = useUserQuestSelections();
  const { data: selfReportProgress } = useSelfReportProgress();
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [showExplore, setShowExplore] = useState(false);

  // Single query replaces 7 individual useJourneyProgress() calls
  const { data: allJourneyMap } = useAllJourneyProgress();
  // System verification data for steps referencing other DB tables
  const { data: sysVerification } = useSystemVerificationData();
  const { byId: pathById, bySlug: pathBySlug } = useQuestPathMaps(paths);

  // Derive phase completion stats from the single batch query
  const allProgress = useMemo(() => {
    const map = new Map<string, { completed: number; total: number }>();
    if (!allJourneyMap) return map;
    for (const [phase, tasks] of allJourneyMap.entries()) {
      const completed = tasks.filter((t) => t.completed).length;
      map.set(phase, { completed, total: tasks.length });
    }
    return map;
  }, [allJourneyMap]);

  // Compute step completion for each path
  const pathProgress = useMemo(() => {
    const empty = new Map<string, { completed: number; total: number; nextStep?: QuestPathStep }>();
    if (!paths || !allSteps || !selections) return empty;

    const result = new Map<
      string,
      { completed: number; total: number; nextStep?: QuestPathStep }
    >();
    for (const path of paths) {
      const steps = allSteps.filter((s) => s.path_id === path.id);
      let completed = 0;
      let nextStep: QuestPathStep | undefined;

      for (const step of steps) {
        if (isStepCompleted(step, allProgress, selfReportProgress, profile, sysVerification)) {
          completed++;
        } else if (!nextStep) {
          nextStep = step;
        }
      }
      result.set(path.id, { completed, total: steps.length, nextStep });
    }
    return result;
  }, [paths, allSteps, selections, allProgress, selfReportProgress, profile, sysVerification]);

  const completedPathSlugs = useMemo(() => {
    if (!paths) return new Set<string>();
    const set = new Set<string>();
    for (const path of paths) {
      const progress = pathProgress.get(path.id);
      if (progress && progress.completed >= progress.total && progress.total > 0) {
        set.add(path.slug);
      }
    }
    return set;
  }, [paths, pathProgress]);

  const handleSelectPath = useCallback((id: string) => setSelectedPathId(id), []);
  const handleBack = useCallback(() => setSelectedPathId(null), []);
  const handleOpenExplore = useCallback(() => setShowExplore(true), []);

  if (pathsLoading || selectionsLoading) {
    return (
      <div
        className="flex items-center justify-center py-12"
        role="status"
        aria-label="Loading journey roadmap"
      >
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!selections || selections.length === 0) {
    onNeedIntake();
    return null;
  }

  const selectedPathIdSet = new Set(selections.map((s) => s.path_id));
  const selectedPaths =
    paths?.filter((p) => selectedPathIdSet.has(p.id)).sort((a, b) => a.sort_order - b.sort_order) ??
    [];

  const unselectedCount = (paths?.length ?? 0) - selectedPaths.length;

  if (selectedPathId) {
    const path = pathById.get(selectedPathId);
    if (path) {
      return (
        <QuestPathDetail
          path={path}
          onBack={handleBack}
          allProgress={allProgress}
          selfReportProgress={selfReportProgress}
          completedPathSlugs={completedPathSlugs}
          allPaths={paths ?? []}
          sysVerification={sysVerification}
        />
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Your Journey Roadmap</h2>
        {unselectedCount > 0 && (
          <Button variant="outline" size="sm" onClick={handleOpenExplore}>
            Explore More Paths ({unselectedCount} available)
          </Button>
        )}
      </div>

      <div className="space-y-1" role="list" aria-label="Journey paths">
        {selectedPaths.map((path, index) => (
          <PathCard
            key={path.id}
            path={path}
            progress={pathProgress.get(path.id)}
            completedPathSlugs={completedPathSlugs}
            allPaths={paths ?? []}
            onSelect={handleSelectPath}
            isLast={index === selectedPaths.length - 1}
          />
        ))}
      </div>

      <QuestExploreDialog
        open={showExplore}
        onOpenChange={setShowExplore}
        selectedPathIds={selections?.map((s) => s.path_id) ?? []}
        completedPathSlugs={completedPathSlugs}
      />
    </div>
  );
}

/** Memoized individual path card — prevents re-renders when sibling data changes */
const PathCard = memo(function PathCard({
  path,
  progress,
  completedPathSlugs,
  allPaths,
  onSelect,
  isLast,
}: {
  path: QuestPath;
  progress: { completed: number; total: number; nextStep?: QuestPathStep } | undefined;
  completedPathSlugs: Set<string>;
  allPaths: QuestPath[];
  onSelect: (id: string) => void;
  isLast: boolean;
}) {
  const prereqsMet = path.prerequisites.every((slug) => completedPathSlugs.has(slug));
  const isCompleted = progress && progress.completed >= progress.total && progress.total > 0;
  const isLocked = !prereqsMet;
  const Icon = ICON_MAP[path.icon] ?? Circle;
  const pathBySlug = useMemo(() => {
    const m = new Map<string, QuestPath>();
    for (const p of allPaths) m.set(p.slug, p);
    return m;
  }, [allPaths]);

  return (
    <div role="listitem">
      <button
        onClick={() => !isLocked && onSelect(path.id)}
        disabled={isLocked}
        className={cn(
          "w-full card-elevated p-5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg",
          isCompleted
            ? "border-success/30 bg-success/5"
            : isLocked
              ? "opacity-60 cursor-not-allowed"
              : "hover:shadow-md hover:border-primary/30 cursor-pointer"
        )}
        aria-label={`${path.title}: ${progress?.completed ?? 0} of ${progress?.total ?? 0} steps completed, ${
          isCompleted ? "completed" : isLocked ? "locked" : "in progress"
        }`}
      >
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center",
              isCompleted ? "bg-success/10" : isLocked ? "bg-muted" : "bg-primary/10"
            )}
          >
            {isCompleted ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : isLocked ? (
              <Lock className="h-5 w-5 text-muted-foreground" />
            ) : (
              <Icon className="h-5 w-5 text-primary" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-foreground">{path.title}</h3>
              <span
                className={cn(
                  "text-xs font-medium px-2 py-0.5 rounded-full",
                  isCompleted
                    ? "bg-success/10 text-success"
                    : isLocked
                      ? "bg-muted text-muted-foreground"
                      : progress && progress.completed > 0
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                )}
              >
                {isCompleted
                  ? "Completed"
                  : isLocked
                    ? "Locked"
                    : progress && progress.completed > 0
                      ? "In Progress"
                      : "Not Started"}
              </span>
            </div>

            {isLocked ? (
              <p className="text-sm text-muted-foreground">
                Requires:{" "}
                {path.prerequisites.map((slug) => pathBySlug.get(slug)?.title ?? slug).join(", ")}
              </p>
            ) : isCompleted ? (
              <p className="text-sm text-muted-foreground">All steps complete</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {progress?.completed ?? 0} of {progress?.total ?? 0} steps complete
                </p>
                {progress?.nextStep && (
                  <p className="text-sm text-muted-foreground/70 mt-1">
                    Next: {progress.nextStep.title}
                  </p>
                )}
              </>
            )}

            <div className="mt-2">
              <Progress
                value={progress ? (progress.completed / Math.max(progress.total, 1)) * 100 : 0}
                className="h-2"
                aria-valuenow={progress?.completed ?? 0}
                aria-valuemax={progress?.total ?? 0}
              />
            </div>
          </div>

          {!isLocked && (
            <div className="flex-shrink-0 flex items-center gap-2 mt-1">
              {!isCompleted && progress && progress.completed > 0 && (
                <Button variant="ghost" size="sm" className="text-primary" tabIndex={-1}>
                  Continue <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              )}
              {!isCompleted && progress && progress.completed === 0 && (
                <Button variant="ghost" size="sm" className="text-primary" tabIndex={-1}>
                  Begin <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              )}
            </div>
          )}
        </div>
      </button>

      {!isLast && (
        <div className="flex justify-center py-1">
          <div className="w-0.5 h-4 bg-border" />
        </div>
      )}
    </div>
  );
});

/** Determines if a single step is completed based on its type */
export function isStepCompleted(
  step: QuestPathStep,
  courseProgress: Map<string, { completed: number; total: number }>,
  selfReportProgress: Map<string, boolean> | undefined,
  profile: { discord_username?: string; profile_completed?: boolean } | null,
  sysVerification?: SystemVerificationData | null
): boolean {
  switch (step.step_type) {
    case "course": {
      if (!step.linked_phase) return false;
      const progress = courseProgress.get(step.linked_phase);
      return (progress?.completed ?? 0) > 0 && progress?.total === progress?.completed;
    }
    case "self_report":
      return selfReportProgress?.get(step.id) ?? false;
    case "system_verified": {
      const filter = step.linked_filter as Record<string, unknown> | null;
      if (step.linked_table === "profiles") {
        if (filter?.field === "profile_completed") return !!profile?.profile_completed;
        if (filter?.field === "discord_username" && filter?.not_empty)
          return !!profile?.discord_username;
        if (filter?.auto_after_step) return false;
      }
      if (step.linked_table === "class_certifications" && sysVerification) {
        if (filter?.match_user) return sysVerification.classCertifications.length > 0;
      }
      if (step.linked_table === "project_applications" && sysVerification && filter) {
        const field = filter.field as string;
        const value = filter.value as string;
        return sysVerification.projectApplications.some((pa) => {
          if (field === "applicant_status") return pa.applicant_status === value;
          if (field === "status") return pa.status === value;
          return false;
        });
      }
      return false;
    }
    case "application": {
      const filter = step.linked_filter as Record<string, unknown> | null;
      if (step.linked_table === "general_applications" && sysVerification && filter) {
        const field = filter.field as string;
        const value = filter.value as string;
        return sysVerification.generalApplications.some((ga) => {
          if (field === "status") {
            // "submitted" matches both "submitted" and "completed" statuses
            if (value === "submitted")
              return ga.status === "submitted" || ga.status === "completed";
            return ga.status === value;
          }
          return false;
        });
      }
      if (step.linked_table === "project_applications" && sysVerification && filter) {
        const field = filter.field as string;
        const value = filter.value as string;
        return sysVerification.projectApplications.some((pa) => {
          if (field === "status") {
            if (value === "submitted")
              return pa.status === "submitted" || pa.status === "completed";
            return pa.status === value;
          }
          return false;
        });
      }
      return false;
    }
    default:
      return false;
  }
}
