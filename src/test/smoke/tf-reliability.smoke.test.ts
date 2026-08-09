// Coverage for audit T-F standalone reliability/security fixes.
// dlp is pure (no Deno APIs) so we exercise it for real; the others are grep
// invariants (they pull in Deno/service-role deps).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { containsSensitive } from "../../../supabase/functions/_shared/dlp.ts";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("T-F reliability fixes", () => {
  it("T-F-DLP-001: containsSensitive is stateless (no /g lastIndex leak)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF_ghijKLMno";
    // The bug: a second .test() on a shared /g regex could return false. Assert
    // repeated calls are consistently true (and interleaved calls don't drift).
    for (let i = 0; i < 5; i++) expect(containsSensitive(jwt)).toBe(true);
    expect(containsSensitive("nothing sensitive here")).toBe(false);
    expect(containsSensitive(jwt)).toBe(true);
  });

  it("T-F-WAF-001: applyWaf guards decodeURIComponent (fails closed, no crash)", () => {
    const waf = read("supabase/functions/_shared/waf.ts");
    expect(waf).toMatch(/try\s*\{\s*decodedUrl = decodeURIComponent\(url\)/);
    expect(waf).toMatch(/waf_bad_encoding/);
    // The SQLi check must run on the guarded value, not a raw decode call.
    expect(waf).not.toMatch(/SQLI_RE\.test\(decodeURIComponent\(/);
  });

  it("T-F-SANCTIONS-001: screen-sanctions fails closed if the audit write errors", () => {
    const src = read("supabase/functions/screen-sanctions/index.ts");
    expect(src).toMatch(
      /error: auditErr\s*\}\s*=\s*await client\.rpc\("record_sanctions_screening"/
    );
    expect(src).toMatch(/if \(auditErr\)/);
    expect(src).toMatch(/screening_unavailable[\s\S]{0,40}503/);
  });

  it("T-F-PROBER-001: auth-prober queries prior runs before inserting this run", () => {
    const src = read("supabase/functions/auth-prober/index.ts");
    const priorIdx = src.indexOf('.select("stage, outcome, created_at")');
    const insertIdx = src.indexOf(".insert(rows)");
    expect(priorIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(priorIdx).toBeLessThan(insertIdx); // prior-run lookup precedes the insert
  });
});
