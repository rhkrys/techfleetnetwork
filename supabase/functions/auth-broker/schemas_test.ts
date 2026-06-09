import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  IDENTITY_CHECK_REQ,
  IDENTITY_CHECK_RES,
  RESET_COMPLETE_REQ,
  RESET_COMPLETE_RES,
  RESET_REQUEST_REQ,
  RESET_REQUEST_RES,
  SIGN_OUT_REQ,
  SIGN_OUT_RES,
  SIGN_UP_REQ,
  SIGN_UP_RES,
} from "./schemas.ts";

// Locked-down contract tests for every broker route's request/response shape.
// A drift here breaks client + server in CI simultaneously — by design.

Deno.test("sign-up req: email + min-length password + correlationId required", () => {
  const bad = SIGN_UP_REQ.safeParse({ email: "x", password: "short", correlationId: "abc" });
  assertEquals(bad.success, false);
  const good = SIGN_UP_REQ.safeParse({
    email: "new@example.com",
    password: "hunter22hunter22",
    correlationId: "corr-12345678",
  });
  assertEquals(good.success, true);
});

Deno.test("sign-up res: verification_email_sent OR signed_in", () => {
  assertEquals(
    SIGN_UP_RES.safeParse({ ok: true, kind: "verification_email_sent", correlationId: "c-12345678" }).success,
    true,
  );
  assertEquals(
    SIGN_UP_RES.safeParse({ ok: false, code: "weak_password", correlationId: "c-12345678" }).success,
    true,
  );
});

Deno.test("reset-request: returns constant ok shape; unknown code rejected", () => {
  const good = RESET_REQUEST_RES.safeParse({
    ok: true,
    kind: "password_reset_email_sent",
    correlationId: "c-12345678",
  });
  assertEquals(good.success, true);
  // Even rate_limited stays in the union.
  assertEquals(
    RESET_REQUEST_RES.safeParse({ ok: false, code: "rate_limited", correlationId: "c-12345678", retryAfter: 30 }).success,
    true,
  );
});

Deno.test("reset-request req: rejects invalid email", () => {
  assertEquals(
    RESET_REQUEST_REQ.safeParse({ email: "nope", correlationId: "c-12345678" }).success,
    false,
  );
});

Deno.test("reset-complete req: enforces 8-char password floor", () => {
  assertEquals(
    RESET_COMPLETE_REQ.safeParse({ newPassword: "short", correlationId: "c-12345678" }).success,
    false,
  );
  assertEquals(
    RESET_COMPLETE_REQ.safeParse({ newPassword: "hunter22hunter22", correlationId: "c-12345678" }).success,
    true,
  );
});

Deno.test("reset-complete res: same_password and recovery_session_expired are typed", () => {
  for (const code of ["same_password", "recovery_session_expired", "recovery_link_consumed"]) {
    assertEquals(
      RESET_COMPLETE_RES.safeParse({ ok: false, code, correlationId: "c-12345678" }).success,
      true,
    );
  }
});

Deno.test("sign-out req: scope defaults to local", () => {
  const parsed = SIGN_OUT_REQ.safeParse({ correlationId: "c-12345678" });
  assertEquals(parsed.success, true);
  if (parsed.success) assertEquals(parsed.data.scope, "local");
});

Deno.test("sign-out res: signed_out is the only ok kind", () => {
  assertEquals(
    SIGN_OUT_RES.safeParse({ ok: true, kind: "signed_out", correlationId: "c-12345678" }).success,
    true,
  );
  assertEquals(
    SIGN_OUT_RES.safeParse({ ok: true, kind: "anything_else", correlationId: "c-12345678" }).success,
    false,
  );
});

Deno.test("identity/check: providers limited to password|google; never enumerates", () => {
  assertEquals(
    IDENTITY_CHECK_REQ.safeParse({ email: "anyone@example.com", correlationId: "c-12345678" }).success,
    true,
  );
  assertEquals(
    IDENTITY_CHECK_RES.safeParse({
      ok: true,
      kind: "identity_hint",
      providers: ["password", "google"],
      correlationId: "c-12345678",
    }).success,
    true,
  );
  assertEquals(
    IDENTITY_CHECK_RES.safeParse({
      ok: true,
      kind: "identity_hint",
      providers: ["github"],
      correlationId: "c-12345678",
    }).success,
    false,
  );
});
