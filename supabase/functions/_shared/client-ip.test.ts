// Audit T-C regression — client IP resolution must not trust spoofable XFF.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { clientIp, clientIpOr } from "./client-ip.ts";

const reqWith = (h: Record<string, string>) => new Request("https://x/", { headers: h });

Deno.test("prefers cf-connecting-ip over a spoofed XFF leftmost", () => {
  const r = reqWith({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "6.6.6.6, 7.7.7.7" });
  assertEquals(clientIp(r), "1.2.3.4");
});

Deno.test("falls back to the LAST XFF hop, not the spoofable leftmost", () => {
  const r = reqWith({ "x-forwarded-for": "6.6.6.6, 10.0.0.9" });
  assertEquals(clientIp(r), "10.0.0.9");
});

Deno.test("falls back to x-real-ip, then null", () => {
  assertEquals(clientIp(reqWith({ "x-real-ip": "5.5.5.5" })), "5.5.5.5");
  assertEquals(clientIp(reqWith({})), null);
});

Deno.test("clientIpOr provides a stable fallback for bucket keys", () => {
  assertEquals(clientIpOr(reqWith({}), "unknown"), "unknown");
  assertEquals(clientIpOr(reqWith({ "cf-connecting-ip": "1.1.1.1" })), "1.1.1.1");
});
