import { useMemo } from "react";

interface PathLike {
  id: string;
  slug: string;
}

/**
 * Build O(1) id / slug lookup maps from a quest-paths array.
 * Replaces O(n*m) `paths.find(...)` loops inside quest components.
 */
export function useQuestPathMaps<T extends PathLike>(paths: T[] | undefined | null) {
  return useMemo(() => {
    const byId = new Map<string, T>();
    const bySlug = new Map<string, T>();
    if (paths) {
      for (const p of paths) {
        byId.set(p.id, p);
        bySlug.set(p.slug, p);
      }
    }
    return { byId, bySlug };
  }, [paths]);
}
