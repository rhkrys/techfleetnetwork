// Ownership gate for sync-airtable (audit Wave 2 — IDOR).
//
// The endpoint upserts a general_applications row into Airtable keyed on
// `application_id`. Without an ownership check, ANY authenticated caller could
// pass a victim's application_id and overwrite that Airtable record (and
// re-stamp its user_id/user_email). This module holds the pure decision so it is
// unit-testable without Deno.serve or a live DB.
//
// The caller-facing outcome is a single generic 403 for both "no such row" and
// "row owned by someone else" so the endpoint is not an existence oracle.

export interface OwnershipCheck {
  /** Was a general_applications row with the requested id visible to the caller? */
  found: boolean;
  /** user_id of that row, if visible (RLS-scoped SELECT should only ever return the caller's own). */
  rowUserId: string | null;
}

export type OwnershipDecision = { ok: true } | { ok: false; status: number; error: string };

const FORBIDDEN: OwnershipDecision = {
  ok: false,
  status: 403,
  error: "Forbidden: application not found or not owned by caller",
};

/**
 * Decide whether `callerUserId` may sync the application described by `check`.
 * Deny-by-default: the row must exist, be visible, and carry the caller's user_id.
 */
export function decideOwnership({
  callerUserId,
  check,
}: {
  callerUserId: string;
  check: OwnershipCheck;
}): OwnershipDecision {
  if (!callerUserId) return FORBIDDEN;
  if (!check.found || check.rowUserId === null) return FORBIDDEN;
  if (check.rowUserId !== callerUserId) return FORBIDDEN;
  return { ok: true };
}
