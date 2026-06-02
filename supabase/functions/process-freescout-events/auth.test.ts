// Deno test for the shared service-role bearer validator.
// Run via supabase--test_edge_functions or: deno test --allow-env auth.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorizeServiceRoleRequest, __test } from "../_shared/service-role-auth.ts";

const SECRET = "sb_secret_test_abc123";

Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SECRET);

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://x.test", { method: "POST", headers });
}

function makeJwt(claims: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const payload = btoa(JSON.stringify(claims))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${header}.${payload}.sig`;
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

Deno.test("accepts opaque sb_secret_ token", () => {
  const r = authorizeServiceRoleRequest(req({ authorization: `Bearer ${SECRET}` }));
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.mode, "opaque");
});

Deno.test("accepts legacy service_role JWT", () => {
  const jwt = makeJwt({ role: "service_role", iss: "supabase" });
  const r = authorizeServiceRoleRequest(req({ authorization: `Bearer ${jwt}` }));
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.mode, "legacy_jwt");
});

Deno.test("rejects authenticated-role JWT with 403", () => {
  const jwt = makeJwt({ role: "authenticated", sub: "u1" });
  const r = authorizeServiceRoleRequest(req({ authorization: `Bearer ${jwt}` }));
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 403);
});

Deno.test("rejects random opaque token with 403", () => {
  const r = authorizeServiceRoleRequest(req({ authorization: "Bearer not-the-secret" }));
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 403);
});

Deno.test("parseJwtClaims returns null for non-JWT", () => {
  assertEquals(__test.parseJwtClaims("not-a-jwt"), null);
});
