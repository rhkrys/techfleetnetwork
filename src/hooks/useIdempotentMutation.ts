// Client-side companion to supabase/functions/_shared/idempotency.ts
// Wave 1 of the comprehensive refactor — see plan §1.2.
//
// - Generates a stable X-Request-Id per logical user action.
// - Debounces rapid re-clicks (default 250ms).
// - Guarantees a single in-flight request per key (later clicks return the
//   in-flight promise instead of firing a duplicate network call).
//
// Drop-in for React Query's useMutation: pass the same options plus
// `idempotencyKey` (string | () => string). The key is sent as X-Request-Id
// so the server's `withIdempotency` helper can dedupe.

import { useCallback, useRef } from "react";
import { useMutation, type UseMutationOptions, type UseMutationResult } from "@tanstack/react-query";

export interface IdempotentMutationOptions<TData, TError, TVariables, TContext>
  extends UseMutationOptions<TData, TError, TVariables, TContext> {
  /** Stable key per logical action. Function form lets you key on variables. */
  idempotencyKey: string | ((variables: TVariables) => string);
  /** Debounce window for repeat clicks. Default 250ms. */
  debounceMs?: number;
}

function genRequestId(seed: string): string {
  // 16 random hex chars + short seed hash for traceability.
  const rand = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(rand).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${seed.slice(0, 32)}-${hex}`;
}

export function useIdempotentMutation<TData = unknown, TError = unknown, TVariables = void, TContext = unknown>(
  options: IdempotentMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext> & { getRequestId: () => string | null } {
  const { idempotencyKey, debounceMs = 250, mutationFn, ...rest } = options;

  const inFlight = useRef<Map<string, Promise<TData>>>(new Map());
  const lastFired = useRef<Map<string, number>>(new Map());
  const lastRequestId = useRef<string | null>(null);

  const wrappedFn = useCallback(
    async (variables: TVariables): Promise<TData> => {
      if (!mutationFn) throw new Error("useIdempotentMutation: mutationFn required");
      const seed = typeof idempotencyKey === "function" ? idempotencyKey(variables) : idempotencyKey;

      // Debounce window
      const now = Date.now();
      const last = lastFired.current.get(seed) ?? 0;
      if (now - last < debounceMs && inFlight.current.has(seed)) {
        return inFlight.current.get(seed)!;
      }

      // Single in-flight per key
      const existing = inFlight.current.get(seed);
      if (existing) return existing;

      const requestId = genRequestId(seed);
      lastRequestId.current = requestId;
      lastFired.current.set(seed, now);

      // Attach the request id to any fetch the caller makes inside mutationFn
      // by exposing it on a thread-local-ish ref. Consumers that need to send
      // it (e.g. via supabase.functions.invoke headers) read getRequestId().
      const p = (async () => {
        try {
          return await mutationFn(variables);
        } finally {
          // Hold the in-flight slot briefly so trailing clicks coalesce.
          setTimeout(() => inFlight.current.delete(seed), debounceMs);
        }
      })();
      inFlight.current.set(seed, p);
      return p;
    },
    [mutationFn, idempotencyKey, debounceMs],
  );

  const m = useMutation<TData, TError, TVariables, TContext>({ ...rest, mutationFn: wrappedFn });
  return Object.assign(m, { getRequestId: () => lastRequestId.current });
}

/**
 * Convenience: build the headers object to pass to supabase.functions.invoke.
 * Usage:
 *   const m = useIdempotentMutation({ idempotencyKey: 'profile-save', mutationFn: async (v) => {
 *     const requestId = m.getRequestId();
 *     await supabase.functions.invoke('save-profile', {
 *       body: v,
 *       headers: idempotencyHeaders(requestId),
 *     });
 *   }});
 */
export function idempotencyHeaders(requestId: string | null | undefined): Record<string, string> {
  return requestId ? { "X-Request-Id": requestId } : {};
}
