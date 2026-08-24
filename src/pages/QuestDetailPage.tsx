import { useParams, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { Button } from "@/design-system";

import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useQuestPaths,
  useUserQuestSelections,
  useAllQuestSteps,
  useSelfReportProgress,
  useAllJourneyProgress,
} from "@/hooks/use-quest";
import { QuestPathDetail } from "@/components/quest/QuestPathDetail";
import { isStepCompleted } from "@/components/quest/QuestRoadmap";

export default function QuestDetailPage() {
  const { pathId } = useParams<{ pathId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const { data: paths, isLoading: pathsLoading } = useQuestPaths();
  const { data: selections, isLoading: selectionsLoading } = useUserQuestSelections();
  const { data: allSteps } = useAllQuestSteps();
  const { data: selfReportProgress } = useSelfReportProgress();
  const { data: allJourneyMap } = useAllJourneyProgress();

  const path = paths?.find((p) => p.id === pathId);
  const isSubscribed = selections?.some((s) => s.path_id === pathId);

  const allProgress = useMemo(() => {
    const map = new Map<string, { completed: number; total: number }>();
    if (!allJourneyMap) return map;
    for (const [phase, tasks] of allJourneyMap.entries()) {
      const completed = tasks.filter((t) => t.completed).length;
      map.set(phase, { completed, total: tasks.length });
    }
    return map;
  }, [allJourneyMap]);

  const completedPathSlugs = useMemo(() => {
    if (!paths || !allSteps) return new Set<string>();
    const set = new Set<string>();
    for (const p of paths) {
      const steps = allSteps.filter((s) => s.path_id === p.id);
      const allDone =
        steps.length > 0 &&
        steps.every((s) => isStepCompleted(s, allProgress, selfReportProgress, profile));
      if (allDone) set.add(p.slug);
    }
    return set;
  }, [paths, allSteps, allProgress, selfReportProgress, profile]);

  if (pathsLoading || selectionsLoading) {
    return (
      <div className="container-app py-8 sm:py-12">
        <div className="flex items-center justify-center py-12" role="status">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!path) {
    return (
      <div className="container-app py-8 sm:py-12">
        <Button variant="ghost" size="sm" onClick={() => navigate("/my-journey")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to My Journey
        </Button>
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold text-foreground">Quest not found</h2>
          <p className="text-muted-foreground mt-2">
            This quest may have been removed or doesn't exist.
          </p>
        </div>
      </div>
    );
  }

  if (!isSubscribed) {
    navigate("/my-journey", { replace: true });
    return null;
  }

  return (
    <div className="container-app py-8 sm:py-12">
      <QuestPathDetail
        path={path}
        onBack={() => navigate("/my-journey")}
        allProgress={allProgress}
        selfReportProgress={selfReportProgress}
        completedPathSlugs={completedPathSlugs}
        allPaths={paths ?? []}
      />
    </div>
  );
}
