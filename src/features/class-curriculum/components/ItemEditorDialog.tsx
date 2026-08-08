/**
 * Modal dialog for creating/editing a class module item.
 * - Title, action type, video URL, WYSIWYG content, duration, required, status.
 * - Server sanitizes HTML and derives video provider; client passes raw values.
 */
import { useEffect, useState } from "react";
import { ExternalLink, FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RichTextEditor } from "@/components/RichTextEditor";
import { ClassCurriculumService } from "../services/classCurriculum.service";
import type {
  ClassModuleActionType,
  ClassModuleAttachment,
  ClassModuleItem,
  ClassModuleStatus,
} from "../types";

// Client mirror of the server's allowlist (register_class_module_file) — the
// server re-validates regardless; this is only for a good file-picker UX.
const FILE_ACCEPT = ".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.zip";
const MAX_FILE_BYTES = 100 * 1024 * 1024;

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

  // Attachments (files + links). Only manageable once the module row exists,
  // since they reference item_id server-side.
  const [attachments, setAttachments] = useState<ClassModuleAttachment[]>([]);
  const [attBusy, setAttBusy] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(item?.title ?? "");
    setContentHtml(item?.content_html ?? "");
    setVideoUrl(item?.video_url ?? "");
    setActionType(item?.action_type ?? "read");
    setDuration(item?.duration_minutes ? String(item.duration_minutes) : "");
    setRequired(item?.required ?? true);
    setStatus(item?.status ?? "draft");
    setLinkUrl("");
    setLinkLabel("");
    if (item?.id) {
      ClassCurriculumService.fetchItemAttachments(item.id)
        .then(setAttachments)
        .catch(() => setAttachments([]));
    } else {
      setAttachments([]);
    }
  }, [item, open]);

  const reloadAttachments = async () => {
    if (!item?.id) return;
    setAttachments(await ClassCurriculumService.fetchItemAttachments(item.id).catch(() => []));
  };

  const addLink = async () => {
    if (!item?.id) return;
    // Cheap client pre-check; the RPC is the real gate (rejects javascript:/data:/relative).
    if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(linkUrl.trim())) {
      toast.error("Enter a valid http(s) URL");
      return;
    }
    setAttBusy(true);
    try {
      await ClassCurriculumService.upsertLink({
        item_id: item.id,
        url: linkUrl.trim(),
        label: linkLabel.trim() || null,
      });
      setLinkUrl("");
      setLinkLabel("");
      await reloadAttachments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add link");
    } finally {
      setAttBusy(false);
    }
  };

  const uploadFile = async (file: File) => {
    if (!item?.id) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error("File exceeds the 100 MB limit");
      return;
    }
    setAttBusy(true);
    try {
      await ClassCurriculumService.uploadFile({ class_id: item.class_id, item_id: item.id, file });
      await reloadAttachments();
      toast.success("File uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setAttBusy(false);
    }
  };

  const removeAttachment = async (id: string) => {
    setAttBusy(true);
    try {
      await ClassCurriculumService.deleteAttachment(id);
      await reloadAttachments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove");
    } finally {
      setAttBusy(false);
    }
  };

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
            <Input
              id="cm-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cm-action">Action</Label>
              <Select
                value={actionType}
                onValueChange={(v) => setActionType(v as ClassModuleActionType)}
              >
                <SelectTrigger id="cm-action">
                  <SelectValue />
                </SelectTrigger>
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
                <SelectTrigger id="cm-status">
                  <SelectValue />
                </SelectTrigger>
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
            <RichTextEditor
              content={contentHtml}
              onChange={setContentHtml}
              placeholder="Module content…"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <div className="font-medium text-sm">Required for completion</div>
              <p className="text-xs text-muted-foreground">Counts toward learner progress.</p>
            </div>
            <Switch checked={required} onCheckedChange={setRequired} aria-label="Required" />
          </div>

          {/* Files & links (FR-CONTENT-04/05). Available once the module exists. */}
          <div className="space-y-2 rounded-md border border-border p-3">
            <Label>Files &amp; links</Label>
            {!item?.id ? (
              <p className="text-xs text-muted-foreground">
                Save the module first, then add files and links.
              </p>
            ) : (
              <>
                {attachments.length > 0 && (
                  <ul className="space-y-1.5">
                    {attachments.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 text-sm">
                        {a.kind === "file" ? (
                          <FileText
                            className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                            aria-hidden="true"
                          />
                        ) : (
                          <ExternalLink
                            className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        <span className="flex-1 min-w-0 truncate">
                          {a.kind === "file" ? a.file_name : a.label || a.url}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={attBusy}
                          onClick={() => removeAttachment(a.id)}
                          aria-label="Remove attachment"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[160px] space-y-1.5">
                    <Label htmlFor="cm-link-url" className="text-xs">
                      Link URL
                    </Label>
                    <Input
                      id="cm-link-url"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="https://…"
                      inputMode="url"
                      maxLength={2048}
                    />
                  </div>
                  <div className="flex-1 min-w-[140px] space-y-1.5">
                    <Label htmlFor="cm-link-label" className="text-xs">
                      Label (optional)
                    </Label>
                    <Input
                      id="cm-link-label"
                      value={linkLabel}
                      onChange={(e) => setLinkLabel(e.target.value)}
                      maxLength={200}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addLink}
                    disabled={attBusy || !linkUrl.trim()}
                  >
                    <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
                    Add link
                  </Button>
                </div>

                <div>
                  <Button asChild type="button" variant="outline" size="sm" disabled={attBusy}>
                    <label htmlFor="cm-file" className="cursor-pointer">
                      {/* Nested input keeps the label both associated (htmlFor+id) and control-bearing. */}
                      <input
                        id="cm-file"
                        type="file"
                        accept={FILE_ACCEPT}
                        aria-label="Upload a file attachment"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadFile(f);
                          e.currentTarget.value = "";
                        }}
                      />
                      {attBusy ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />
                      ) : (
                        <Upload className="h-4 w-4 mr-1" aria-hidden="true" />
                      )}
                      Upload file
                    </label>
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1">
                    PDF, Office docs, images, or zip — up to 100 MB. Videos: paste a
                    YouTube/Vimeo/Loom link above (not uploaded).
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden="true" />}
            Save module
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
