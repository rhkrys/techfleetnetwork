import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PolicyRow {
  id: string;
  policy_key: string;
  version: string;
  language: string;
  title: string;
  summary: string | null;
  body_md: string;
  body_html: string | null;
  effective_at: string;
  checksum: string;
}

/**
 * Fetches the current published version of a legal policy from the database.
 * Backed by the `get_current_policy` SECURITY DEFINER RPC. Cached aggressively
 * (24h staleTime) because policies are versioned — when a new version is
 * published, callers re-fetch by bumping the queryKey via a manual invalidate.
 */
export function usePolicy(policyKey: string, language = "en") {
  return useQuery<PolicyRow | null>({
    queryKey: ["policy", policyKey, language],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_current_policy", {
        p_key: policyKey,
        p_language: language,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as PolicyRow | undefined) ?? null;
    },
    staleTime: 24 * 60 * 60 * 1000, // 24h — policies are versioned, not live
    gcTime: 7 * 24 * 60 * 60 * 1000,
    retry: 1,
  });
}
