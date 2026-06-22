/**
 * Universal transient-retry wrapper for outbound data calls.
 *
 * Wraps any async fn (PostgREST query, RPC, edge invoke, MFA call) and
 * transparently retries on transient infra failures:
 *
 *  - PostgREST `PGRST002` (schema cache reload, ~90s windows)
 *  - HTTP 502 / 503 / 504 (`status` on PostgrestError / FunctionsHttpError)
 *  - Network `TypeError: Failed to fetch` / `NetworkError`
 *  - `AbortError` from Web Locks contention
 *
 * NEVER retries 4xx (other than 408/429), RLS denials, schema errors, or
 * validation errors — those are surfaced immediately so the caller can map
 * them to actionable copy.
 *
 * Default backoff: 150 / 400 / 900 ms (capped 1.2s) — short enough to be
 * invisible during a single PostgREST schema reload, long enough not to
 * cascade-DDoS the API when it's actually overloaded.
 *
 * BDD: INFRA-PGRST002-RETRY-001/002, AUTH-LOCK-RETRY-001/002
 */
import { isTransientError } from "@/lib/transient-error";

export interface TransientRetryOptions {
  /** Total attempts including the first call. Default 4 (1 + 3 retries). */
  retries?: number;
  /** Base backoff in ms; doubles each retry, jittered ±25%. Default 150. */
  baseDelayMs?: number;
  /** Hard ceiling on a single backoff sleep. Default 1200ms. */
  maxDelayMs?: number;
  /** Override the classifier (e.g. MFA — never retry 422 invalid code). */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Hook for telemetry. */
  onRetry?: (err: unknown, attempt: number) => void;
}

const DEFAULTS = {
  retries: 3,
  baseDelayMs: 150,
  maxDelayMs: 1200,
} as const;

export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  opts: TransientRetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? DEFAULTS.retries;
  const base = opts.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const cap = opts.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const classifier = opts.shouldRetry ?? defaultShouldRetry;

  let attempt = 0;
  let lastErr: unknown;
  // 1 initial + N retries
  for (attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !classifier(err, attempt)) {
        throw err;
      }
      opts.onRetry?.(err, attempt);
      const delay = Math.min(cap, base * Math.pow(2, attempt));
      const jitter = delay * (0.75 + Math.random() * 0.5);
      await sleep(jitter);
    }
  }
  throw lastErr;
}

/**
 * Specialized wrapper for PostgREST `{ data, error }` tuples. Retries on
 * transient `error`, then returns the final tuple to the caller so existing
 * error-handling code paths are unchanged.
 */
export async function retryPostgrest<T, E = unknown>(
  fn: () => PromiseLike<{ data: T; error: E | null }>,
  opts: TransientRetryOptions = {},
): Promise<{ data: T; error: E | null }> {
  try {
    return await withTransientRetry(async () => {
      const out = await Promise.resolve(fn());
      if (out.error && isTransientError(out.error)) throw out.error;
      return out;
    }, opts);
  } catch (err) {
    return { data: null as unknown as T, error: err as E };
  }
}

function defaultShouldRetry(err: unknown): boolean {
  return isTransientError(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
