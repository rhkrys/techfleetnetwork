import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/design-system";

import { Compass, Rocket, Search } from "lucide-react";
import { useQuestPaths, useUserQuestSelections } from "@/hooks/use-quest";
import { useQuestPathMaps } from "@/lib/quest/path-maps";
import { QuestPickerDialog } from "./QuestPickerDialog";
import { QuestPreviewDialog } from "./QuestPreviewDialog";
import { QuestCongratulationsDialog } from "./QuestCongratulationsDialog";
import questEmptyState from "@/assets/quest-empty-state.png";

export function QuestOverview() {
  const navigate = useNavigate();
  const { data: paths, isLoading: pathsLoading } = useQuestPaths();
  const { data: selections, isLoading: selectionsLoading } = useUserQuestSelections();
  const { byId: pathById } = useQuestPathMaps(paths);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewPathId, setPreviewPathId] = useState<string | null>(null);
  const [congratsPathId, setCongratsPathId] = useState<string | null>(null);

  const selectedPathIds = useMemo(() => selections?.map((s) => s.path_id) ?? [], [selections]);

  const completedPathSlugs = useMemo(() => {
    if (!selections || !paths) return new Set<string>();
    const completedIds = new Set(selections.filter((s) => s.completed_at).map((s) => s.path_id));
    return new Set(paths.filter((p) => completedIds.has(p.id)).map((p) => p.slug));
  }, [selections, paths]);

  const hasActiveQuest = selectedPathIds.length > 0;

  const handleQuestSelected = (pathId: string) => {
    setPreviewPathId(null);
    setCongratsPathId(pathId);
  };

  const handleCongratsClose = () => {
    const pathId = congratsPathId;
    setCongratsPathId(null);
    if (pathId) {
      navigate(`/my-journey/quest/${pathId}`);
    }
  };

  if (pathsLoading || selectionsLoading) {
    return (
      <div
        className="flex items-center justify-center py-16"
        role="status"
        aria-label="Loading quests"
      >
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full">
      {hasActiveQuest ? (
        <div className="space-y-3">
          {selections?.map((sel) => {
            const path = pathById.get(sel.path_id);
            if (!path) return null;
            return (
              <button
                key={sel.id}
                onClick={() => navigate(`/my-journey/quest/${path.id}`)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Rocket className="h-5 w-5 text-primary flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{path.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-1">{path.description}</p>
                </div>
                <span className="text-xs text-muted-foreground">Continue →</span>
              </button>
            );
          })}

          <div className="mt-6 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-6 text-center">
            <p className="text-base font-semibold text-foreground">Want to do more?</p>
            <p className="text-sm text-muted-foreground mt-1">Explore more quests in Tech Fleet!</p>
            <Button className="mt-4" onClick={() => setPickerOpen(true)}>
              Find More Quests
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <Compass className="h-10 w-10 text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-1">No quests yet</h2>
          <p className="text-sm text-muted-foreground max-w-sm mb-6">
            Browse available quests, review what's involved, and subscribe to begin tracking your
            progress.
          </p>
          <Button onClick={() => setPickerOpen(true)}>Find Quests</Button>
        </div>
      )}

      <QuestPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selectedPathIds={selectedPathIds}
        completedPathSlugs={completedPathSlugs}
        onPreview={(id) => {
          setPickerOpen(false);
          setPreviewPathId(id);
        }}
      />

      {previewPathId && (
        <QuestPreviewDialog
          open={!!previewPathId}
          onOpenChange={(open) => {
            if (!open) setPreviewPathId(null);
          }}
          pathId={previewPathId}
          completedPathSlugs={completedPathSlugs}
          onQuestSelected={handleQuestSelected}
          onFindAnother={() => {
            setPreviewPathId(null);
            setPickerOpen(true);
          }}
        />
      )}

      {congratsPathId && (
        <QuestCongratulationsDialog
          open={!!congratsPathId}
          pathTitle={pathById.get(congratsPathId)?.title ?? ""}
          onClose={handleCongratsClose}
        />
      )}
    </div>
  );
}
