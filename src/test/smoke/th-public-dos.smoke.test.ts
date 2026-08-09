// Smoke coverage for audit T-H — unauth cost/DoS on public endpoints.
// Hermetic file-content invariants; the limiter RPC is proven in
// supabase/tests/edge_rate_limit_test.sql.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const REPO = process.cwd();
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

const webVital = read("supabase/functions/record-web-vital/index.ts");
const i18n = read("supabase/functions/get-i18n-bundle/index.ts");
const migration =
  readdirSync(resolve(REPO, "supabase/migrations"))
    .filter((f) => /edge_rate_limit\.sql$/.test(f))
    .map((f) => read(`supabase/migrations/${f}`))[0] ?? "";

describe("T-H public-endpoint DoS hardening (smoke)", () => {
  it("T-H-001: record-web-vital rate-limits + bounds the body + drops the CORS credential anti-pattern", () => {
    expect(webVital).toMatch(/enforceEdgeRateLimit\(req,/);
    expect(webVital).toMatch(/readBoundedText\(req,/);
    // Must not buffer the whole body first, nor reflect Origin with credentials.
    expect(webVital).not.toMatch(/const raw = await req\.text\(\)/);
    expect(webVital).not.toMatch(/Access-Control-Allow-Credentials/);
  });

  it("T-H-002: get-i18n-bundle rate-limits and returns generic errors", () => {
    expect(i18n).toMatch(/enforceEdgeRateLimit\(req,/);
    expect(i18n).toMatch(/status:\s*429/);
    // No raw error.message leaked to the client.
    expect(i18n).not.toMatch(/error:\s*error\.message/);
    expect(i18n).not.toMatch(/error:\s*\(err as Error\)\.message/);
  });

  it("T-H-003: the generic limiter is deny-by-default, hashed, action-scoped, REVOKEd", () => {
    expect(migration).toBeTruthy();
    expect(migration).toMatch(/create table if not exists public\.edge_rate_limits/i);
    expect(migration).toMatch(/enable row level security/i);
    expect(migration).toMatch(/digest\(p_action \|\| ':' \|\| p_identifier, 'sha256'\)/i);
    expect(migration).toMatch(/set search_path = public/i);
    expect(migration).toMatch(
      /revoke all on function public\.check_edge_rate_limit[\s\S]*from public, anon, authenticated/i
    );
  });
});
