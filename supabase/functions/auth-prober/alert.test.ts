// Module: supabase/functions/auth-prober (bdd-gate D-13 coverage marker)
// The alert fingerprint must be a DETERMINISTIC, order-independent dedup key so
// notify-critical-fix pushes each distinct failure-set once (not per stage order,
// not per tick). Same class of guard as the announcement H8 test.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildAuthProberAlert } from "./alert.ts";

Deno.test("fingerprint is stable across stage order (order-independent dedup key)", () => {
  const a = buildAuthProberAlert(["sign_in", "reset_request"]);
  const b = buildAuthProberAlert(["reset_request", "sign_in"]);
  assertEquals(a.fingerprint, b.fingerprint);
});

Deno.test("distinct failure sets → distinct fingerprints", () => {
  const a = buildAuthProberAlert(["sign_in"]);
  const b = buildAuthProberAlert(["sign_in", "reset_request"]);
  assert(a.fingerprint !== b.fingerprint);
});

Deno.test("alert routes to agent_fix_queue as a severity=error row", () => {
  const alert = buildAuthProberAlert(["session_refresh"]);
  assertEquals(alert.event_type, "auth_prober_failure");
  assertEquals(alert.source, "auth-prober");
  assertEquals(alert.severity, "error");
  assert(alert.error_message.includes("session_refresh"));
});
