// Audit Wave 2 regression — sync-airtable IDOR ownership gate.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideOwnership } from "./ownership.ts";

const CALLER = "11111111-1111-1111-1111-111111111111";
const VICTIM = "22222222-2222-2222-2222-222222222222";

Deno.test("owned application -> ok", () => {
  assertEquals(
    decideOwnership({ callerUserId: CALLER, check: { found: true, rowUserId: CALLER } }),
    { ok: true }
  );
});

Deno.test("row not found / not visible -> 403 (no existence oracle)", () => {
  assertEquals(
    decideOwnership({ callerUserId: CALLER, check: { found: false, rowUserId: null } }),
    { ok: false, status: 403, error: "Forbidden: application not found or not owned by caller" }
  );
});

Deno.test("foreign row leaks past RLS -> still denied (defense in depth)", () => {
  // Same generic message as not-found so the two cases are indistinguishable to the caller.
  assertEquals(
    decideOwnership({ callerUserId: CALLER, check: { found: true, rowUserId: VICTIM } }),
    { ok: false, status: 403, error: "Forbidden: application not found or not owned by caller" }
  );
});

Deno.test("visible row with null user_id -> denied", () => {
  assertEquals(
    decideOwnership({ callerUserId: CALLER, check: { found: true, rowUserId: null } }).ok,
    false
  );
});

Deno.test("missing caller id -> denied", () => {
  assertEquals(
    decideOwnership({ callerUserId: "", check: { found: true, rowUserId: "" } }).ok,
    false
  );
});
