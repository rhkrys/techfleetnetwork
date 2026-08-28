// Module: supabase/functions/_shared (bdd-gate coverage marker)
// ADR-0021 — feature-flag edge read: kill-switch + %-dial + safe-OFF default.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { flagEnabled, hashBucket, type FeatureFlagClient } from "./feature-flags.ts";

function client(
  row: { enabled: boolean; rollout_percent: number } | null,
  error: unknown = null
): FeatureFlagClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error }) }),
      }),
    }),
  };
}

Deno.test("hashBucket is deterministic and in [0,100)", () => {
  const b = hashBucket("logger_error_reporting|u1");
  assertEquals(b, hashBucket("logger_error_reporting|u1"));
  assert(b >= 0 && b < 100);
});

// Golden vector — MUST equal the client copy (src/services/feature-flags.service.test.ts).
// If either side's hashBucket changes, cohorts drift between client and edge; this catches it.
Deno.test("hashBucket matches the cross-runtime golden vector", () => {
  assertEquals(hashBucket("logger_error_reporting|u1"), 29);
});

Deno.test("flagEnabled is OFF when absent, disabled, or query errors", async () => {
  assertEquals(await flagEnabled(client(null), "k", "u1"), false);
  assertEquals(
    await flagEnabled(client({ enabled: false, rollout_percent: 100 }), "k", "u1"),
    false
  );
  assertEquals(await flagEnabled(client(null, new Error("boom")), "k", "u1"), false);
});

Deno.test("flagEnabled honors 100% on / 0% off", async () => {
  assertEquals(await flagEnabled(client({ enabled: true, rollout_percent: 100 }), "k", "u1"), true);
  assertEquals(await flagEnabled(client({ enabled: true, rollout_percent: 0 }), "k", "u1"), false);
});

Deno.test("flagEnabled respects the dial threshold (bucket < percent)", async () => {
  const uid = "user-42";
  const b = hashBucket(`k|${uid}`);
  assertEquals(
    await flagEnabled(client({ enabled: true, rollout_percent: b + 1 }), "k", uid),
    true
  );
  assertEquals(await flagEnabled(client({ enabled: true, rollout_percent: b }), "k", uid), false);
});
