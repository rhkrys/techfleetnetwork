/**
 * use-course-catalog-prep
 *
 * Loads the active Core + Basic (onboarding) catalog entries used by the
 * Recruiting Center "Completed courses" panel. Shared between the roster grid
 * and the single-applicant review page so we only fetch the catalog once per
 * 5-minute window.
 */
import { useMemo } from "react";
import { useQuery } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PrepCourseTier = "core" | "onboarding";

export interface PrepCourseRow {
  course_key: string;
  display_label: string;
  display_order: number;
  tier: PrepCourseTier;
}

export interface PrepCatalog {
  core: PrepCourseRow[];
  onboarding: PrepCourseRow[];
  total: number;
  allKeys: Set<string>;
}

export function useCourseCatalogPrep(enabled: boolean) {
  const query = useQuery({
    queryKey: ["course-catalog-prep", "core+onboarding", "v1"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PrepCourseRow[]> => {
      const { data, error } = await supabase
        .from("course_catalog")
        .select("course_key, display_label, display_order, tier")
        .eq("active", true)
        .in("tier", ["core", "onboarding"])
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PrepCourseRow[];
    },
  });

  const catalog = useMemo<PrepCatalog>(() => {
    const rows = query.data ?? [];
    const core = rows.filter((r) => r.tier === "core");
    const onboarding = rows.filter((r) => r.tier === "onboarding");
    return {
      core,
      onboarding,
      total: rows.length,
      allKeys: new Set(rows.map((r) => r.course_key)),
    };
  }, [query.data]);

  return { catalog, isLoading: query.isLoading, isError: query.isError };
}
