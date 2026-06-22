/**
 * Announcement hooks — optimized for enterprise scale.
 *
 * Polling reduced from 30s → 60s base (240s when hidden).
 * staleTime raised to match poll cycle — saves ~50% of announcement DB calls.
 */
import { useQuery, useMutation, useQueryClient } from "@/lib/react-query";
import { AnnouncementService } from "@/services/announcement.service";
import { reportError } from "@/services/error-reporter.service";
import { useAuth } from "@/contexts/AuthContext";
import { useAdaptiveInterval } from "@/hooks/use-adaptive-interval";
import { queryKeys, CACHE_SEMI_STATIC } from "@/lib/query-config";
import { isTransientError } from "@/lib/transient-error";

const ANNOUNCEMENTS_KEY = ["announcements"] as const;
const READ_IDS_KEY = ["announcement-read-ids"] as const;
const ACTIONS_KEY = ["announcement-actions"] as const;

// Retry transient failures up to 2 extra times with backoff. Structural
// failures (RLS / schema) are surfaced immediately — no retry.
const transientRetry = (failureCount: number, error: unknown) =>
  failureCount < 2 && isTransientError(error);
const transientRetryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 8000);

export function useAnnouncements(limit = 50) {
  return useQuery({
    queryKey: queryKeys.announcements(limit),
    queryFn: () => AnnouncementService.list(limit),
    ...CACHE_SEMI_STATIC, // 15 min — announcements change very infrequently
    placeholderData: (prev) => prev,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

export function useLatestAnnouncements(limit = 5) {
  // 60s poll — the bell also revalidates on focus; 30s polling was overkill
  // and doubled the rate of transient failures hitting the triage queue.
  return useQuery({
    queryKey: queryKeys.announcementsLatest(limit),
    queryFn: () => AnnouncementService.latest(limit),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 45_000,
    placeholderData: (prev) => prev,
    meta: { persist: true },
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

export function useAnnouncementReadIds() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...READ_IDS_KEY, user?.id],
    queryFn: () => AnnouncementService.getReadIds(user!.id),
    enabled: !!user,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    staleTime: 45_000,
    placeholderData: (prev) => prev,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

export function useMarkAnnouncementRead() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (announcementId: string) => {
      if (!user) throw new Error("Not authenticated");
      return AnnouncementService.markRead(user.id, announcementId);
    },
    onMutate: async (announcementId) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: READ_IDS_KEY });
      queryClient.setQueryData<Set<string>>(
        [...READ_IDS_KEY, user?.id],
        (old) => new Set([...(old ?? []), announcementId])
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: READ_IDS_KEY });
    },
  });
}

export function useCreateAnnouncement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ title, bodyHtml, userId, videoUrl, audioUrl }: { title: string; bodyHtml: string; userId: string; videoUrl?: string | null; audioUrl?: string | null }) => {
      const announcement = await AnnouncementService.create(title, bodyHtml, userId, videoUrl, audioUrl);
      // Fire-and-forget email notifications
      AnnouncementService.sendNotifications(announcement.id).catch((e) => reportError(e, "useCreateAnnouncement.sendNotifications", { severity: "warn" }));
      return announcement;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ANNOUNCEMENTS_KEY });
    },
  });
}

export function useAnnouncementViewCounts() {
  // RPC requires authenticated role; skip cleanly for anon viewers (e.g. when
  // an announcement banner renders before sign-in completes) to avoid 42501.
  const { user } = useAuth();
  return useQuery({
    queryKey: ["announcement-view-counts"],
    queryFn: () => AnnouncementService.getViewCounts(),
    enabled: !!user,
    staleTime: 30_000,
  });
}

export function useRecordAnnouncementView() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (announcementId: string) => {
      if (!user) throw new Error("Not authenticated");
      return AnnouncementService.recordView(user.id, announcementId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["announcement-view-counts"] });
    },
  });
}

export function useDeleteAnnouncement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => AnnouncementService.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ANNOUNCEMENTS_KEY });
    },
  });
}

/**
 * Tri-state announcement status (Part 2 §C1): unread → read → acted.
 * "Acted" = the member clicked the CTA, dismissed, or archived the card.
 */
export function useAnnouncementActions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...ACTIONS_KEY, user?.id],
    queryFn: () => AnnouncementService.getActionMap(user!.id),
    enabled: !!user,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    staleTime: 45_000,
    placeholderData: (prev) => prev,
    retry: transientRetry,
    retryDelay: transientRetryDelay,
  });
}

export function useRecordAnnouncementAction() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      announcementId,
      action,
    }: { announcementId: string; action: "clicked_cta" | "dismissed" | "archived" }) => {
      if (!user) throw new Error("Not authenticated");
      return AnnouncementService.recordAction(user.id, announcementId, action);
    },
    onMutate: async ({ announcementId, action }) => {
      await queryClient.cancelQueries({ queryKey: ACTIONS_KEY });
      queryClient.setQueryData<Map<string, Set<string>>>(
        [...ACTIONS_KEY, user?.id],
        (old) => {
          const next = new Map(old ?? new Map());
          const existing = new Set(next.get(announcementId) ?? []);
          existing.add(action);
          next.set(announcementId, existing);
          return next;
        },
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ACTIONS_KEY });
    },
  });
}
