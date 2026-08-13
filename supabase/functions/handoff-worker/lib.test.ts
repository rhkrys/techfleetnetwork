// Unit tests for the handoff-worker pure helpers (supabase/functions/handoff-worker/lib.ts):
// the resumable-cursor -> coarse-status mapping and the fail-closed service-role bearer check.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { bearerMatches, statusForCursor } from "./lib.ts";

Deno.test("statusForCursor maps each step-machine stage to a coarse run status", () => {
  assertEquals(statusForCursor({ stage: "extract", i: 0 }), "extracting");
  assertEquals(statusForCursor({ stage: "write", i: 3 }), "writing");
  assertEquals(statusForCursor({ stage: "finalize", i: 1 }), "rendering"); // default bucket
  assertEquals(statusForCursor({ stage: "done" }), "rendering");
});

Deno.test("bearerMatches: exact match only, length-guarded, fails closed on an empty key", () => {
  assert(bearerMatches("s3cret-token", "s3cret-token"), "identical tokens match");
  assert(!bearerMatches("s3cret-token", "s3cret-toker"), "one differing char fails");
  assert(!bearerMatches("short", "s3cret-token"), "length mismatch fails without a byte compare");
  assert(!bearerMatches("anything", ""), "unset service-role key denies everyone (fail closed)");
  assert(!bearerMatches("", ""), "empty vs empty still denies (no key configured)");
});
