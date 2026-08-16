// Unit tests for the refresh trigger authorizer.
// Covers the decouple (dedicated secret), backward-compat (service-role key),
// and the fail-closed property (no widening when the dedicated secret is unset).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorizeRefreshRequest } from "./auth.ts";

const SVC = "service-role-key-AAAAAAAAAAAAAAAAAAAA";
const REFRESH = "events-refresh-secret-BBBBBBBBBBBBBBBB";

function req(token: string | null): Request {
  const h = new Headers();
  if (token !== null) h.set("Authorization", `Bearer ${token}`);
  return new Request("https://x.supabase.co/functions/v1/refresh-community-events", {
    method: "POST",
    headers: h,
  });
}

Deno.test("accepts the dedicated EVENTS_REFRESH_SECRET", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SVC);
  Deno.env.set("EVENTS_REFRESH_SECRET", REFRESH);
  const r = authorizeRefreshRequest(req(REFRESH));
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.via, "refresh_secret");
});

Deno.test("still accepts the service-role key (backward compatible)", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SVC);
  Deno.env.set("EVENTS_REFRESH_SECRET", REFRESH);
  const r = authorizeRefreshRequest(req(SVC));
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.via, "service_role");
});

Deno.test("rejects a wrong token with 403", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SVC);
  Deno.env.set("EVENTS_REFRESH_SECRET", REFRESH);
  const r = authorizeRefreshRequest(req("not-a-real-key"));
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 403);
});

Deno.test("rejects a missing bearer with 401", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SVC);
  Deno.env.set("EVENTS_REFRESH_SECRET", REFRESH);
  const r = authorizeRefreshRequest(req(null));
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 401);
});

Deno.test("fail-closed: unset EVENTS_REFRESH_SECRET never widens access", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SVC);
  Deno.env.delete("EVENTS_REFRESH_SECRET");
  // Service-role still works…
  assertEquals(authorizeRefreshRequest(req(SVC)).ok, true);
  // …but the (now-unconfigured) refresh secret grants nothing.
  assertEquals(authorizeRefreshRequest(req(REFRESH)).ok, false);
});
