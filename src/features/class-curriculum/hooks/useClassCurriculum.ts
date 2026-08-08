import { useQuery, useQueryClient } from "@/lib/react-query";
import { ClassCurriculumService } from "../services/classCurriculum.service";

export const classCurriculumKey = (classId: string) => ["class-curriculum", classId] as const;
export const classProgressKey = (classId: string, userId: string | null | undefined) =>
  ["class-curriculum-progress", classId, userId ?? "anon"] as const;

export function useClassCurriculum(classId: string | undefined) {
  return useQuery({
    queryKey: classId ? classCurriculumKey(classId) : ["class-curriculum", "none"],
    queryFn: () => ClassCurriculumService.fetchBundle(classId as string),
    enabled: !!classId,
    staleTime: 30_000,
  });
}

export function useClassCurriculumProgress(
  classId: string | undefined,
  userId: string | null | undefined
) {
  return useQuery({
    queryKey: classProgressKey(classId ?? "none", userId),
    queryFn: () => ClassCurriculumService.fetchProgress(classId as string),
    enabled: !!classId && !!userId,
    staleTime: 15_000,
  });
}

export const learnerCurriculumKey = (classId: string, userId: string | null | undefined) =>
  ["class-curriculum-learner", classId, userId ?? "anon"] as const;

/**
 * Learner-facing curriculum via the release-resolving RPC (F1). Keyed by user
 * because release ('after previous completion', cohort-relative) is per-learner.
 */
export function useLearnerCurriculum(
  classId: string | undefined,
  userId: string | null | undefined
) {
  return useQuery({
    queryKey: learnerCurriculumKey(classId ?? "none", userId),
    queryFn: () => ClassCurriculumService.fetchLearnerCurriculum(classId as string),
    enabled: !!classId && !!userId,
    staleTime: 15_000,
  });
}

export function useInvalidateClassCurriculum() {
  const qc = useQueryClient();
  return (classId: string) => {
    qc.invalidateQueries({ queryKey: classCurriculumKey(classId) });
    qc.invalidateQueries({ queryKey: ["class-curriculum-progress", classId] });
    qc.invalidateQueries({ queryKey: ["class-curriculum-learner", classId] });
  };
}
