// Deno test for the Freescout base-URL config (env-override + https guard).
// _shared/freescout.ts throws at module load without FREESCOUT_API_KEY, so we
// set it BEFORE the dynamic import, then exercise the pure resolver.
// Run in CI via the deno-check job. Perms: --allow-env --allow-import.

import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("FREESCOUT_API_KEY", "test-key-not-real");
const { resolveFreescoutBaseUrl } = await import("./freescout.ts");

Deno.test("resolveFreescoutBaseUrl defaults to the current pod when unset/empty", () => {
  assertEquals(resolveFreescoutBaseUrl(undefined), "https://bulky-kagu.pikapod.net");
  assertEquals(resolveFreescoutBaseUrl(null), "https://bulky-kagu.pikapod.net");
  assertEquals(resolveFreescoutBaseUrl(""), "https://bulky-kagu.pikapod.net");
});

Deno.test("resolveFreescoutBaseUrl honors an https env override", () => {
  assertEquals(
    resolveFreescoutBaseUrl("https://support.techfleet.org"),
    "https://support.techfleet.org"
  );
});

Deno.test("resolveFreescoutBaseUrl rejects non-https (no channel downgrade)", () => {
  assertThrows(() => resolveFreescoutBaseUrl("http://evil.example"), Error, "https");
});
