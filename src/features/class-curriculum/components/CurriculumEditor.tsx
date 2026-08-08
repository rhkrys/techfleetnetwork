/**
 * Teacher curriculum editor.
 * - Drag-and-drop reordering of sections + items (dnd-kit, keyboard-accessible).
 * - Inline create/edit dialogs for sections and items.
 * - All writes route through SECURITY DEFINER RPCs (single port).
 * - Optimistic UI; rollback on error via React Query invalidation.
 */
import { useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarClock,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  Loader2,
  Send,
  Video,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ClassCurriculumService } from "../services/classCurriculum.service";
import { useClassCurriculum, useInvalidateClassCurriculum } from "../hooks/useClassCurriculum";
import { SectionEditorDialog } from "./SectionEditorDialog";
import { ItemEditorDialog } from "./ItemEditorDialog";
import { ReleasePolicyDialog } from "./ReleasePolicyDialog";
import type { ClassModuleItem, ClassModuleSection } from "../types";

interface Props {
  classId: string;
}

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  published: "bg-success/10 text-success border-success/20",
  archived: "bg-muted text-muted-foreground",
};

function SortableSection({
  section,
  children,
}: {
  section: ClassModuleSection;
  children: (handleProps: React.HTMLAttributes<HTMLButtonElement>) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="rounded-md border border-border bg-card">
      {children({ ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>)}
    </div>
  );
}

function SortableItem({
  item,
  onEdit,
  onDelete,
}: {
  item: ClassModuleItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border border-border bg-background p-2"
    >
      <button
        type="button"
        className="shrink-0 cursor-grab text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded p-1"
        aria-label={`Reorder ${item.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-foreground truncate">{item.title}</span>
          <Badge variant="outline" className={STATUS_STYLE[item.status] ?? ""}>
            {item.status}
          </Badge>
          {item.video_url && (
            <Video className="h-3.5 w-3.5 text-muted-foreground" aria-label="Has video" />
          )}
          {item.duration_minutes ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {item.duration_minutes} min
            </span>
          ) : null}
          {!item.required && <Badge variant="secondary">Optional</Badge>}
        </div>
      </div>
      <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${item.title}`}>
        <Pencil className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Delete ${item.title}`}>
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

export function CurriculumEditor({ classId }: Props) {
  const { data, isLoading, refetch } = useClassCurriculum(classId);
  const invalidate = useInvalidateClassCurriculum();

  const [sectionDialog, setSectionDialog] = useState<{
    open: boolean;
    section: ClassModuleSection | null;
  }>({ open: false, section: null });
  const [itemDialog, setItemDialog] = useState<{
    open: boolean;
    sectionId: string;
    item: ClassModuleItem | null;
  } | null>(null);
  const [confirmSection, setConfirmSection] = useState<ClassModuleSection | null>(null);
  const [confirmItem, setConfirmItem] = useState<ClassModuleItem | null>(null);
  // Second stage of the required double-confirmation for module delete (AC #6).
  const [confirmItemFinal, setConfirmItemFinal] = useState<ClassModuleItem | null>(null);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const sections = data?.sections ?? [];
  const itemsBySection = data?.itemsBySection ?? {};
  const sectionIds = useMemo(() => sections.map((s) => s.id), [sections]);

  const onSectionDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = sectionIds.indexOf(String(active.id));
    const newIdx = sectionIds.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(sectionIds, oldIdx, newIdx);
    try {
      await ClassCurriculumService.reorderSections(classId, next);
      invalidate(classId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reorder failed");
      refetch();
    }
  };

  const onItemDragEnd = async (sectionId: string, e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = (itemsBySection[sectionId] ?? []).map((i) => i.id);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(ids, oldIdx, newIdx);
    try {
      await ClassCurriculumService.reorderItems(sectionId, next);
      invalidate(classId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reorder failed");
      refetch();
    }
  };

  const publishAll = async () => {
    setPublishing(true);
    try {
      const n = await ClassCurriculumService.publishAll(classId);
      toast.success(n > 0 ? `Published ${n} drafts` : "No drafts to publish");
      invalidate(classId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Curriculum</h2>
          <p className="text-xs text-muted-foreground">
            Build sections and modules. Published modules are visible to every learner registered in
            any cohort of this class.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setReleaseOpen(true)}>
            <CalendarClock className="h-4 w-4 mr-1" aria-hidden="true" />
            Release settings
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={publishAll}
            disabled={publishing || sections.length === 0}
          >
            {publishing && <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden="true" />}
            <Send className="h-4 w-4 mr-1" aria-hidden="true" />
            Publish drafts
          </Button>
          <Button size="sm" onClick={() => setSectionDialog({ open: true, section: null })}>
            <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
            New section
          </Button>
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No sections yet. Click <strong>New section</strong> to start building your curriculum.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onSectionDragEnd}
        >
          <SortableContext items={sectionIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {sections.map((section) => {
                const items = itemsBySection[section.id] ?? [];
                const itemIds = items.map((i) => i.id);
                return (
                  <SortableSection key={section.id} section={section}>
                    {(handleProps) => (
                      <>
                        <div className="flex items-start gap-2 p-3 border-b border-border">
                          <button
                            type="button"
                            className="shrink-0 cursor-grab text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded p-1 mt-0.5"
                            aria-label={`Reorder section ${section.title}`}
                            {...handleProps}
                          >
                            <GripVertical className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold text-foreground truncate">
                                {section.title}
                              </h3>
                              <Badge
                                variant="outline"
                                className={STATUS_STYLE[section.status] ?? ""}
                              >
                                {section.status}
                              </Badge>
                            </div>
                            {section.summary && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {section.summary}
                              </p>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSectionDialog({ open: true, section })}
                            aria-label={`Edit ${section.title}`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmSection(section)}
                            aria-label={`Delete ${section.title}`}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>

                        <div className="p-3 space-y-2">
                          {items.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic">No modules yet.</p>
                          ) : (
                            <DndContext
                              sensors={sensors}
                              collisionDetection={closestCenter}
                              onDragEnd={(e) => onItemDragEnd(section.id, e)}
                            >
                              <SortableContext
                                items={itemIds}
                                strategy={verticalListSortingStrategy}
                              >
                                <div className="space-y-2">
                                  {items.map((item) => (
                                    <SortableItem
                                      key={item.id}
                                      item={item}
                                      onEdit={() =>
                                        setItemDialog({ open: true, sectionId: section.id, item })
                                      }
                                      onDelete={() => setConfirmItem(item)}
                                    />
                                  ))}
                                </div>
                              </SortableContext>
                            </DndContext>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setItemDialog({ open: true, sectionId: section.id, item: null })
                            }
                          >
                            <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
                            Add module
                          </Button>
                        </div>
                      </>
                    )}
                  </SortableSection>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <ReleasePolicyDialog
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        classId={classId}
        onSaved={() => invalidate(classId)}
      />

      <SectionEditorDialog
        key={sectionDialog.section?.id ?? "new"}
        open={sectionDialog.open}
        onOpenChange={(open) => setSectionDialog((s) => ({ ...s, open }))}
        classId={classId}
        section={sectionDialog.section}
        onSaved={() => invalidate(classId)}
      />

      {itemDialog && (
        <ItemEditorDialog
          key={itemDialog.item?.id ?? `new:${itemDialog.sectionId}`}
          open={itemDialog.open}
          onOpenChange={(open) => setItemDialog(open ? itemDialog : null)}
          sectionId={itemDialog.sectionId}
          item={itemDialog.item}
          onSaved={() => invalidate(classId)}
        />
      )}

      <ConfirmDialog
        open={!!confirmSection}
        onOpenChange={(open) => !open && setConfirmSection(null)}
        title="Delete section"
        consequence={
          confirmSection
            ? `Delete "${confirmSection.title}" and all of its modules? This cannot be undone.`
            : ""
        }
        actionLabel="Delete section"
        destructive
        onConfirm={async () => {
          if (!confirmSection) return;
          try {
            await ClassCurriculumService.deleteSection(confirmSection.id);
            toast.success("Section deleted");
            invalidate(classId);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Delete failed");
          } finally {
            setConfirmSection(null);
          }
        }}
      />

      {/* Module delete — step 1 of a required double confirmation (AC #6). */}
      <ConfirmDialog
        open={!!confirmItem}
        onOpenChange={(open) => !open && setConfirmItem(null)}
        title="Delete this module?"
        consequence={
          confirmItem
            ? `"${confirmItem.title}" will be permanently deleted and will no longer be available to any students. Its files and links are removed too. This cannot be undone.`
            : ""
        }
        actionLabel="Continue"
        destructive
        onConfirm={() => {
          // Advance to the final confirmation rather than deleting immediately.
          setConfirmItemFinal(confirmItem);
          setConfirmItem(null);
        }}
      />

      {/* Module delete — step 2: final confirmation, then the hard delete. */}
      <ConfirmDialog
        open={!!confirmItemFinal}
        onOpenChange={(open) => !open && setConfirmItemFinal(null)}
        title="Confirm permanent deletion"
        consequence={
          confirmItemFinal
            ? `Last check: permanently delete "${confirmItemFinal.title}"? Students will immediately lose access.`
            : ""
        }
        actionLabel="Yes, delete permanently"
        destructive
        onConfirm={async () => {
          if (!confirmItemFinal) return;
          try {
            await ClassCurriculumService.deleteItem(confirmItemFinal.id);
            toast.success("Module deleted");
            invalidate(classId);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Delete failed");
          } finally {
            setConfirmItemFinal(null);
          }
        }}
      />
    </div>
  );
}
