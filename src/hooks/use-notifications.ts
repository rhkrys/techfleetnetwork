/**
 * Notification hooks — optimized for 10,000+ concurrent users.
 *
 * Key enterprise optimizations:
 * - Single query for both list + unread count (eliminates redundant DB call)
 * - Adaptive polling (4× slower when tab hidden)
 * - Realtime subscription for instant delivery
 * - Optimistic updates on mark-read mutations
 * - Proper staleTime to prevent refetch storms
 */
import { useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@/lib/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { NotificationService, type AppNotification } from "@/services/notification.service";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAdaptiveInterval } from "@/hooks/use-adaptive-interval";

const NOTIFICATIONS_KEY = ["notifications"] as const;

/**
 * Primary hook: fetches the notification list. Unread count is derived
 * from the same data to avoid a second DB round-trip per poll cycle.
 */
export function useNotifications(limit = 50) {
  const { user } = useAuth();
  const interval = useAdaptiveInterval(60_000); // 60s base (was 30s), 240s hidden

  return useQuery({
    queryKey: [...NOTIFICATIONS_KEY, user?.id, limit],
    queryFn: () => NotificationService.list(user!.id, limit),
    enabled: !!user,
    refetchInterval: interval,
    staleTime: 45_000, // 45s — within a single poll cycle
  });
}

/**
 * Derived unread count — computed from the notification list query cache.
 * Eliminates the separate `unreadCount` DB query that was polling every 30s.
 */
export function useUnreadNotificationCount() {
  const { data: notifications } = useNotifications();

  return useMemo(() => {
    if (!notifications) return 0;
    return notifications.filter((n) => !n.read).length;
  }, [notifications]);
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: string) => NotificationService.markRead(notificationId),
    // Optimistic update — mark as read in cache immediately
    onMutate: async (notificationId) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      queryClient.setQueriesData<AppNotification[]>(
        { queryKey: NOTIFICATIONS_KEY },
        (old) => old?.map((n) => n.id === notificationId ? { ...n, read: true } : n),
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!user) throw new Error("Not authenticated");
      return NotificationService.markAllRead(user.id);
    },
    // Optimistic update — mark all as read in cache immediately
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      queryClient.setQueriesData<AppNotification[]>(
        { queryKey: NOTIFICATIONS_KEY },
        (old) => old?.map((n) => ({ ...n, read: true })),
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    },
  });
}

/**
 * Notifications realtime — subscribes to public.notifications scoped to the
 * current user. RLS restricts the table to `auth.uid() = user_id`, so the
 * channel only delivers the caller's own rows.
 *
 * On INSERT: invalidate the notifications cache so the bell/sheet updates
 * instantly. When the new notification represents an applicant_status change
 * (status_change or applicant_status_*), also invalidate the project-
 * applications caches as a belt-and-suspenders fallback in case the
 * dedicated project_applications channel dropped (mobile background, blip).
 */
export function useNotificationRealtime() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`notifications-self-${user.id}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload: { new?: { type?: string } }) => {
          queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
          const type = payload?.new?.type ?? "";
          if (type === "status_change" || type.startsWith("applicant_status_")) {
            queryClient.invalidateQueries({ queryKey: ["my-project-applications", user.id] });
            queryClient.invalidateQueries({ queryKey: ["my-project-apps-count", user.id] });
            queryClient.invalidateQueries({ queryKey: ["my-project-app-status"] });
            queryClient.invalidateQueries({ queryKey: ["dashboard-overview", user.id] });
            queryClient.invalidateQueries({ queryKey: ["quest-roadmap", user.id] });
            queryClient.invalidateQueries({ queryKey: ["my-active-projects", user.id] });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);
}

export type { AppNotification };
