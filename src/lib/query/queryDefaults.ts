/**
 * Global React Query defaults — the data-layer rule that removes the need
 * for ad-hoc onError → reportError boilerplate in every service hook.
 *
 * Contract:
 *   - Queries retry up to 3 times with exponential backoff (1s, 2s, 4s; max 8s).
 *   - `networkMode: 'online'` pauses fetches while offline; resuming the tab
 *     while online auto-retries without any error UI.
 *   - Errors are NOT auto-thrown into components (`throwOnError: false`);
 *     callers branch on `query.error`.
 *   - Mutations retry once for transient network failures only.
 *
 * Global QueryCache.onError forwards to `report()` ONLY when:
 *   - `query.state.fetchFailureCount >= 3` (i.e. the retry budget is exhausted),
 *   - AND `classify(err).report === true` (structural classifier passed).
 *
 * This removes the per-call `reportClientError` floods observed in
 * `agent_fix_queue` (announcements, notifications, banners, role checks).
 */
import { QueryCache, QueryClient, MutationCache } from "@tanstack/react-query";
import { classify } from "@/lib/observability/classify";
import { report } from "@/lib/observability/report";

function isRetriable(err: unknown): boolean {
  const c = classify(err);
  if (!c.report && c.reason === "aborted") return false;
  return c.retriable;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => failureCount < 3 && isRetriable(error),
        retryDelay: (i) => Math.min(1000 * 2 ** i, 8000),
        networkMode: "online",
        throwOnError: false,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: {
        networkMode: "online",
        retry: (failureCount, error) => failureCount < 1 && isRetriable(error),
        retryDelay: 500,
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        const failureCount = query.state.fetchFailureCount;
        if (failureCount < 3) return;
        if (!classify(error).report) return;
        report(error, {
          source: `query.${String(query.queryKey[0] ?? "unknown")}`,
          eventType: "query_failed",
          severity: "warn",
        });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (!classify(error).report) return;
        const key = mutation.options.mutationKey?.[0];
        report(error, {
          source: `mutation.${String(key ?? "unknown")}`,
          eventType: "mutation_failed",
          severity: "warn",
        });
      },
    }),
  });
}
