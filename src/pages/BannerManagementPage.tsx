/**
 * BannerManagementPage
 * Admin page for creating, editing, archiving system banners.
 */
import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@/lib/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { usePageHeader } from "@/contexts/PageHeaderContext";
import {
  fetchAllBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  type AdminBanner,
  type BannerInsert,
  type BannerUpdate,
} from "@/services/banner.service";
import { SectionTitle } from "@/components/ui/typography";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Eye, EyeOff, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { sanitizeHtml } from "@/lib/security";
import { RichTextEditor } from "@/components/RichTextEditor";
import { useServerDraft } from "@/hooks/use-server-draft";
import { DraftRestoredBanner } from "@/components/forms/DraftRestoredBanner";
import { AutosaveStatus } from "@/components/ui/AutosaveStatus";

interface BannerDraftPayload {
  title: string;
  body_html: string;
  status: "draft" | "published" | "archived";
  reopen_after_dismiss: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  published: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  archived: "bg-orange-500/15 text-orange-400 border-orange-500/30",
};

function BannerFormDialog({
  open,
  onOpenChange,
  banner,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  banner: AdminBanner | null;
  onSave: (data: BannerDraftPayload) => Promise<boolean>;
  saving: boolean;
}) {
  const isCreate = !banner;
  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [status, setStatus] = useState<"draft" | "published" | "archived">("draft");
  const [reopenAfterDismiss, setReopenAfterDismiss] = useState(false);

  // Server-side draft only for create mode (edit mode persists straight to the row).
  const EMPTY_DRAFT: BannerDraftPayload = {
    title: "",
    body_html: "",
    status: "draft",
    reopen_after_dismiss: false,
  };
  const draft = useServerDraft<BannerDraftPayload>({
    draftKey: "banner:new",
    schemaVersion: 1,
    initialValue: EMPTY_DRAFT,
    enabled: open && isCreate,
    label: "banner-form",
  });

  // Hydrate dialog state when dialog opens (edit -> from row, create -> from draft).
  useEffect(() => {
    if (!open) return;
    if (isCreate) {
      // Wait for draft hydration; if a draft exists use it, else start blank.
      if (!draft.hydrating) {
        const src = draft.restored ? draft.value : EMPTY_DRAFT;
        setTitle(src.title);
        setBodyHtml(src.body_html);
        setStatus(src.status);
        setReopenAfterDismiss(src.reopen_after_dismiss);
      }
    } else {
      setTitle(banner?.title ?? "");
      setBodyHtml(banner?.body_html ?? "");
      setStatus(banner?.status ?? "draft");
      setReopenAfterDismiss(banner?.reopen_after_dismiss ?? false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, banner, isCreate, draft.hydrating, draft.restored]);

  // Mirror local state into the draft buffer.
  useEffect(() => {
    if (!isCreate || !open) return;
    draft.setValue({ title, body_html: bodyHtml, status, reopen_after_dismiss: reopenAfterDismiss });
  }, [title, bodyHtml, status, reopenAfterDismiss, isCreate, open, draft]);

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    onSave({
      title: title.trim(),
      body_html: sanitizeHtml(bodyHtml),
      status,
      reopen_after_dismiss: reopenAfterDismiss,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{banner ? "Edit Banner" : "Create Banner"}</DialogTitle>
          <DialogDescription>
            {banner ? "Update the banner details below." : "Create a new system banner with a title, rich text body, and display settings."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isCreate && draft.restored && (
            <DraftRestoredBanner
              restoredAt={draft.restoredAt}
              onDiscard={async () => {
                await draft.clearDraft();
                setTitle("");
                setBodyHtml("");
                setStatus("draft");
                setReopenAfterDismiss(false);
              }}
              noun="banner draft"
            />
          )}

          <div className="space-y-2">
            <Label htmlFor="banner-title">Title</Label>
            <Input
              id="banner-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Banner title"
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label>Body (supports text, emojis, and links)</Label>
            <RichTextEditor
              content={bodyHtml}
              onChange={setBodyHtml}
              placeholder="Write your banner message here... You can add emojis 🎉, links, and formatting."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="banner-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger id="banner-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="reopen-after-dismiss"
              checked={reopenAfterDismiss}
              onCheckedChange={setReopenAfterDismiss}
            />
            <Label htmlFor="reopen-after-dismiss" className="cursor-pointer">
              Reopen after dismissing
              <span className="block text-xs text-muted-foreground">
                When enabled, the banner reappears on next visit even after a user dismisses it.
              </span>
            </Label>
          </div>
        </div>

        <DialogFooter>
          {isCreate && (
            <div className="mr-auto">
              <AutosaveStatus status={draft.status} lastSavedAt={draft.lastSavedAt} onRetry={() => void draft.flush()} />
            </div>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving…" : banner ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BannerManagementPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { setHeader } = usePageHeader();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminBanner | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminBanner | null>(null);

  useEffect(() => {
    setHeader({
      title: "Banner Management",
      breadcrumbs: [
        { label: "Admin", href: "/admin/users" },
        { label: "Banners" },
      ],
    });
    return () => setHeader(null);
  }, [setHeader]);

  const { data: banners = [], isLoading } = useQuery({
    queryKey: ["admin-banners"],
    queryFn: fetchAllBanners,
  });

  const createMutation = useMutation({
    mutationFn: (data: BannerInsert) => createBanner(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-banners"] });
      queryClient.invalidateQueries({ queryKey: ["published-banners"] });
      toast.success("Banner created", { duration: 30000 });
      setFormOpen(false);
    },
    onError: (e: Error) => toast.error(e.message, { duration: 30000 }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: BannerUpdate }) => updateBanner(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-banners"] });
      queryClient.invalidateQueries({ queryKey: ["published-banners"] });
      toast.success("Banner updated", { duration: 30000 });
      setFormOpen(false);
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message, { duration: 30000 }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBanner(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-banners"] });
      queryClient.invalidateQueries({ queryKey: ["published-banners"] });
      toast.success("Banner deleted", { duration: 30000 });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast.error(e.message, { duration: 30000 }),
  });

  const handleSave = useCallback(
    (data: { title: string; body_html: string; status: "draft" | "published" | "archived"; reopen_after_dismiss: boolean }) => {
      if (editing) {
        updateMutation.mutate({ id: editing.id, updates: data });
      } else {
        createMutation.mutate({ ...data, created_by: user!.id });
      }
    },
    [editing, user, createMutation, updateMutation],
  );

  const handleEdit = (banner: AdminBanner) => {
    setEditing(banner);
    setFormOpen(true);
  };

  const handleNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="container-app py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <SectionTitle className="text-lg">System Banners</SectionTitle>
          <p className="text-sm text-muted-foreground">Create and manage banners shown to all users across the platform.</p>
        </div>
        <Button onClick={handleNew}>
          New Banner
        </Button>
      </div>

      {banners.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No banners created yet.</p>
            <Button variant="outline" className="mt-4" onClick={handleNew}>
              Create your first banner
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {banners.map((banner) => (
            <Card key={banner.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <CardTitle className="text-base truncate">{banner.title}</CardTitle>
                    <Badge variant="outline" className={STATUS_COLORS[banner.status]}>
                      {banner.status}
                    </Badge>
                    {banner.reopen_after_dismiss && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <RotateCcw className="h-3 w-3" />
                        Reopens
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(banner)} aria-label="Edit banner">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        updateMutation.mutate({
                          id: banner.id,
                          updates: { status: banner.status === "published" ? "archived" : "published" },
                        })
                      }
                      aria-label={banner.status === "published" ? "Archive banner" : "Publish banner"}
                    >
                      {banner.status === "published" ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(banner)}
                      aria-label="Delete banner"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div
                  className="text-sm text-muted-foreground prose prose-sm dark:prose-invert max-w-none line-clamp-3"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(banner.body_html) }}
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Created {new Date(banner.created_at).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <BannerFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        banner={editing}
        onSave={handleSave}
        saving={createMutation.isPending || updateMutation.isPending}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete banner?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}" will be permanently removed. You can't undo this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete banner
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
