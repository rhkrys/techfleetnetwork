// INCIDENT edge-deploy-smoke-false-alarms-2026-08.
//
// The Aug-2026 activity-log audit found 36,270 `edge_function_not_deployed`
// rows (91% of the entire log) — all false. The old probe (index.ts) pinged
// each function with OPTIONS and classified as "not deployed" if the response
// was 404 OR the fetch threw/timed out. Two false-positive sources:
//   1. A DEPLOYED function that lacks an OPTIONS/CORS handler also returns 404,
//      so "404" could not be distinguished from "missing."
//   2. Under 8-way concurrency with a 5s AbortSignal timeout, a transient slow
//      response threw -> the catch block marked the function "not deployed."
// It even libeled `handoff-worker` (verify_jwt:true, proven alive by its own
// succeeding 5-min cron).
//
// These pure helpers make the classification reliable and unit-testable
// without booting the Deno.serve listener.

export type ProbeVerdict = "alive" | "missing" | "inconclusive";

/**
 * Classify a single function probe result.
 *
 * @param status HTTP status from the probe, or 0 when the fetch threw/timed out.
 * @param verifyJwt the function's manifest `verify_jwt` flag — determines both
 *        the probe method (see probeMethodFor) and how a 404 is interpreted.
 */
export function classifyProbe(status: number, verifyJwt: boolean): ProbeVerdict {
  // Transient: fetch threw or timed out. NOT evidence of removal. The old code
  // paged on this and, with the concurrent 5s-timeout probe, that was the
  // dominant false-alarm source.
  if (status === 0) return "inconclusive";

  if (verifyJwt) {
    // Probed unauthenticated: the platform JWT gate answers BEFORE the function
    // executes. 401/403 therefore positively proves the function is deployed;
    // only the gateway's own 404 means it is genuinely missing.
    if (status === 401 || status === 403) return "alive";
    if (status === 404) return "missing";
    return "alive";
  }

  // verify_jwt=false: probed with OPTIONS (side-effect-free). A deployed
  // function that lacks an OPTIONS/CORS handler ALSO returns 404, so a 404 here
  // cannot be distinguished from "missing" — treat it as inconclusive and never
  // page on it alone. Any non-404 response proves the function booted.
  if (status === 404) return "inconclusive";
  return "alive";
}

/**
 * Pick a side-effect-free probe method for a function based on its auth gate.
 * - verify_jwt=true: an unauthenticated GET is rejected by the platform (401)
 *   BEFORE the function runs — safe, and a positive liveness signal.
 * - verify_jwt=false: a GET would EXECUTE the function (possible side effects),
 *   so use a preflight OPTIONS, which never runs handler logic.
 */
export function probeMethodFor(verifyJwt: boolean): "GET" | "OPTIONS" {
  return verifyJwt ? "GET" : "OPTIONS";
}
