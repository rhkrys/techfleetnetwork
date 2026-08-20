// Unit tests for the email tier registry (pure domain, no I/O).
// Run in CI via ci.yml deno-check "Edge unit gates".
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AUTH_TEMPLATES, BULK_TEMPLATES } from "./types.ts";
import {
  EMAIL_TIERS,
  REGISTERED_TEMPLATES,
  getEmailSpec,
  isCriticalTransactional,
  requireEmailSpec,
  unsubBucketOf,
} from "./email-tiers.ts";

Deno.test("getEmailSpec returns the spec for a known template", () => {
  const spec = getEmailSpec("interview-invite");
  assert(spec);
  assertEquals(spec?.tier, 0);
});

Deno.test("requireEmailSpec throws on an unregistered template", () => {
  assertThrows(() => requireEmailSpec("not-a-real-template"), Error, "tier registry entry");
});

Deno.test("isCriticalTransactional is true only for Tier 0", () => {
  assert(isCriticalTransactional("interview-invite"));
  assert(isCriticalTransactional("signup"));
  assert(!isCriticalTransactional("quest-nudge")); // Tier 1
  assert(!isCriticalTransactional("announcement")); // per-send
  assert(!isCriticalTransactional("fleety-coach-digest")); // ops
  assert(!isCriticalTransactional("unknown-template"));
});

Deno.test("unsubBucketOf returns none for unknown templates", () => {
  assertEquals(unsubBucketOf("unknown-template"), "none");
  assertEquals(unsubBucketOf("quest-nudge"), "opportunities");
});

// --- Safety invariants ---

Deno.test('INVARIANT: every Tier-0 email is in the "none" unsubscribe bucket', () => {
  // A critical email must never sit in a member-controllable unsubscribe bucket.
  for (const [template, spec] of Object.entries(EMAIL_TIERS)) {
    if (spec.tier === 0) {
      assertEquals(
        spec.bucket,
        "none",
        `Tier-0 template "${template}" must have bucket "none", got "${spec.bucket}"`
      );
    }
  }
});

Deno.test("INVARIANT: no email is both marketing-bucket and Tier 0/1", () => {
  for (const [template, spec] of Object.entries(EMAIL_TIERS)) {
    if (spec.bucket === "marketing") {
      assert(
        spec.tier === 2 || spec.tier === "per-send",
        `Marketing-bucket template "${template}" must be Tier 2 or per-send, got tier ${spec.tier}`
      );
    }
  }
});

Deno.test("INVARIANT: auth-lane templates match AUTH_TEMPLATES and are Tier 0", () => {
  for (const template of AUTH_TEMPLATES) {
    const spec = getEmailSpec(template);
    assert(spec, `AUTH template "${template}" is missing from EMAIL_TIERS`);
    assertEquals(spec?.lane, "auth", `AUTH template "${template}" must be lane "auth"`);
    assertEquals(spec?.tier, 0, `AUTH template "${template}" must be Tier 0`);
  }
});

Deno.test('INVARIANT: BULK_TEMPLATES all carry the "bulk" lane in the registry', () => {
  for (const template of BULK_TEMPLATES) {
    const spec = getEmailSpec(template);
    assert(spec, `BULK template "${template}" is missing from EMAIL_TIERS`);
    assertEquals(spec?.lane, "bulk", `BULK template "${template}" must be lane "bulk"`);
  }
});

Deno.test("announcement is classified per-send, never a fixed tier", () => {
  assertEquals(getEmailSpec("announcement")?.tier, "per-send");
});

Deno.test("registry is non-empty and REGISTERED_TEMPLATES matches the map", () => {
  assert(REGISTERED_TEMPLATES.length > 0);
  assertEquals(REGISTERED_TEMPLATES.length, Object.keys(EMAIL_TIERS).length);
});
