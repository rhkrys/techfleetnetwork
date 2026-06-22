/**
 * useMfaGate — identity-scoped React Query wrapper around
 * `MfaService.getMfaGateDecision()`.
 *
 * Per the 2026-06-22 audit, multiple components (MfaEnforcementGuard,
 * sign-in engine, header chip) were each calling `getMfaGateDecision`
 * directly during bootstrap. Each call hits GoTrue's Web Lock — which is
 * exactly the race that produced the `AbortError: Lock broken by another
 * request with the 'steal' option.` lines in the log.
 *
 * Wrapping the decision in a single identity-scoped React Query key gives
 * us in-flight deduplication: the first caller fires the request, every
 * later caller mounting in the same tick subscribes to the same promise.
 *
 * BDD: AUTH-LOCK-RETRY-003
 */
import { useQuery } from "@/lib/react-query";
import { MfaService } from "@/services/mfa.service";
import { useAuth } from "@/contexts/AuthContext";
import { queryKeys } from "@/lib/query-config";

export function useMfaGate(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.mfaGate(user?.id),
    queryFn: () => MfaService.getMfaGateDecision(),
    enabled: enabled && !!user,
    // Decision is sticky for the session — only refetch on identity change
    // or explicit invalidation after enroll/unenroll.
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });
}
