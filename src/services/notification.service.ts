import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";
import { handleServiceError } from "@/lib/service-result";
import { retryPostgrest } from "@/lib/data/transient-retry";

const log = createLogger("NotificationService");

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body_html: string;
  notification_type: string;
  link_url: string;
  read: boolean;
  created_at: string;
}

export const NotificationService = {
  /** Fetch the latest in-app notifications for the current user */
  async list(userId: string, limit = 50): Promise<AppNotification[]> {
    // retryPostgrest absorbs PGRST002 / 5xx blips so a single transient
    // hiccup doesn't surface as an empty notifications list.
    const { data, error } = await retryPostgrest(() =>
      supabase
        .from("notifications")
        .select("id, user_id, title, body_html, notification_type, link_url, read, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit),
    );

    if (handleServiceError(error as Parameters<typeof handleServiceError>[0], { logger: log, action: "list", message: `Failed to fetch notifications: ${(error as { message?: string })?.message ?? "Unknown error"}`, metadata: { userId }, level: "warn" })) return [];
    return (data as unknown as AppNotification[]) || [];
  },

  /** Count unread notifications */
  async unreadCount(userId: string): Promise<number> {
    const { count, error } = (await retryPostgrest(() =>
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("read", false) as unknown as PromiseLike<{ data: unknown; error: unknown; count?: number | null }>,
    )) as unknown as { count: number | null; error: { message?: string } | null };

    if (handleServiceError(error as Parameters<typeof handleServiceError>[0], { logger: log, action: "unreadCount", message: `Failed to count unread: ${error?.message ?? "Unknown error"}`, metadata: { userId }, level: "warn" })) return 0;
    return count ?? 0;
  },

  /** Mark a single notification as read */
  async markRead(notificationId: string): Promise<void> {
    const { error } = await supabase
      .from("notifications")
      .update({ read: true } as any)
      .eq("id", notificationId);

    handleServiceError(error, { logger: log, action: "markRead", message: `Failed to mark notification read: ${error?.message ?? "Unknown error"}`, metadata: { notificationId }, level: "warn" });
  },

  /** Mark all notifications as read for a user */
  async markAllRead(userId: string): Promise<void> {
    const { error } = await supabase
      .from("notifications")
      .update({ read: true } as any)
      .eq("user_id", userId)
      .eq("read", false);

    handleServiceError(error, { logger: log, action: "markAllRead", message: `Failed to mark all read: ${error?.message ?? "Unknown error"}`, metadata: { userId }, level: "warn" });
  },
};
