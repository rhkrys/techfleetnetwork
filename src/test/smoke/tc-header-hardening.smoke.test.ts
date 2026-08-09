// Smoke coverage for audit T-C — client-controlled headers must not be trusted
// for security. Hermetic file-content invariants; the helpers are unit-tested in
// _shared/client-ip.test.ts and _shared/bounded-body.test.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const clientIp = read("supabase/functions/_shared/client-ip.ts");
const compliance = read("supabase/functions/_shared/compliance.ts");
const waf = read("supabase/functions/_shared/waf.ts");
const http = read("supabase/functions/_shared/http.ts");

describe("T-C header hardening (smoke)", () => {
  it("T-C-001: client-ip helper prefers cf-connecting-ip over XFF", () => {
    expect(clientIp).toMatch(/cf-connecting-ip/);
    // Must not return the spoofable leftmost XFF entry.
    expect(clientIp).not.toMatch(/x-forwarded-for[\s\S]*split\(","\)\[0\]/);
  });

  it("T-C-002: compliance + waf no longer trust XFF-leftmost", () => {
    // compliance re-exports the hardened helper; neither reimplements the bug.
    expect(compliance).toMatch(/from "\.\/client-ip\.ts"/);
    expect(compliance).not.toMatch(/x-forwarded-for[\s\S]*split\(","\)\[0\]/);
    expect(waf).toMatch(/clientIpOr/);
    expect(waf).not.toMatch(/x-forwarded-for[\s\S]*split\(","\)\[0\]!/);
  });

  it("T-C-003: parseJsonBody uses the bounded streaming reader, not raw req.json()", () => {
    expect(http).toMatch(/readBoundedText/);
    expect(http).not.toMatch(/return await req\.json\(\)/);
  });
});
