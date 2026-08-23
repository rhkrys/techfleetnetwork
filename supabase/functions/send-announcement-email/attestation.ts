// PR 7: the "this is not marketing" attestation gate for the announcement email blast (pure, tested).
// Announcements are Tier-1 SERVICE email; marketing goes through Email Octopus (ADR-0017). The admin
// must attest, per send, that the content is not marketing before it reaches ~1200 members.

export type AttestationCheck = { ok: true } | { ok: false; error: string };

/**
 * Require an explicit marketing attestation in the request body. Only a literal boolean `true`
 * passes — a missing, false, or truthy-but-non-boolean value is rejected, so a caller cannot slip
 * past with `"true"` or `1`.
 */
export function requireMarketingAttestation(body: unknown): AttestationCheck {
  const attested = (body as { marketing_attested?: unknown } | null)?.marketing_attested;
  if (attested === true) return { ok: true };
  return { ok: false, error: "marketing_attestation_required" };
}
