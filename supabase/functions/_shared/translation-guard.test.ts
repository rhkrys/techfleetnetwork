// Audit Wave 1 regression — H15 translation gate decision logic.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideTranslationGate, rateLimitIdentity } from "./translation-guard.ts";

Deno.test("valid JWT + within limit -> ok(200)", () => {
  assertEquals(decideTranslationGate({ jwtValid: true, rateAllowed: true }), {
    kind: "ok",
    status: 200,
  });
});

Deno.test("no valid JWT -> unauthorized(401), checked before rate limit", () => {
  assertEquals(decideTranslationGate({ jwtValid: false, rateAllowed: true }), {
    kind: "unauthorized",
    status: 401,
  });
  // Even if rate limit is exhausted, unauth wins (no info leak / no counter abuse path).
  assertEquals(decideTranslationGate({ jwtValid: false, rateAllowed: false }), {
    kind: "unauthorized",
    status: 401,
  });
});

Deno.test("valid JWT but over limit -> rate_limited(429)", () => {
  assertEquals(decideTranslationGate({ jwtValid: true, rateAllowed: false }), {
    kind: "rate_limited",
    status: 429,
  });
});

Deno.test("rateLimitIdentity prefers uid, falls back to ip, then 'unknown'", () => {
  assertEquals(rateLimitIdentity("user-123", "1.2.3.4"), "uid:user-123");
  assertEquals(rateLimitIdentity(null, "1.2.3.4"), "ip:1.2.3.4");
  assertEquals(rateLimitIdentity(null, null), "ip:unknown");
  assertEquals(rateLimitIdentity(null, "   "), "ip:unknown");
});
