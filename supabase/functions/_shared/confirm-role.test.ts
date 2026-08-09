// Audit Wave 1 regression — role-confirmation decision logic (H12/H13/T-G).
// Pure-function coverage of every gate: method, origin, auth, token, existence,
// already-confirmed, expiry, ownership, grant.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateConfirmation, isAllowedOrigin, type PromotionRow } from "./confirm-role.ts";

const ALLOWED = new Set(["https://www.techfleet.network", "https://techfleet.network"]);
const OWNER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const TOKEN = "a".repeat(64);
const NOW = Date.parse("2026-08-09T00:00:00Z");

function pending(overrides: Partial<PromotionRow> = {}): PromotionRow {
  return {
    id: "p1",
    user_id: OWNER,
    confirmed_at: null,
    expires_at: "2026-08-16T00:00:00Z", // 7 days out
    ...overrides,
  };
}

function evalWith(overrides: Record<string, unknown> = {}) {
  return evaluateConfirmation({
    method: "POST",
    origin: "https://www.techfleet.network",
    allowedOrigins: ALLOWED,
    callerId: OWNER,
    token: TOKEN,
    promotion: pending(),
    nowMs: NOW,
    ...overrides,
  } as Parameters<typeof evaluateConfirmation>[0]);
}

Deno.test("happy path: owner, valid token, unexpired, unconfirmed -> grant", () => {
  assertEquals(evalWith().kind, "grant");
});

Deno.test("T-G: bare GET (email prefetch) is rejected before any state change", () => {
  assertEquals(evalWith({ method: "GET" }).kind, "method_not_allowed");
});

Deno.test("T-G: unauthenticated caller (prefetcher carries no JWT) -> 401", () => {
  const d = evalWith({ callerId: null });
  assertEquals(d.kind, "unauthenticated");
  assertEquals(d.status, 401);
});

Deno.test("T-G: signed-in NON-owner cannot confirm someone else's promotion -> 403", () => {
  const d = evalWith({ callerId: OTHER });
  assertEquals(d.kind, "not_owner");
  assertEquals(d.status, 403);
});

Deno.test("CSRF: a present but disallowed Origin is rejected", () => {
  assertEquals(evalWith({ origin: "https://evil.example" }).kind, "forbidden_origin");
});

Deno.test("CSRF: a missing Origin is allowed (JWT ownership is the primary gate)", () => {
  assertEquals(evalWith({ origin: null }).kind, "grant");
});

Deno.test("bad token format -> 400", () => {
  assertEquals(evalWith({ token: "nope" }).kind, "bad_token");
  assertEquals(evalWith({ token: null }).kind, "bad_token");
});

Deno.test("unknown token (no row) -> 404", () => {
  assertEquals(evalWith({ promotion: null }).kind, "not_found");
});

Deno.test("H12: expired promotion -> 410", () => {
  const d = evalWith({ promotion: pending({ expires_at: "2026-08-01T00:00:00Z" }) });
  assertEquals(d.kind, "expired");
  assertEquals(d.status, 410);
});

Deno.test("H12: null expires_at never counts as expired", () => {
  assertEquals(evalWith({ promotion: pending({ expires_at: null }) }).kind, "grant");
});

Deno.test("single-use: already-confirmed promotion is idempotent (200)", () => {
  const d = evalWith({ promotion: pending({ confirmed_at: "2026-08-08T00:00:00Z" }) });
  assertEquals(d.kind, "already_confirmed");
  assertEquals(d.status, 200);
});

Deno.test("gate ordering: method is checked before auth/ownership", () => {
  // A non-owner making a GET still sees method_not_allowed first (no info leak).
  assertEquals(
    evalWith({ method: "GET", callerId: OTHER, promotion: null }).kind,
    "method_not_allowed"
  );
});

Deno.test("gate ordering: auth is checked before token existence", () => {
  assertEquals(evalWith({ callerId: null, promotion: null }).kind, "unauthenticated");
});

Deno.test("isAllowedOrigin: allow-list + malformed handling", () => {
  assertEquals(isAllowedOrigin("https://www.techfleet.network", ALLOWED), true);
  assertEquals(isAllowedOrigin("https://evil.example", ALLOWED), false);
  assertEquals(isAllowedOrigin(null, ALLOWED), true);
  assertEquals(isAllowedOrigin("not-a-url", ALLOWED), false);
});
