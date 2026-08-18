// Security regression tests for the Fleety 2.1 trusted internal-caller check.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { constantTimeEqual, isTrustedInternal, MIN_INTERNAL_SECRET_LEN } from "./internal-auth.ts";

const GOOD = "s".repeat(MIN_INTERNAL_SECRET_LEN); // 32-char valid secret

Deno.test("constantTimeEqual: exact match true, any diff false", () => {
  assertEquals(constantTimeEqual("abc", "abc"), true);
  assertEquals(constantTimeEqual("abc", "abd"), false);
  assertEquals(constantTimeEqual("abc", "ab"), false); // length mismatch
  assertEquals(constantTimeEqual("", ""), true);
});

Deno.test("isTrustedInternal: accepts only an adequate secret matched exactly", () => {
  assertEquals(isTrustedInternal(GOOD, GOOD), true);
});

Deno.test(
  "isTrustedInternal: FAILS CLOSED on missing/short secret (no brute-forceable bypass)",
  () => {
    assertEquals(isTrustedInternal(undefined, GOOD), false); // secret unset
    assertEquals(isTrustedInternal("", GOOD), false); // secret blank
    assertEquals(isTrustedInternal("short", "short"), false); // too short even if it matches
    assertEquals(isTrustedInternal("s".repeat(31), "s".repeat(31)), false); // just under the floor
  }
);

Deno.test("isTrustedInternal: rejects missing or wrong header", () => {
  assertEquals(isTrustedInternal(GOOD, undefined), false);
  assertEquals(isTrustedInternal(GOOD, ""), false);
  assertEquals(isTrustedInternal(GOOD, "x".repeat(MIN_INTERNAL_SECRET_LEN)), false); // same length, wrong value
  assertEquals(isTrustedInternal(GOOD, GOOD + "x"), false); // right prefix, wrong length
});
