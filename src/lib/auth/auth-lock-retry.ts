/**
 * Web Locks contention retry — GoTrue's `goTrueWebLock` occasionally throws
 *
 *   AbortError: Lock broken by another request with the 'steal' option.
 *
 * when two service-layer calls (e.g. `ProfileService.fetch` and
 * `MfaService.getMfaGateDecision`) race for the auth lock during identity
 * bootstrap. The "winner" succeeds, the "losers" see an AbortError that has
 * nothing to do with the underlying request and is safe to retry once after
 * a tiny settle.
 *
 * Use as a thin wrapper around any block that touches `supabase.auth.*`.
 *
 * BDD: AUTH-LOCK-RETRY-001/002
 */

const LOCK_BROKEN_PATTERN = /Lock broken by another request|lock 'lock:sb-/i;

export async function withAuthLockRetry<T>(
  fn: () => Promise<T>,
  opts: { settleMs?: number } = {},
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isLockBroken(err)) throw err;
    await sleep(opts.settleMs ?? 50);
    return await fn();
  }
}

export function isLockBroken(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  if (e.name === "AbortError" && typeof e.message === "string" && LOCK_BROKEN_PATTERN.test(e.message)) {
    return true;
  }
  if (typeof e.message === "string" && LOCK_BROKEN_PATTERN.test(e.message)) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
