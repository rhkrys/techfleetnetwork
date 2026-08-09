// Smoke coverage for audit H15 — translate-strings / translate-bundle must
// validate a real JWT and enforce a spend cap. Hermetic file-content invariants;
// the decision logic is unit-tested in _shared/translation-guard.test.ts and the
// RPC in supabase/tests/translation_rate_limit_test.sql. If one fails, the
// unauth-spend hole has regressed — restore the guard, don't relax the test.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const REPO = process.cwd();
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

const strings = read("supabase/functions/translate-strings/index.ts");
const bundle = read("supabase/functions/translate-bundle/index.ts");
const guard = read("supabase/functions/_shared/translation-guard.ts");
const migration =
  readdirSync(resolve(REPO, "supabase/migrations"))
    .filter((f) => /translation_rate_limit\.sql$/.test(f))
    .map((f) => read(`supabase/migrations/${f}`))[0] ?? "";

describe("translate spend-cap hardening (smoke)", () => {
  it("H15-001: both functions go through the shared guard (not a bare Bearer-prefix check)", () => {
    for (const src of [strings, bundle]) {
      expect(src).toMatch(/from "\.\.\/_shared\/translation-guard\.ts"/);
      expect(src).toMatch(/guardTranslationRequest\(req,/);
      // The bogus "any string starting with Bearer passes" gate must be gone.
      expect(src).not.toMatch(/if\s*\(\s*!auth\.startsWith\("Bearer "\)\)/);
    }
  });

  it("H15-002: the guard validates a real JWT and rate-limits per identity", () => {
    expect(guard).toMatch(/auth\.getClaims\(/); // real token validation, not a prefix check
    expect(guard).toMatch(/check_translation_rate_limit/); // spend ceiling
    expect(guard).toMatch(/rateLimitIdentity\(/);
    // Unauthorized is decided before rate-limit (no counter abuse for anon garbage).
    expect(guard).toMatch(/if \(!i\.jwtValid\) return \{ kind: "unauthorized"/);
  });

  it("H15-003: migration creates a deny-by-default limiter that hashes the identifier + is REVOKEd", () => {
    expect(migration).toBeTruthy();
    expect(migration).toMatch(/create table if not exists public\.translation_rate_limits/i);
    expect(migration).toMatch(/enable row level security/i);
    expect(migration).toMatch(/create or replace function public\.check_translation_rate_limit/i);
    expect(migration).toMatch(/digest\(p_identifier, 'sha256'\)/i); // raw ip/uid never stored
    expect(migration).toMatch(/set search_path = public/i);
    expect(migration).toMatch(
      /revoke all on function public\.check_translation_rate_limit[\s\S]*from public, anon, authenticated/i
    );
  });
});
