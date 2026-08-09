// Pure builder for the auth-prober critical-alert row written to agent_fix_queue
// (the table notify-critical-fix scans). Extracted from index.ts so the dedup
// fingerprint's determinism is unit-testable (see alert.test.ts).

export interface AuthProberAlert {
  fingerprint: string;
  event_type: "auth_prober_failure";
  source: "auth-prober";
  severity: "error";
  error_message: string;
}

/**
 * Stable per-failure-set fingerprint so notify-critical-fix pushes each distinct
 * failure once (respecting its hourly cap). Stages are sorted so their order in
 * the input never changes the key.
 */
export function buildAuthProberAlert(errStages: string[]): AuthProberAlert {
  return {
    fingerprint: `auth_prober.stage_failure.${[...errStages].sort().join("+")}`,
    event_type: "auth_prober_failure",
    source: "auth-prober",
    severity: "error",
    error_message: `Auth prober failed on consecutive runs at: ${errStages.join(", ")}`,
  };
}
