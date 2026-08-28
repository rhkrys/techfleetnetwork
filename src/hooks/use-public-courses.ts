import { useQuery } from "@/lib/react-query";
import { fetchPublicCourses, fetchPublicCourseBySlug } from "@/services/public-courses.service";

/**
 * Course catalog data for anonymous visitors.
 * No `useAuth()` here on purpose — see the note in the service. Anything that
 * touches the auth context would make the public catalog depend on a session.
 */
export function usePublicCourses(track?: string) {
  return useQuery({
    queryKey: ["public-courses", track ?? "all"],
    queryFn: () => fetchPublicCourses(track),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function usePublicCourse(slug: string | undefined) {
  return useQuery({
    queryKey: ["public-course", slug],
    queryFn: () => fetchPublicCourseBySlug(slug!),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      // Don't retry a genuine 404 — the class is unpublished or gone.
      if ((error as { status?: number })?.status === 404) return false;
      return failureCount < 2;
    },
  });
}
