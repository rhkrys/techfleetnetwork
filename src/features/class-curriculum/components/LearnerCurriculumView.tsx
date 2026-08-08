/**
 * Learner view of a class curriculum — mirrors the core-course UX (collapsible
 * sections, per-module completion, progress bar) and adds release lock states
 * and file/link attachments.
 *
 * Reads through get_class_curriculum_for_learner: the SERVER resolves
 * entitlement + release and omits the body of locked items (content, video,
 * attachments), so this component can never render content the learner isn't
 * entitled to. Locked modules show a lock + reason only.
 */
import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useAuth } from "@/contexts/AuthContext";
import { sanitizeHtml } from "@/lib/security";
import { ClassCurriculumService } from "../services/classCurriculum.service";
import {
  useLearnerCurriculum,
  useClassCurriculumProgress,
  useInvalidateClassCurriculum,
} from "../hooks/useClassCurriculum";
import { ClassModuleVideoEmbed } from "./VideoEmbed";
import type { ClassModuleAttachment, LearnerModuleItem } from "../types";

interface Props {
  classId: string;
}

function AvailabilityNote({ item }: { item: LearnerModuleItem }) {
  if (item.released) return null;
  const when = item.available_at
    ? new Date(item.available_at).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
      {when ? `Available on ${when}` : "Complete the previous lesson to unlock"}
    </div>
  );
}

function AttachmentRow({ att }: { att: ClassModuleAttachment }) {
  const [busy, setBusy] = useState(false);

  if (att.kind === "link" && att.url) {
    return (
      <a
        href={att.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        {att.label || att.url}
      </a>
    );
  }

  if (att.kind === "file" && att.storage_path) {
    const open = async () => {
      setBusy(true);
      try {
        const url = await ClassCurriculumService.signFile(att.storage_path as string);
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not open file");
      } finally {
        setBusy(false);
      }
    };
    const kb = att.size_bytes ? Math.round(att.size_bytes / 1024) : null;
    return (
      <Button variant="outline" size="sm" onClick={open} disabled={busy} className="gap-1.5">
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <span className="truncate max-w-[220px]">{att.file_name || "Download"}</span>
        {kb ? <span className="text-xs text-muted-foreground">({kb} KB)</span> : null}
        <Download className="h-3 w-3" aria-hidden="true" />
      </Button>
    );
  }

  return null;
}

export function LearnerCurriculumView({ classId }: Props) {
  const { user } = useAuth();
  const { data, isLoading } = useLearnerCurriculum(classId, user?.id);
  const { data: progress = [] } = useClassCurriculumProgress(classId, user?.id);
  const invalidate = useInvalidateClassCurriculum();

  const completedSet = useMemo(
    () => new Set(progress.filter((p) => p.completed).map((p) => p.item_id)),
    [progress]
  );

  const sections = data?.sections ?? [];
  const allItems = sections.flatMap((s) => s.items);
  const requiredItems = allItems.filter((i) => i.required);
  const completedRequired = requiredItems.filter((i) => completedSet.has(i.id)).length;
  const pct =
    requiredItems.length === 0 ? 0 : Math.round((completedRequired / requiredItems.length) * 100);

  const toggle = async (itemId: string, next: boolean) => {
    try {
      await ClassCurriculumService.toggleCompletion(itemId, next);
      invalidate(classId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save progress");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (sections.length === 0) {
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
          <span className="text-muted-foreground">
            {completedRequired} of {requiredItems.length} required modules
          </span>
        </div>
        <Progress value={pct} aria-label={`${pct}% complete`} />
      </div>

      <Accordion type="multiple" defaultValue={sections.map((s) => s.id)} className="space-y-2">
        {sections.map((section) => {
          const items = section.items;
          const sectionDone = items.filter((i) => completedSet.has(i.id)).length;
          return (
            <AccordionItem
              key={section.id}
              value={section.id}
              className="rounded-md border border-border bg-card"
            >
              <AccordionTrigger className="px-4 hover:no-underline">
                <div className="flex-1 text-left">
                  <div className="font-semibold text-foreground">{section.title}</div>
                  {section.summary && (
                    <div className="text-xs text-muted-foreground mt-0.5">{section.summary}</div>
                  )}
                </div>
                <Badge variant="outline" className="ml-2">
                  {sectionDone}/{items.length}
                </Badge>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    No modules in this section yet.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {items.map((item) => {
                      const done = completedSet.has(item.id);
                      const locked = !item.released;
                      return (
                        <li
                          key={item.id}
                          className={`rounded-md border border-border bg-background p-3 space-y-3 ${locked ? "opacity-70" : ""}`}
                        >
                          <div className="flex items-start gap-3">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => toggle(item.id, !done)}
                              aria-pressed={done}
                              disabled={locked}
                              aria-label={
                                done
                                  ? `Mark ${item.title} incomplete`
                                  : `Mark ${item.title} complete`
                              }
                              className="shrink-0 mt-0.5"
                            >
                              {locked ? (
                                <Lock
                                  className="h-5 w-5 text-muted-foreground"
                                  aria-hidden="true"
                                />
                              ) : done ? (
                                <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />
                              ) : (
                                <Circle
                                  className="h-5 w-5 text-muted-foreground"
                                  aria-hidden="true"
                                />
                              )}
                            </Button>
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4
                                  className={`font-medium ${done ? "text-muted-foreground line-through" : "text-foreground"}`}
                                >
                                  {item.title}
                                </h4>
                                {item.video_embed_url && (
                                  <Video
                                    className="h-3.5 w-3.5 text-muted-foreground"
                                    aria-label="Has video"
                                  />
                                )}
                                {item.duration_minutes ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3" aria-hidden="true" />
                                    {item.duration_minutes} min
                                  </span>
                                ) : null}
                                {!item.required && <Badge variant="secondary">Optional</Badge>}
                              </div>
                              <AvailabilityNote item={item} />
                            </div>
                          </div>

                          {!locked && item.video_embed_url && item.video_provider && (
                            <ClassModuleVideoEmbed
                              item={{
                                title: item.title,
                                video_url: item.video_embed_url,
                                video_embed_url: item.video_embed_url,
                                video_provider: item.video_provider,
                              }}
                            />
                          )}
                          {!locked && item.content_html && (
                            <div
                              className="prose prose-invert max-w-none text-sm text-foreground"
                              dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.content_html) }}
                            />
                          )}
                          {!locked && item.attachments.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              {item.attachments.map((a) => (
                                <AttachmentRow key={a.id} att={a} />
                              ))}
                            </div>
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
