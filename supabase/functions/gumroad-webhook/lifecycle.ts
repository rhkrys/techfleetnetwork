// Gumroad lifecycle classification + the audit-H10 0-row decision, extracted so
// the billing-critical rules are unit-testable without starting Deno.serve.

/** Gumroad encodes booleans inconsistently across event types. */
export function truthy(v: string | undefined | null): boolean {
  return v === "true" || v === "1" || v === "yes";
}

export interface LifecycleInput {
  refunded?: string;
  disputed?: string;
  dispute_won?: string;
  cancelled?: string;
  ended?: string;
  resource_name?: string;
}

export interface LifecycleFlags {
  isRefund: boolean;
  isDispute: boolean;
  isCancelled: boolean;
  isEnded: boolean;
  isLifecycle: boolean;
}

export function classifyLifecycle(p: LifecycleInput): LifecycleFlags {
  const isRefund = truthy(p.refunded) || p.resource_name === "refund";
  // A won dispute is NOT a downgrade — only an open/lost dispute.
  const isDispute = (truthy(p.disputed) && !truthy(p.dispute_won)) || p.resource_name === "dispute";
  const isCancelled = truthy(p.cancelled) || p.resource_name === "cancellation";
  const isEnded = truthy(p.ended) || p.resource_name === "subscription_ended";
  return {
    isRefund,
    isDispute,
    isCancelled,
    isEnded,
    isLifecycle: isRefund || isDispute || isCancelled || isEnded,
  };
}

/** Timestamp columns to set for this lifecycle event; the projector downgrades. */
export function buildLifecyclePatch(f: LifecycleFlags, nowIso: string): Record<string, string> {
  const patch: Record<string, string> = {};
  if (f.isRefund) patch.refunded_at = nowIso;
  if (f.isDispute) patch.disputed_at = nowIso;
  if (f.isCancelled) patch.subscription_cancelled_at = nowIso;
  if (f.isEnded) patch.subscription_ended_at = nowIso;
  return patch;
}

/**
 * Audit H10: a lifecycle UPDATE that matches NO ledger row must be retried by
 * Gumroad (the original sale row may be arriving out of order), not acked 200 —
 * otherwise a refunded/cancelled buyer keeps membership forever. 0 rows → 409
 * (retryable), ≥1 row → 200.
 */
export function lifecycleMatchStatus(matchedRows: number): 200 | 409 {
  return matchedRows > 0 ? 200 : 409;
}
