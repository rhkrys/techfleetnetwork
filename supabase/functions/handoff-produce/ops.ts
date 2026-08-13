// Operational controls for hand-off production (SRE runbook helpers).
//
// The kill switch is one flag read in TWO places — the enqueue front door (handoff-produce) refuses
// NEW runs, and the durable worker (handoff-worker) HOLDS already-queued runs instead of draining
// them into a degraded provider. Sharing this single predicate keeps the two in lockstep, so an
// operator flips HANDOFF_PRODUCE_DISABLED once (no deploy) to "queue and hold" during an LLM outage
// or a cost runaway, then flips it back to resume exactly where the queue left off.

/**
 * PURE: is the hand-off kill switch engaged? Takes the raw env value (not the environment) so it is
 * trivially testable and importable without --allow-env. Accepts the common truthy spellings; any
 * other value (including unset) means "enabled" — the safe default is that production runs.
 */
export function killSwitchOn(raw: string | undefined | null): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
