/**
 * Class-level release policy editor (D2: exactly one policy per class).
 * Writes through set_class_release_policy, which validates the required
 * parameter server-side. The four options mirror the release engine
 * (public.class_item_release and lib/release.ts).
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClassCurriculumService } from "../services/classCurriculum.service";
import type { ClassReleasePolicy } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  onSaved: () => void;
}

const POLICY_HELP: Record<ClassReleasePolicy, string> = {
  all_at_once: "All published modules are visible to learners immediately.",
  by_date: "All published modules open at one date and time.",
  after_previous_completion:
    "Each module unlocks after the learner completes the previous required one.",
  relative_to_cohort_start:
    "Modules open a set number of days after each learner's own cohort start date.",
};

export function ReleasePolicyDialog({ open, onOpenChange, classId, onSaved }: Props) {
  const [policy, setPolicy] = useState<ClassReleasePolicy>("all_at_once");
  const [releaseAt, setReleaseAt] = useState("");
  const [offsetDays, setOffsetDays] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    ClassCurriculumService.fetchReleaseSettings(classId)
      .then((s) => {
        setPolicy(s.release_policy);
        // datetime-local wants "YYYY-MM-DDTHH:mm"
        setReleaseAt(s.release_at ? s.release_at.slice(0, 16) : "");
        setOffsetDays(s.release_offset_days != null ? String(s.release_offset_days) : "");
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [open, classId]);

  const save = async () => {
    if (policy === "by_date" && !releaseAt) {
      toast.error("Pick a release date and time");
      return;
    }
    if (policy === "relative_to_cohort_start" && !offsetDays) {
      toast.error("Enter the number of days");
      return;
    }
    setSaving(true);
    try {
      await ClassCurriculumService.setReleasePolicy({
        class_id: classId,
        policy,
        release_at: policy === "by_date" ? new Date(releaseAt).toISOString() : null,
        offset_days:
          policy === "relative_to_cohort_start" ? Math.max(0, parseInt(offsetDays, 10) || 0) : null,
      });
      toast.success("Release settings saved");
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
          <DialogTitle>Release settings</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rp-policy">Release policy</Label>
              <Select value={policy} onValueChange={(v) => setPolicy(v as ClassReleasePolicy)}>
                <SelectTrigger id="rp-policy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_at_once">All at once</SelectItem>
                  <SelectItem value="by_date">On a specific date</SelectItem>
                  <SelectItem value="after_previous_completion">
                    After previous lesson completion
                  </SelectItem>
                  <SelectItem value="relative_to_cohort_start">Relative to cohort start</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{POLICY_HELP[policy]}</p>
            </div>

            {policy === "by_date" && (
              <div className="space-y-1.5">
                <Label htmlFor="rp-date">Release date &amp; time</Label>
                <Input
                  id="rp-date"
                  type="datetime-local"
                  value={releaseAt}
                  onChange={(e) => setReleaseAt(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Shown to learners in their local timezone.
                </p>
              </div>
            )}

            {policy === "relative_to_cohort_start" && (
              <div className="space-y-1.5">
                <Label htmlFor="rp-offset">Days after cohort start</Label>
                <Input
                  id="rp-offset"
                  type="number"
                  min={0}
                  max={3650}
                  value={offsetDays}
                  onChange={(e) => setOffsetDays(e.target.value)}
                />
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden="true" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
