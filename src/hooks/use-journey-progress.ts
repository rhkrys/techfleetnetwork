import { useQuery } from "@/lib/react-query";
import { JourneyService } from "@/services/journey.service";
import type { Database } from "@/integrations/supabase/types";
import { queryKeys, CACHE_USER_MUTABLE } from "@/lib/query-config";

type JourneyPhase = Database["public"]["Enums"]["journey_phase"];

/**
 * Completed-count hook with 60s staleTime (was 0).
 *
 * Course completion pages call `queryClient.invalidateQueries` after upsert,
 * so the user still sees instant feedback. The 60s staleTime prevents
 * redundant DB calls when navigating between pages that both render progress
 * bars — saving ~5 queries/page-view at scale.
 */
export function useCompletedCount(
  userId: string | undefined,
  phase: JourneyPhase,
  validTaskIds?: readonly string[]
) {
  const taskKey = validTaskIds ? [...validTaskIds].sort().join(",") : "__all__";
  return useQuery({
    queryKey: queryKeys.journeyCompleted(userId!, phase, taskKey),
    queryFn: () => JourneyService.getCompletedCount(userId!, phase, validTaskIds),
    enabled: !!userId,
    // Keep the previous count visible during refetch / transient blip so a
    // backend hiccup never flashes "0/N" in the dashboard (TRIAGE-NOISE-015).
    placeholderData: (prev) => prev,
    ...CACHE_USER_MUTABLE, // 60s stale — invalidated on task upsert
  });
}

export function useJourneyProgress(userId: string | undefined, phase: JourneyPhase) {
  return useQuery({
    queryKey: queryKeys.journeyProgress(userId!, phase),
    queryFn: () => JourneyService.getProgress(userId!, phase),
    enabled: !!userId,
    placeholderData: (prev) => prev,
    ...CACHE_USER_MUTABLE, // 60s stale — invalidated on task upsert
  });
}
