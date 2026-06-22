/**
 * Learner view of a class curriculum — mirrors the core-course UX:
 * collapsible sections, per-module completion checkbox, progress bar.
 */
import { useMemo } from "react";
import { CheckCircle2, Circle, Clock, Loader2, Video } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useAuth } from "@/contexts/AuthContext";
import { sanitizeHtml } from "@/lib/security";
import { ClassCurriculumService } from "../services/classCurriculum.service";
import { useClassCurriculum, useClassCurriculumProgress, useInvalidateClassCurriculum } from "../hooks/useClassCurriculum";
import { ClassModuleVideoEmbed } from "./VideoEmbed";

interface Props { classId: string }

export function LearnerCurriculumView({ classId }: Props) {
  const { user } = useAuth();
  const { data, isLoading } = useClassCurriculum(classId);
  const { data: progress = [] } = useClassCurriculumProgress(classId, user?.id);
  const invalidate = useInvalidateClassCurriculum();

  const completedSet = useMemo(
    () => new Set(progress.filter((p) => p.completed).map((p) => p.item_id)),
    [progress],
  );

  const publishedSections = (data?.sections ?? []).filter((s) => s.status === "published");
  const publishedItemsBySection = useMemo(() => {
    const out: Record<string, typeof data["itemsBySection"][string]> = {};
    for (const s of publishedSections) {
      out[s.id] = (data?.itemsBySection[s.id] ?? []).filter((i) => i.status === "published");
    }
    return out;
  }, [data, publishedSections]);

  const allItems = publishedSections.flatMap((s) => publishedItemsBySection[s.id] ?? []);
  const requiredItems = allItems.filter((i) => i.required);
  const completedRequired = requiredItems.filter((i) => completedSet.has(i.id)).length;
  const pct = requiredItems.length === 0 ? 0 : Math.round((completedRequired / requiredItems.length) * 100);

  const toggle = async (itemId: string, next: boolean) => {
    try {
      await ClassCurriculumService.toggleCompletion(itemId, next);
      invalidate(classId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save progress");
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  if (publishedSections.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Your teacher hasn't published any modules yet. Check back soon.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">Your progress</span>
          <span className="text-muted-foreground">{completedRequired} of {requiredItems.length} required modules</span>
        </div>
        <Progress value={pct} aria-label={`${pct}% complete`} />
      </div>

      <Accordion type="multiple" defaultValue={publishedSections.map((s) => s.id)} className="space-y-2">
        {publishedSections.map((section) => {
          const items = publishedItemsBySection[section.id] ?? [];
          const sectionDone = items.filter((i) => completedSet.has(i.id)).length;
          return (
            <AccordionItem key={section.id} value={section.id} className="rounded-md border border-border bg-card">
              <AccordionTrigger className="px-4 hover:no-underline">
                <div className="flex-1 text-left">
                  <div className="font-semibold text-foreground">{section.title}</div>
                  {section.summary && <div className="text-xs text-muted-foreground mt-0.5">{section.summary}</div>}
                </div>
                <Badge variant="outline" className="ml-2">{sectionDone}/{items.length}</Badge>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No modules in this section yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {items.map((item) => {
                      const done = completedSet.has(item.id);
                      return (
                        <li key={item.id} className="rounded-md border border-border bg-background p-3 space-y-3">
                          <div className="flex items-start gap-3">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => toggle(item.id, !done)}
                              aria-pressed={done}
                              aria-label={done ? `Mark ${item.title} incomplete` : `Mark ${item.title} complete`}
                              className="shrink-0 mt-0.5"
                            >
                              {done
                                ? <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />
                                : <Circle className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
                            </Button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className={`font-medium ${done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                                  {item.title}
                                </h4>
                                {item.video_url && <Video className="h-3.5 w-3.5 text-muted-foreground" aria-label="Has video" />}
                                {item.duration_minutes ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3" aria-hidden="true" />{item.duration_minutes} min
                                  </span>
                                ) : null}
                                {!item.required && <Badge variant="secondary">Optional</Badge>}
                              </div>
                            </div>
                          </div>
                          {item.video_url && (
                            <ClassModuleVideoEmbed item={item} />
                          )}
                          {item.content_html && (
                            <div
                              className="prose prose-invert max-w-none text-sm text-foreground"
                              dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.content_html) }}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
