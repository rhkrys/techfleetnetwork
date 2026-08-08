// Deno test for the shared service-role bearer validator.
// Run via CI deno-check "Edge unit gates" or: deno test --allow-env auth.test.ts
//
// SECURITY (audit C1): service-role is granted ONLY by an exact, constant-time
// match against SUPABASE_SERVICE_ROLE_KEY. A JWT whose payload merely *claims*
// role=service_role — with no verified signature — MUST be rejected. The prior
// version of this test asserted the forged token was ACCEPTED, which encoded the
// vulnerability as correct behavior and kept CI green on the bypass.

// This shared authorizer is the service-role gate for (traceability for the BDD
// coverage gate — these all call authorizeServiceRoleRequest):
//   supabase/functions/process-freescout-events
//   supabase/functions/fleety-embed
//   supabase/functions/fleety-learning-digest
//   supabase/functions/notify-critical-fix
//   supabase/functions/triage-digest-builder
//   supabase/functions/refresh-community-events
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorizeServiceRoleRequest, __test } from "../_shared/service-role-auth.ts";

const SECRET = "sb_secret_test_abc123";

Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SECRET);

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://x.test", { method: "POST", headers });
}

function makeJwt(claims: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const payload = btoa(JSON.stringify(claims))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `${header}.${payload}.sig`; // signature is a literal — i.e. FORGED / unverified
}

Deno.test("rejects missing bearer with 401", () => {
  const r = authorizeServiceRoleRequest(req());
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 401);
});

Deno.test("rejects malformed bearer with 401", () => {
  const r = authorizeServiceRoleRequest(req({ authorization: "Bearer " }));
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 401);
});

Deno.test("accepts the exact service-role key", () => {
  const r = authorizeServiceRoleRequest(req({ authorization: `Bearer ${SECRET}` }));
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.mode, "opaque");
});

// The core regression guard for audit C1: a forged/unsigned JWT claiming
// role=service_role must be REJECTED (previously this was accepted).
Deno.test("REJECTS a forged unsigned service_role JWT with 403", () => {
  const jwt = makeJwt({ role: "service_role", iss: "supabase" });
  const r = authorizeServiceRoleRequest(req({ authorization: `Bearer ${jwt}` }));
  assertEquals(r.ok, false, "forged service_role JWT must not be accepted");
  if (!r.ok) assertEquals(r.status, 403);
});

Deno.test("rejects an authenticated-role JWT with 403", () => {
  const jwt = makeJwt({ role: "authenticated", sub: "u1" });
  const r = authorizeServiceRoleRequest(req({ authorization: `Bearer ${jwt}` }));
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 403);
});

Deno.test("rejects a random opaque token with 403", () => {
  const r = authorizeServiceRoleRequest(req({ authorization: "Bearer not-the-secret" }));
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 403);
});

Deno.test("timingSafeEqualStr: true only on exact match", () => {
  assert(__test.timingSafeEqualStr("abc", "abc"));
  assert(!__test.timingSafeEqualStr("abc", "abd"));
  assert(!__test.timingSafeEqualStr("abc", "abcd")); // length mismatch
  assert(!__test.timingSafeEqualStr("", "x"));
});
