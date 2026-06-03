/**
 * Part 1 §1.2 — Client-side idempotency hook.
 *
 * Wraps any async mutation with:
 *   1. A stable `X-Request-Id` header generated per logical request.
 *   2. 250ms leading debounce so rapid double-clicks collapse into one call.
 *   3. A single in-flight promise per key — concurrent callers share the result.
 *
 * The hook does NOT call the DB `claim_idempotency_key` RPC itself — that's
 * the server's job (edge functions wrap calls in `withIdempotency` from
 * `_shared/idempotency.ts`). On the client we only guarantee the same
 * request id is sent and that we never fire the same mutation twice.
 *
 * Usage:
 *   const submit = useIdempotentMutation(
 *     ({ requestId }) => api.submitApplication(payload, { requestId }),
 *     { key: `submit:${userId}:${applicationId}` }
 *   );
 *   <Button onClick={submit}>Submit</Button>
 */
import { useCallback, useEffect, useRef } from 'react';

type InFlight<T> = { promise: Promise<T>; requestId: string };

const REGISTRY: Map<string, InFlight<unknown>> = (() => {
  const g = globalThis as unknown as {
    __tfIdempotencyRegistry?: Map<string, InFlight<unknown>>;
  };
  if (!g.__tfIdempotencyRegistry) g.__tfIdempotencyRegistry = new Map();
  return g.__tfIdempotencyRegistry;
})();

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface IdempotentMutationContext {
  requestId: string;
  signal?: AbortSignal;
}

export interface UseIdempotentMutationOptions {
  /**
   * A stable key identifying this logical mutation. Same key = same
   * deduplicated in-flight promise. Include user id + entity id, not values
   * that change per render.
   */
  key: string;
  /** Leading-edge debounce window, ms. Default 250. */
  debounceMs?: number;
  /** TTL for the in-flight entry after settlement, ms. Default 0 (clear on settle). */
  resultTtlMs?: number;
}

export function useIdempotentMutation<TArgs extends unknown[], TResult>(
  fn: (ctx: IdempotentMutationContext, ...args: TArgs) => Promise<TResult>,
  options: UseIdempotentMutationOptions,
): (...args: TArgs) => Promise<TResult> {
  const { key, debounceMs = 250, resultTtlMs = 0 } = options;
  const lastFiredAtRef = useRef<number>(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  // Clean up our own key on unmount so a remount can fire again.
  useEffect(() => {
    return () => {
      const entry = REGISTRY.get(key) as InFlight<TResult> | undefined;
      if (entry) {
        // Only clear if no consumer is awaiting it.
        entry.promise.finally(() => {
          if (REGISTRY.get(key) === entry) REGISTRY.delete(key);
        });
      }
    };
  }, [key]);

  return useCallback(
    (...args: TArgs): Promise<TResult> => {
      const existing = REGISTRY.get(key) as InFlight<TResult> | undefined;
      if (existing) return existing.promise;

      const now = Date.now();
      if (now - lastFiredAtRef.current < debounceMs) {
        // Within debounce window: ignore but return a resolved noop so
        // callers don't crash. They should re-render and try later.
        return Promise.reject(
          Object.assign(new Error('idempotent_mutation_debounced'), {
            code: 'DEBOUNCED',
            retryAfterMs: debounceMs - (now - lastFiredAtRef.current),
          }),
        );
      }
      lastFiredAtRef.current = now;

      const requestId = newRequestId();
      const promise = (async () => {
        try {
          return await fnRef.current({ requestId }, ...args);
        } finally {
          if (resultTtlMs > 0) {
            setTimeout(() => {
              const cur = REGISTRY.get(key);
              if (cur && cur.requestId === requestId) REGISTRY.delete(key);
            }, resultTtlMs);
          } else {
            REGISTRY.delete(key);
          }
        }
      })();

      REGISTRY.set(key, { promise, requestId } as InFlight<unknown>);
      return promise;
    },
    [key, debounceMs, resultTtlMs],
  );
}

/** Test helper — clears all in-flight entries. */
export function __clearIdempotencyRegistry(): void {
  REGISTRY.clear();
}
