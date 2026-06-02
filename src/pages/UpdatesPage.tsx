import { useState, useMemo, useEffect, Suspense } from "react";
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry";
import { sanitizeHtml } from "@/lib/security";
import { linkifyHtml } from "@/lib/linkify";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import {
  Megaphone, Plus, Trash2, LayoutList, LayoutGrid, Loader2, Video, Mic,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/use-admin";
import {
  useAnnouncements, useCreateAnnouncement, useDeleteAnnouncement, useMarkAnnouncementRead,
  useRecordAnnouncementView, useAnnouncementReadIds, useAnnouncementActions,
  useRecordAnnouncementAction,
} from "@/hooks/use-announcements";
import { stripHtml, normalizeRichTextHtml } from "@/lib/html";
import { TranslatedContent } from "@/components/i18n/TranslatedContent";
import { useUgcTranslation } from "@/hooks/useUgcTranslation";
import { RichTextEditor } from "@/components/RichTextEditor";
import type { Announcement } from "@/services/announcement.service";
import { AnnouncementViewStats } from "@/components/AnnouncementViewStats";
import { ThemedAgGrid } from "@/components/AgGrid";
import type { ColDef } from "ag-grid-community";

const MediaRecorder = lazy(() => import("@/components/VideoRecorder"));

type ViewMode = "table" | "card";

/**
 * Renders an announcement body in the member's locale, falling back to source
 * while the worker fills the cache. HTML is sanitized after translation.
 */
function TranslatedAnnouncementBody({ id, html }: { id: string; html: string }) {
  const { text, isTranslating } = useUgcTranslation({
    entityTable: "announcements",
    entityId: id,
    columnName: "body_html",
    sourceText: html,
    contentFormat: "html",
  });
  return (
    <>
      {isTranslating && (
        <p className="text-xs text-muted-foreground italic" role="status" aria-live="polite">
          Translating…
        </p>
      )}
      <div
        className="prose prose-sm dark:prose-invert max-w-none break-words"
        style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
        data-no-translate
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(linkifyHtml(normalizeRichTextHtml(text))) }}
      />
    </>
  );
}

export default function UpdatesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { isAdmin } = useAdmin();
  const { data: announcements = [], isLoading: loading } = useAnnouncements();
  const createMutation = useCreateAnnouncement();
  const deleteMutation = useDeleteAnnouncement();
  const markReadMutation = useMarkAnnouncementRead();
  const recordViewMutation = useRecordAnnouncementView();

  const [viewMode, setViewMode] = useState<ViewMode>("card");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);

  // Auto-open announcement from email link
  useEffect(() => {
    const highlightId = searchParams.get("highlight");
    if (highlightId && announcements.length > 0) {
      const target = announcements.find((a) => a.id === highlightId);
      if (target) {
        selectAndMarkRead(target);
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, announcements]);

  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newVideoUrl, setNewVideoUrl] = useState<string | null>(null);
  const [newAudioUrl, setNewAudioUrl] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);

  const selectAndMarkRead = (a: Announcement) => {
    setSelectedAnnouncement(a);
    markReadMutation.mutate(a.id);
    recordViewMutation.mutate(a.id);
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) { toast.error("Add a title before posting."); return; }
    if (!newBody.trim() || newBody === "<p></p>") { toast.error("Add a message before posting."); return; }
    if (mediaBusy) { toast.error("Hang tight — your recording is still uploading."); return; }
    if (!user) return;
    try {
      await createMutation.mutateAsync({ title: newTitle.trim(), bodyHtml: newBody, userId: user.id, videoUrl: newVideoUrl, audioUrl: newAudioUrl });
      toast.success("Announcement posted — your team will see it next time they sign in.");
      setCreateOpen(false);
      setNewTitle("");
      setNewBody("");
      setNewVideoUrl(null);
      setNewAudioUrl(null);
    } catch {
      toast.error("We couldn't post that announcement. Please try again.");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success("Announcement deleted.");
      setDeleteTarget(null);
    } catch {
      toast.error("We couldn't delete that announcement. Please try again.");
    }
  };

  const columnDefs = useMemo<ColDef<Announcement>[]>(() => [
    {
      headerName: "Title",
      field: "title",
      flex: 3,
    },
    {
      headerName: "Preview",
      flex: 2,
      valueGetter: (params) => {
        const plain = stripHtml(params.data?.body_html ?? "");
        return plain.length > 80 ? plain.slice(0, 80) + "…" : plain;
      },
      sortable: false,
      filter: false,
    },
    {
      headerName: "Date",
      field: "created_at",
      flex: 1,
      minWidth: 110,
      valueFormatter: (params) => params.value ? format(new Date(params.value), "MMM d, yyyy") : "—",
    },
  ], []);

  return (
    <div className="container-app py-8 sm:py-12 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Community Updates</h1>
          <p className="text-muted-foreground mt-1">Stay informed with the latest announcements.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center border rounded-md">
            <Button
              variant={viewMode === "card" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8 rounded-r-none"
              onClick={() => setViewMode("card")}
              aria-label="Card view"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "table" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8 rounded-l-none"
              onClick={() => setViewMode("table")}
              aria-label="Table view"
            >
              <LayoutList className="h-4 w-4" />
            </Button>
          </div>
          {isAdmin && (
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              New Announcement
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : announcements.length === 0 ? (
        <div className="text-center py-20">
          <Megaphone className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No announcements yet.</p>
        </div>
      ) : viewMode === "table" ? (
        <ThemedAgGrid<Announcement>
          gridId="updates"
          height="450px"
          rowData={announcements}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          onRowClicked={(params) => params.data && selectAndMarkRead(params.data)}
          rowStyle={{ cursor: "pointer" }}
          pagination
          paginationPageSize={20}
          showExportCsv={isAdmin}
          exportFileName="announcements"
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {announcements.map((a) => (
            <button
              key={a.id}
              onClick={() => selectAndMarkRead(a)}
              className="card-elevated p-5 text-left hover:border-primary/40 transition-all group border border-white/50"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-2">
                  <TranslatedContent entityTable="announcements" entityId={a.id} columnName="title" sourceText={a.title} />
                </h3>
                  {a.video_url && (
                    <Video className="h-4 w-4 text-primary shrink-0" aria-label="Has video" />
                  )}
                  {!a.video_url && a.audio_url && (
                    <Mic className="h-4 w-4 text-primary shrink-0" aria-label="Has audio" />
                  )}
                </div>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(a); }}
                    aria-label={`Delete ${a.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
                {stripHtml(a.body_html).slice(0, 150)}
              </p>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Badge variant="secondary" className="text-xs">
                  {format(new Date(a.created_at), "MMM d, yyyy")}
                </Badge>
                <AnnouncementViewStats announcementId={a.id} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Detail side panel */}
      <Sheet open={!!selectedAnnouncement} onOpenChange={(open) => !open && setSelectedAnnouncement(null)}>
        <SheetContent side="right" resizeKey="updates-detail" className="w-full sm:max-w-xl flex flex-col p-0 overflow-hidden">
          <SheetHeader className="px-6 pt-6 pb-4 border-b min-w-0">
            <SheetTitle className="text-xl pr-8 break-words whitespace-normal overflow-hidden overflow-wrap-anywhere" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
              {selectedAnnouncement && (
                <TranslatedContent entityTable="announcements" entityId={selectedAnnouncement.id} columnName="title" sourceText={selectedAnnouncement.title} />
              )}
            </SheetTitle>
            <SheetDescription>
              {selectedAnnouncement && format(new Date(selectedAnnouncement.created_at), "MMMM d, yyyy 'at' h:mm a")}
            </SheetDescription>
            {selectedAnnouncement && (
              <AnnouncementViewStats announcementId={selectedAnnouncement.id} size="md" className="mt-2" />
            )}
          </SheetHeader>
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-6 py-4 space-y-4">
              {selectedAnnouncement?.video_url && (
                <video
                  src={selectedAnnouncement.video_url}
                  controls
                  controlsList="nodownload"
                  playsInline
                  preload="metadata"
                  className="w-full rounded-lg aspect-video bg-black"
                  aria-label="Announcement video"
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              {!selectedAnnouncement?.video_url && selectedAnnouncement?.audio_url && (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
                  <Mic className="h-5 w-5 text-primary shrink-0" />
                  <audio
                    src={selectedAnnouncement.audio_url}
                    controls
                    controlsList="nodownload"
                    preload="metadata"
                    className="w-full h-10"
                    aria-label="Announcement audio"
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerUp={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              )}
              {selectedAnnouncement && (
                <TranslatedAnnouncementBody id={selectedAnnouncement.id} html={selectedAnnouncement.body_html} />
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>New Announcement</DialogTitle>
            <DialogDescription>
              Create an announcement that will be visible to all members. Opted-in members will receive an email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 flex-1 overflow-auto py-2">
            <div className="space-y-1.5">
              <Label htmlFor="announcement-title">Title <span className="text-destructive">*</span></Label>
              <Input
                id="announcement-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. New Training Cohort Starting March 25"
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Content <span className="text-destructive">*</span></Label>
              <RichTextEditor content={newBody} onChange={setNewBody} placeholder="Write your announcement here..." />
            </div>
            <Suspense fallback={<div className="h-20 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
              <MediaRecorder
                onMediaReady={(url, type) => {
                  if (type === "video") { setNewVideoUrl(url); setNewAudioUrl(null); }
                  else if (type === "audio") { setNewAudioUrl(url); setNewVideoUrl(null); }
                  else { setNewVideoUrl(null); setNewAudioUrl(null); }
                }}
                onBusyChange={setMediaBusy}
              />
            </Suspense>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending || mediaBusy}>
              {createMutation.isPending ? "Posting…" : mediaBusy ? "Uploading media…" : "Post Announcement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete announcement?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.title}" will be permanently removed. You can't undo this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete announcement"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
