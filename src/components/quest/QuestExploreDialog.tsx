import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Plus, Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useQuestPaths, useAddQuestPath } from "@/hooks/use-quest";
import { useQuestPathMaps } from "@/lib/quest/path-maps";
import { cn } from "@/lib/utils";

interface QuestExploreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedPathIds: string[];
  completedPathSlugs: Set<string>;
}

export function QuestExploreDialog({
  open,
  onOpenChange,
  selectedPathIds,
  completedPathSlugs,
}: QuestExploreDialogProps) {
  const { data: paths } = useQuestPaths();
  const { bySlug: pathBySlug } = useQuestPathMaps(paths);
  const addPath = useAddQuestPath();
  const [search, setSearch] = useState("");

  const availablePaths = useMemo(() => {
    if (!paths) return [];
    return paths
      .filter((p) => !selectedPathIds.includes(p.id))
      .filter((p) => {
        if (!search) return true;
        return p.title.toLowerCase().includes(search.toLowerCase()) ||
          p.description.toLowerCase().includes(search.toLowerCase());
      });
  }, [paths, selectedPathIds, search]);

  const handleAdd = async (pathId: string) => {
    await addPath.mutateAsync(pathId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Explore More Paths</DialogTitle>
          <DialogDescription>
            Add paths to your journey. You can start them whenever you're ready.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search paths..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="space-y-3">
          {availablePaths.length === 0 && (
            <p className="text-center text-muted-foreground py-8">
              {search ? "No matching paths found" : "You've added all available paths!"}
            </p>
          )}
          {availablePaths.map((path) => {
            const prereqsMet = path.prerequisites.every((slug) => completedPathSlugs.has(slug));
            const missingPrereqs = path.prerequisites
              .filter((slug) => !completedPathSlugs.has(slug))
              .map((slug) => pathBySlug.get(slug)?.title ?? slug);

            return (
              <div key={path.id} className="card-elevated p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-foreground">{path.title}</h3>
                      <span className={cn(
                        "text-xs font-medium px-2 py-0.5 rounded-full",
                        path.level === "advanced"
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "bg-primary/10 text-primary"
                      )}>
                        {path.level === "advanced" ? "Advanced" : "Beginner"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{path.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">{path.estimated_duration}</p>
                    {!prereqsMet && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                        <Lock className="h-3 w-3" />
                        <span>Requires: {missingPrereqs.join(", ")}</span>
                      </div>
                    )}
                  </div>
                  <Button
                    variant={prereqsMet ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleAdd(path.id)}
                    disabled={addPath.isPending}
                    className="flex-shrink-0"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
