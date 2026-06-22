import { useQuery } from "@/lib/react-query";
import { CohortService } from "@/services/cohort.service";
import { CACHE_USER_MUTABLE } from "@/lib/query-config";

export function useCohortsByClass(classId: string | undefined, opts: { publishedOnly?: boolean } = {}) {
  return useQuery({
    queryKey: ["cohorts", "class", classId ?? "none", opts.publishedOnly ? "published" : "all"] as const,
    queryFn: () => {
      if (!classId) return Promise.resolve([]);
      return opts.publishedOnly
        ? CohortService.listPublishedByClass(classId)
        : CohortService.listByClass(classId);
    },
    enabled: !!classId,
    ...CACHE_USER_MUTABLE,
  });
}

export function useCohortById(cohortId: string | undefined) {
  return useQuery({
    queryKey: ["cohorts", "byId", cohortId ?? "none"] as const,
    queryFn: () => (cohortId ? CohortService.getById(cohortId) : Promise.resolve(null)),
    enabled: !!cohortId,
    ...CACHE_USER_MUTABLE,
  });
}
