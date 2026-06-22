import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
  MutationCache,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClientConfig,
} from "@tanstack/react-query";
import { report } from "@/lib/observability/report";
import { isTransientError } from "@/lib/transient-error";

export {
  QueryCache,
  QueryClient,
  QueryClientProvider,
  MutationCache,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClientConfig,
};

export { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";

export const appQueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (isTransientError(error)) return;
      const key = Array.isArray(query.queryKey) ? query.queryKey.map(String).join(".") : "query";
      report(error, { source: `query.${key}`, severity: "error" });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (isTransientError(error)) return;
      const key = mutation.options.mutationKey?.map(String).join(".") ?? "anonymous";
      report(error, { source: `mutation.${key}`, severity: "error" });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: (failureCount, error) => {
        if (error instanceof Error) {
          const msg = error.message.toLowerCase();
          if (
            msg.includes("unauthorized") ||
            msg.includes("forbidden") ||
            msg.includes("not authenticated") ||
            msg.includes("permission denied") ||
            msg.includes("admin access required") ||
            msg.includes("row-level security") ||
            msg.includes("violates row-level") ||
            msg.includes("42501")
          ) {
            return false;
          }
        }
        return failureCount < 2;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 15_000),
      refetchOnWindowFocus: false,
      structuralSharing: true,
    },
    mutations: {
      retry: false,
    },
  },
});
