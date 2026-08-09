// Audit T-F (#10) regression — Discord interaction replay window.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isFreshTimestamp } from "./freshness.ts";

const NOW = 1_700_000_000_000; // fixed clock (ms)
const nowSec = NOW / 1000;

Deno.test("accepts a timestamp within the ±300s window", () => {
  assertEquals(isFreshTimestamp(String(nowSec), NOW), true);
  assertEquals(isFreshTimestamp(String(nowSec - 299), NOW), true);
  assertEquals(isFreshTimestamp(String(nowSec + 299), NOW), true);
});

Deno.test("rejects a stale (replayed) timestamp", () => {
  assertEquals(isFreshTimestamp(String(nowSec - 301), NOW), false);
  assertEquals(isFreshTimestamp(String(nowSec - 86_400), NOW), false);
});

Deno.test("rejects a far-future timestamp", () => {
  assertEquals(isFreshTimestamp(String(nowSec + 301), NOW), false);
});

Deno.test("rejects missing / non-numeric timestamps", () => {
  assertEquals(isFreshTimestamp(null, NOW), false);
  assertEquals(isFreshTimestamp("", NOW), false);
  assertEquals(isFreshTimestamp("not-a-number", NOW), false);
});
