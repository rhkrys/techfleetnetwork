// Pure domain policies — no I/O. 100% unit-testable.
import {
  type CircuitBreakerSnapshot, type Lane, type PolicyConfig, type ProviderOutcome,
  AUTH_TEMPLATES, BULK_TEMPLATES,
} from './types.ts';

/** Lane routing: derives the lane from the template name. */
export function routeLane(template: string): Lane {
  if (AUTH_TEMPLATES.has(template)) return 'auth';
  if (BULK_TEMPLATES.has(template)) return 'bulk';
  return 'transactional';
}

/** Backoff: pure function of (attempt, providerRetryAfter, workspaceQuota, config). */
export function nextBackoffSeconds(args: {
  attempt: number; providerRetryAfterSeconds?: number; workspaceQuota: boolean; cfg: PolicyConfig;
}): number {
  const { attempt, providerRetryAfterSeconds = 0, workspaceQuota, cfg } = args;
  const cap = workspaceQuota ? cfg.workspaceQuotaCapSeconds : cfg.maxBackoffSeconds;
  const base = workspaceQuota ? Math.min(30, cfg.baseBackoffSeconds) : cfg.baseBackoffSeconds;
  const exp = base * Math.pow(2, Math.min(Math.max(attempt - 1, 0), 8));
  return Math.min(Math.max(providerRetryAfterSeconds, exp), cap);
}

export type CircuitDecision =
  | { permit: true; newState: 'closed' | 'half_open' }
  | { permit: false; reason: 'open' | 'paused'; retryAt?: Date };

/** CircuitBreaker.permit — decides whether a lane may dispatch right now. */
export function permitLane(snap: CircuitBreakerSnapshot, now: Date): CircuitDecision {
  if (snap.pausedByAdmin) return { permit: false, reason: 'paused' };
  if (snap.state === 'closed') return { permit: true, newState: 'closed' };
  if (snap.state === 'half_open') {
    if (!snap.probeAt || snap.probeAt <= now) return { permit: true, newState: 'half_open' };
    return { permit: false, reason: 'open', retryAt: snap.probeAt };
  }
  // open
  if (snap.probeAt && snap.probeAt <= now) return { permit: true, newState: 'half_open' };
  return { permit: false, reason: 'open', retryAt: snap.probeAt };
}

/** Apply outcome to a breaker snapshot — pure state machine. */
export function applyOutcome(
  snap: CircuitBreakerSnapshot, outcome: ProviderOutcome, cfg: PolicyConfig, now: Date,
): CircuitBreakerSnapshot {
  if (outcome.kind === 'sent') {
    const succ = snap.consecutiveSuccess + 1;
    if (snap.state === 'half_open' && succ >= cfg.cbCloseSuccessThreshold) {
      return { ...snap, state: 'closed', openedAt: undefined, probeAt: undefined,
        consecutiveSuccess: succ, recent429Count: 0, recent429WindowStart: undefined };
    }
    return { ...snap, consecutiveSuccess: succ, recent429Count: 0, recent429WindowStart: undefined };
  }
  if (outcome.kind === 'rate_limited') {
    const winStart = snap.recent429WindowStart;
    const windowFresh = winStart && (now.getTime() - winStart.getTime()) < cfg.cbOpenWindowSeconds * 1000;
    const count = windowFresh ? snap.recent429Count + 1 : 1;
    const next: CircuitBreakerSnapshot = {
      ...snap, consecutiveSuccess: 0,
      recent429WindowStart: windowFresh ? winStart : now,
      recent429Count: count,
    };
    if (snap.state === 'closed' && count >= cfg.cbOpenThreshold429s) {
      return { ...next, state: 'open', openedAt: now,
        probeAt: new Date(now.getTime() + cfg.cbHalfOpenProbeSeconds * 1000) };
    }
    return next;
  }
  return { ...snap, consecutiveSuccess: 0 };
}

/** Fairness — prio order: auth → transactional → bulk. */
export const LANE_PRIORITY: Record<Lane, number> = { auth: 1, transactional: 2, bulk: 3 };
export function comparePriority(a: Lane, b: Lane): number { return LANE_PRIORITY[a] - LANE_PRIORITY[b]; }
