// INCIDENT edge-deploy-smoke-false-alarms-2026-08 regression.
// Locks the reliability rules that stop the 36,270-row false-alarm flood:
// transient timeouts and OPTIONS-ambiguous 404s must NEVER be classified as a
// pageable "missing".
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyProbe, probeMethodFor } from "./probe.ts";

Deno.test(
  "timeout / network throw (status 0) is inconclusive, never 'missing' — the dominant false-alarm source",
  () => {
    assertEquals(classifyProbe(0, true), "inconclusive");
    assertEquals(classifyProbe(0, false), "inconclusive");
  }
);

Deno.test(
  "verify_jwt=true: 401/403 positively proves deployed (fixes the handoff-worker false alarm)",
  () => {
    assertEquals(classifyProbe(401, true), "alive");
    assertEquals(classifyProbe(403, true), "alive");
  }
);

Deno.test(
  "verify_jwt=true: only the gateway's 404 is a confirmed 'missing' (the one thing allowed to page)",
  () => {
    assertEquals(classifyProbe(404, true), "missing");
  }
);

Deno.test(
  "verify_jwt=false: OPTIONS 404 is ambiguous (no-handler vs missing) -> inconclusive, never pages",
  () => {
    assertEquals(classifyProbe(404, false), "inconclusive");
  }
);

Deno.test("any non-404 response proves the function booted -> alive", () => {
  assertEquals(classifyProbe(200, false), "alive");
  assertEquals(classifyProbe(405, false), "alive");
  assertEquals(classifyProbe(500, true), "alive");
  assertEquals(classifyProbe(204, false), "alive");
});

Deno.test("probe method is side-effect-free per auth gate", () => {
  assertEquals(probeMethodFor(true), "GET"); // JWT-gated: rejected pre-exec
  assertEquals(probeMethodFor(false), "OPTIONS"); // preflight: never runs handler
});
