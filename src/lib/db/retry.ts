import { isTransientError } from "@/lib/errors/extract";

/**
 * Retry a Supabase mutation on transient upstream failures only.
 *
 * Used by every mutation that talks to PostgREST so a single
 * "upstream request timeout" / 502 / 503 / PGRST002 hiccup doesn't surface
 * as an opaque toast to the user. Never retries RLS denials (42501),
 * validation errors, or anything `isTransientError` doesn't classify
 * as transient.
 *
 * Exponential backoff with jitter: 250ms, 500ms, 1000ms (defaults).
 */
export async function retryTransientWrite<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 250;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err) || i === attempts - 1) throw err;
      const delay = baseMs * Math.pow(2, i) + Math.floor(Math.random() * baseMs);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
