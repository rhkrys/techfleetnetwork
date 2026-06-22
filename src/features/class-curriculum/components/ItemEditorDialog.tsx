/**
 * Modal dialog for creating/editing a class module item.
 * - Title, action type, video URL, WYSIWYG content, duration, required, status.
 * - Server sanitizes HTML and derives video provider; client passes raw values.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichTextEditor } from "@/components/RichTextEditor";
import { ClassCurriculumService } from "../services/classCurriculum.service";
import type { ClassModuleActionType, ClassModuleItem, ClassModuleStatus } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionId: string;
  item: ClassModuleItem | null;
  onSaved: () => void;
}

export function ItemEditorDialog({ open, onOpenChange, sectionId, item, onSaved }: Props) {
  const [title, setTitle] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [actionType, setActionType] = useState<ClassModuleActionType>("read");
  const [duration, setDuration] = useState<string>("");
  const [required, setRequired] = useState(true);
  const [status, setStatus] = useState<ClassModuleStatus>("draft");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(item?.title ?? "");
    setContentHtml(item?.content_html ?? "");
    setVideoUrl(item?.video_url ?? "");
    setActionType(item?.action_type ?? "read");
    setDuration(item?.duration_minutes ? String(item.duration_minutes) : "");
    setRequired(item?.required ?? true);
    setStatus(item?.status ?? "draft");
  }, [item, open]);

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      await ClassCurriculumService.upsertItem({
        section_id: sectionId,
        id: item?.id ?? null,
        title: title.trim(),
        content_html: contentHtml || null,
        video_url: videoUrl.trim() || null,
        action_type: actionType,
        duration_minutes: duration ? Math.max(0, parseInt(duration, 10) || 0) : null,
        required,
        status,
      });
      toast.success(item ? "Module saved" : "Module created");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit module" : "New module"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cm-title">Title</Label>
            <Input id="cm-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cm-action">Action</Label>
              <Select value={actionType} onValueChange={(v) => setActionType(v as ClassModuleActionType)}>
                <SelectTrigger id="cm-action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">Read</SelectItem>
                  <SelectItem value="watch">Watch</SelectItem>
                  <SelectItem value="task">Complete task</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cm-duration">Estimated minutes</Label>
              <Input
                id="cm-duration"
                type="number"
                min={0}
                max={100000}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cm-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ClassModuleStatus)}>
                <SelectTrigger id="cm-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cm-video">Video URL (YouTube, Vimeo, Loom, or Google Meet)</Label>
            <Input
              id="cm-video"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              maxLength={2048}
              inputMode="url"
            />
            <p className="text-xs text-muted-foreground">
              Google Meet links cannot be embedded; learners see a join button instead.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Content</Label>
            <RichTextEditor content={contentHtml} onChange={setContentHtml} placeholder="Module content…" />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <div className="font-medium text-sm">Required for completion</div>
              <p className="text-xs text-muted-foreground">Counts toward learner progress.</p>
            </div>
            <Switch checked={required} onCheckedChange={setRequired} aria-label="Required" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden="true" />}
            Save module
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
