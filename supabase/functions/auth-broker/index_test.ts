import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SIGN_IN_PASSWORD_REQ, SIGN_IN_PASSWORD_RES } from "./schemas.ts";

Deno.test("auth-broker zod contract: sign-in/password req requires email + password + correlationId", () => {
  const bad = SIGN_IN_PASSWORD_REQ.safeParse({ email: "not-an-email", password: "x", correlationId: "abc" });
  assertEquals(bad.success, false);

  const good = SIGN_IN_PASSWORD_REQ.safeParse({
    email: "vichea@example.com",
    password: "hunter22hunter22",
    correlationId: "corr-12345678",
  });
  assertEquals(good.success, true);
});

Deno.test("auth-broker zod contract: response is a discriminated union on `ok`", () => {
  const okRes = SIGN_IN_PASSWORD_RES.safeParse({
    ok: true,
    kind: "signed_in",
    userId: "11111111-1111-1111-1111-111111111111",
    session: { access_token: "a".repeat(40), refresh_token: "r".repeat(40), expires_in: 3600 },
    correlationId: "corr-12345678",
  });
  assertEquals(okRes.success, true);

  const errRes = SIGN_IN_PASSWORD_RES.safeParse({
    ok: false,
    code: "invalid_credentials",
    correlationId: "corr-12345678",
  });
  assertEquals(errRes.success, true);

  // Unknown code MUST be rejected.
  const unknown = SIGN_IN_PASSWORD_RES.safeParse({
    ok: false,
    code: "definitely_not_a_real_code",
    correlationId: "corr-12345678",
  });
  assertEquals(unknown.success, false);
});
