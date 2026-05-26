import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Video, Mic, Rocket, CheckCheck, Megaphone } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import {
  useLatestAnnouncements,
  useAnnouncementReadIds,
  useMarkAnnouncementRead,
  useRecordAnnouncementView,
} from "@/hooks/use-announcements";
import {
  useNotifications,
  useUnreadNotificationCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  type AppNotification,
} from "@/hooks/use-notifications";
import { stripHtml, normalizeRichTextHtml } from "@/lib/html";
import { sanitizeHtml } from "@/lib/security";
import { linkifyHtml } from "@/lib/linkify";
import type { Announcement } from "@/services/announcement.service";
import { AnnouncementViewStats } from "@/components/AnnouncementViewStats";

/** Unified notification item used for the merged list */
interface UnifiedItem {
  id: string;
  kind: "alert" | "announcement";
  title: string;
  bodyHtml: string;
  date: Date;
  read: boolean;
  linkUrl?: string;
  notificationType?: string;
  videoUrl?: string | null;
  audioUrl?: string | null;
  raw: AppNotification | Announcement;
}

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [selectedNotification, setSelectedNotification] = useState<AppNotification | null>(null);

  const openDetailAfterPopoverCloses = (cb: () => void) => {
    setOpen(false);
    window.setTimeout(cb, 0);
  };

  // Announcements
  const { data: announcements = [] } = useLatestAnnouncements(20);
  const { data: readIds = new Set<string>() } = useAnnouncementReadIds();
  const markAnnouncementRead = useMarkAnnouncementRead();
  const recordView = useRecordAnnouncementView();

  // In-app notifications
  const { data: notifications = [] } = useNotifications(20);
  const unreadNotifCount = useUnreadNotificationCount();
  const markNotifRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  // Build unified list sorted by date descending
  const unreadAnnouncements = announcements.filter((a) => !readIds.has(a.id));
  const totalUnread = unreadAnnouncements.length + unreadNotifCount;

  const unified: UnifiedItem[] = useMemo(() => [
    ...notifications.map((n): UnifiedItem => ({
      id: n.id,
      kind: "alert",
      title: n.title,
      bodyHtml: n.body_html,
      date: new Date(n.created_at),
      read: n.read,
      linkUrl: n.link_url,
      notificationType: n.notification_type,
      raw: n,
    })),
    ...unreadAnnouncements.map((a): UnifiedItem => ({
      id: a.id,
      kind: "announcement",
      title: a.title,
      bodyHtml: a.body_html,
      date: new Date(a.created_at),
      read: false,
      videoUrl: a.video_url,
      audioUrl: a.audio_url,
      raw: a,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime()), [notifications, unreadAnnouncements]);

  const handleItemClick = (item: UnifiedItem) => {
    if (item.kind === "announcement") {
      markAnnouncementRead.mutate(item.id);
      recordView.mutate(item.id);
      openDetailAfterPopoverCloses(() => {
        setSelectedNotification(null);
        setSelectedAnnouncement(item.raw as Announcement);
      });
    } else {
      const notif = item.raw as AppNotification;
      if (!notif.read) markNotifRead.mutate(notif.id);
      openDetailAfterPopoverCloses(() => {
        setSelectedAnnouncement(null);
        setSelectedNotification(notif);
      });
    }
  };

  const handleMarkAllRead = () => {
    markAllRead.mutate();
    // Also mark all visible announcements as read
    unreadAnnouncements.forEach((a) => markAnnouncementRead.mutate(a.id));
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={`Notifications${totalUnread > 0 ? `, ${totalUnread} unread` : ""}`}
          >
            <Bell className="h-5 w-5" />
            {totalUnread > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground"
                aria-hidden="true"
              >
                {totalUnread > 99 ? "99+" : totalUnread}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-[min(30rem,calc(100vw-1.5rem))] p-0"
          sideOffset={8}
        >
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <h3 className="font-semibold text-sm">Notifications</h3>
            {totalUnread > 0 && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {totalUnread} unread
              </span>
            )}
          </div>

          <ScrollArea className="max-h-80">
            {unified.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                All caught up! 🎉
              </div>
            ) : (
              <div className="divide-y">
                {unified.slice(0, 30).map((item) => (
                  <button
                    key={`${item.kind}-${item.id}`}
                    onClick={() => handleItemClick(item)}
                    className="w-full min-w-0 text-left px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {item.kind === "alert" && item.notificationType === "project_opening" && (
                          <Rocket className="h-3.5 w-3.5 text-primary shrink-0" aria-label="Project opening" />
                        )}
                        {item.kind === "announcement" && item.videoUrl && (
                          <Video className="h-3.5 w-3.5 text-primary shrink-0" aria-label="Video" />
                        )}
                        {item.kind === "announcement" && !item.videoUrl && item.audioUrl && (
                          <Mic className="h-3.5 w-3.5 text-primary shrink-0" aria-label="Audio" />
                        )}
                        {item.kind === "announcement" && !item.videoUrl && !item.audioUrl && (
                          <Megaphone className="h-3.5 w-3.5 text-primary shrink-0" aria-label="Announcement" />
                        )}
                        <h4 className={`min-w-0 text-sm font-medium line-clamp-1 ${item.read ? "text-muted-foreground" : "text-foreground"}`}>
                          {item.title}
                        </h4>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {!item.read && (
                          <span className="h-2 w-2 rounded-full bg-primary shrink-0" aria-label="Unread" />
                        )}
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {format(item.date, "MMM d")}
                        </span>
                      </div>
                    </div>
                    <p className="mt-0.5 pr-1 text-xs text-muted-foreground line-clamp-2 break-words">
                      {stripHtml(item.bodyHtml).slice(0, 120)}
                    </p>
                    {item.kind === "alert" && item.linkUrl && (
                      <span className="text-xs text-primary font-medium mt-1 inline-block">
                        View Project →
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>

          <div className="flex items-center gap-2 border-t px-4 py-2 max-[420px]:flex-col">
            {totalUnread > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 text-xs gap-1.5 max-[420px]:w-full"
                onClick={handleMarkAllRead}
                disabled={markAllRead.isPending}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all as read
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
                className="flex-1 text-xs max-[420px]:w-full"
              onClick={() => {
                setOpen(false);
                navigate("/profile/notifications");
              }}
            >
              View all notifications
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Announcement detail panel */}
      <Sheet open={!!selectedAnnouncement} onOpenChange={(o) => !o && setSelectedAnnouncement(null)}>
        <SheetContent
          side="right"
          resizeKey="notification-announcement"
          minSize={360}
          className="flex flex-col p-0 overflow-hidden w-[min(36rem,95vw)] sm:!max-w-none"
        >
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <SheetTitle className="text-xl pr-8">{selectedAnnouncement?.title}</SheetTitle>
            <SheetDescription>
              {selectedAnnouncement && format(new Date(selectedAnnouncement.created_at), "MMMM d, yyyy 'at' h:mm a")}
            </SheetDescription>
            {selectedAnnouncement && (
              <AnnouncementViewStats announcementId={selectedAnnouncement.id} className="mt-2" />
            )}
          </SheetHeader>
          <ScrollArea className="flex-1">
            <div className="px-6 py-4 space-y-4 min-w-0">
              {selectedAnnouncement?.video_url && (
                <video
                  src={selectedAnnouncement.video_url}
                  controls
                  controlsList="nodownload"
                  playsInline
                  preload="metadata"
                  className="block w-full max-w-full rounded-lg aspect-video bg-black mb-4"
                  aria-label="Announcement video"
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              {!selectedAnnouncement?.video_url && selectedAnnouncement?.audio_url && (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4 mb-4">
                  <Mic className="h-5 w-5 text-primary shrink-0" />
                  <audio
                    src={selectedAnnouncement.audio_url}
                    controls
                    controlsList="nodownload"
                    preload="metadata"
                    className="w-full h-10 min-w-0"
                    aria-label="Announcement audio"
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerUp={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              )}
              {selectedAnnouncement && (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none break-words"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(linkifyHtml(normalizeRichTextHtml(selectedAnnouncement.body_html))) }}
                />
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Notification detail panel (for notifications without a link) */}
      <Sheet open={!!selectedNotification} onOpenChange={(o) => !o && setSelectedNotification(null)}>
        <SheetContent side="right" resizeKey="notification-detail" className="w-full sm:max-w-xl flex flex-col p-0 overflow-hidden">
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <SheetTitle className="text-xl pr-8">{selectedNotification?.title}</SheetTitle>
            <SheetDescription>
              {selectedNotification && format(new Date(selectedNotification.created_at), "MMMM d, yyyy 'at' h:mm a")}
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="flex-1 px-6 py-4">
            {selectedNotification && (
              <div
                className="prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(linkifyHtml(normalizeRichTextHtml(selectedNotification.body_html))) }}
              />
            )}
            {selectedNotification?.link_url && (
              <Button
                className="mt-4"
                onClick={() => {
                  setSelectedNotification(null);
                  navigate(selectedNotification.link_url);
                }}
              >
                View Project Opening
              </Button>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
