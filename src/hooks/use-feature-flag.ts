import { useQuery } from "@/lib/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchFeatureFlags, isEnabledIn } from "@/services/feature-flags.service";

/**
 * Returns whether a feature flag (ADR-0021) is on for the current user.
 * Safe default is OFF: until the flags load (or if the fetch fails), this is
 * `false`, so a flag can only ever turn new behavior *on*.
 */
export function useFeatureFlag(key: string): boolean {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ["feature-flags"],
    queryFn: fetchFeatureFlags,
    // Flags are admin-tuned and read widely; cache briefly so a ramp/kill
    // propagates within a minute without hammering the RPC on every render.
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  return isEnabledIn(data, key, user?.id);
}
