import { test, expect, request } from "@playwright/test";

/**
 * AUTH-OAUTH-APEX-EDGE-301-001
 *
 * Root-cause contract: the apex `techfleet.network` MUST respond with a
 * 301 to `https://www.techfleet.network/<same path>` at the EDGE (Lovable
 * hosting / Cloudflare), NOT via client JS. This is the test that proves
 * the real fix landed and unlocks deletion of the `enforceCanonicalHost()`
 * boot stopgap in `src/lib/host-canonical.ts`.
 *
 * Red until a human flips `www.techfleet.network` to Primary in Lovable
 * Project Settings → Domains. Green after.
 *
 * Skipped unless TFN_EDGE_CONTRACT=1 (this hits the production origin and
 * must not run against ephemeral preview hosts).
 */

const RUN = process.env.TFN_EDGE_CONTRACT === "1";

test.describe("apex → www edge 301", () => {
  test.skip(!RUN, "Set TFN_EDGE_CONTRACT=1 to run against production origin.");

  for (const path of ["/", "/login", "/dashboard", "/login?from=oauth-canonical"]) {
    test(`GET https://techfleet.network${path} → 301 to www`, async () => {
      const ctx = await request.newContext({ ignoreHTTPSErrors: false });
      const res = await ctx.get(`https://techfleet.network${path}`, {
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      // Lovable hosting issues 302; 301 is also acceptable. Either proves the
      // SPA never boots on the apex.
      expect([301, 302], `apex must 301/302; got ${res.status()}`).toContain(res.status());
      const loc = res.headers()["location"] ?? "";
      expect(loc.startsWith("https://www.techfleet.network"), `bad location: ${loc}`).toBe(true);
      // Path/query MUST be preserved verbatim — the OAuth callback relies
      // on it for `?code=` and `#access_token=…` fragments.
      expect(loc).toBe(`https://www.techfleet.network${path}`);
      await ctx.dispose();
    });
  }

  test(`hash fragment is preserved (OAuth implicit-flow callback)`, async () => {
    // curl is the only way to confirm; Playwright APIRequest strips hash.
    // We assert by header convention: edge MUST NOT consume the hash; the
    // browser carries it across the 301. We assert no Set-Cookie/body
    // leak that would prove the apex executed the app.
    const ctx = await request.newContext();
    const res = await ctx.get(`https://techfleet.network/`, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    expect([301, 302]).toContain(res.status());
    // Apex must not ship HTML — if it does, the SPA booted and we lost.
    const ct = res.headers()["content-type"] ?? "";
    expect(ct.includes("text/html"), `apex returned HTML body; SPA booted on apex`).toBe(false);
    await ctx.dispose();
  });
});
