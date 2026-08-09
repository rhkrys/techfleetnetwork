// Unit tests for supabase/functions/reap-class-module-orphans (orphan reaper).
// Pure-logic only, no network — run in CI's deno "Edge unit gates" step.
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { __test } from "./lib.ts";

const { chunk, isReapableKey } = __test;

Deno.test("chunk splits into batches and handles empties", () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk([], 100), []);
  assertEquals(chunk([1, 2], 100), [[1, 2]]);
});

Deno.test("chunk rejects a non-positive size", () => {
  assertThrows(() => chunk([1], 0));
  assertThrows(() => chunk([1], -1));
});

Deno.test("isReapableKey only matches the class/{uuid}/item/{uuid}/… shape", () => {
  assertEquals(
    isReapableKey(
      "class/11111111-1111-1111-1111-111111111111/item/22222222-2222-2222-2222-222222222222/abc-file.pdf"
    ),
    true
  );
  // Never touch anything outside the shape:
  assertEquals(isReapableKey("avatars/user/photo.png"), false);
  assertEquals(isReapableKey("class/not-a-uuid/item/x/y"), false);
  assertEquals(
    isReapableKey(
      "class/11111111-1111-1111-1111-111111111111/item/22222222-2222-2222-2222-222222222222/"
    ),
    false
  );
  assertEquals(isReapableKey("../../etc/passwd"), false);
  assertEquals(isReapableKey(""), false);
});
