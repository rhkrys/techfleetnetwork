// Audit T-F (#10): Discord signs the request timestamp (x-signature-timestamp,
// unix seconds) as part of the Ed25519-verified payload, so a captured, validly
// signed request can be REPLAYED indefinitely unless we also bound the timestamp.
// (This is why timestamp freshness is enforceable here but not for FreeScout's
// body-only HMAC, which correctly relies on event_id dedupe instead.)
//
// Pure + injectable clock so it's unit-testable without Deno.serve.
export function isFreshTimestamp(
  timestamp: string | null,
  nowMs: number,
  windowSec = 300
): boolean {
  if (!timestamp) return false;
  const tsSec = Number(timestamp);
  if (!Number.isFinite(tsSec)) return false;
  return Math.abs(nowMs / 1000 - tsSec) <= windowSec;
}
