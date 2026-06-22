import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClassCurriculumService } from "../services/classCurriculum.service";
import type { ClassModuleSection, ClassModuleStatus } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  section: ClassModuleSection | null;
  onSaved: () => void;
}

export function SectionEditorDialog({ open, onOpenChange, classId, section, onSaved }: Props) {
  const [title, setTitle] = useState(section?.title ?? "");
  const [summary, setSummary] = useState(section?.summary ?? "");
  const [status, setStatus] = useState<ClassModuleStatus>(section?.status ?? "draft");
  const [saving, setSaving] = useState(false);

  // Reset when opening with a different section.
  if (open && section && section.id !== (open as unknown as { id?: string } | null)?.id) {
    // no-op; useEffect would loop. We rely on remount via key in parent.
  }

  const submit = async () => {
    if (!title.trim()) { toast.error("Title is required"); return; }
    setSaving(true);
    try {
      await ClassCurriculumService.upsertSection({
        class_id: classId,
        id: section?.id ?? null,
        title: title.trim(),
        summary: summary.trim() || null,
        status,
      });
      toast.success(section ? "Section saved" : "Section created");
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{section ? "Edit section" : "New section"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sec-title">Title</Label>
            <Input id="sec-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sec-summary">Summary (optional)</Label>
            <Textarea id="sec-summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sec-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ClassModuleStatus)}>
              <SelectTrigger id="sec-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden="true" />}
            Save section
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
