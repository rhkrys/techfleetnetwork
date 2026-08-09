// Smoke coverage for audit T-F — the Discord support rate limit must increment
// atomically (no read-then-upsert TOCTOU that let concurrent taps bypass the
// per-member cap). Real atomicity is proven in
// supabase/tests/support_rate_limit_for_test.sql; these are cheap source-greps.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const REPO = process.cwd();
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

describe("support rate-limit atomicity (smoke)", () => {
  const src = read("supabase/functions/_shared/support-ticket.ts");

  it("TF-SUPPORT-RL-001: the Discord path calls the atomic RPC", () => {
    expect(src).toMatch(/support_check_rate_limit_for/);
  });

  it("TF-SUPPORT-RL-002: no read-then-upsert on support_rate_limits remains", () => {
    // the racy pattern: SELECT count … then upsert count = (rl?.count ?? 0) + 1
    expect(src).not.toMatch(/count:\s*\(rl\?\.count\s*\?\?\s*0\)\s*\+\s*1/);
    expect(src).not.toMatch(/\.from\(\s*["']support_rate_limits["']\s*\)/);
  });

  it("TF-SUPPORT-RL-003: the RPC does an atomic increment (ON CONFLICT … count + 1 RETURNING)", () => {
    const mig =
      readdirSync(resolve(REPO, "supabase/migrations"))
        .filter((f) => /support_rate_limit_for_atomic\.sql$/.test(f))
        .map((f) => read(`supabase/migrations/${f}`))[0] ?? "";
    expect(mig).toBeTruthy();
    expect(mig).toMatch(
      /on conflict[\s\S]*do update set count = public\.support_rate_limits\.count \+ 1/i
    );
    expect(mig).toMatch(/returning count into _count/i);
    // service-role only (takes an arbitrary subject_user_id)
    expect(mig).toMatch(/revoke all on function public\.support_check_rate_limit_for/i);
  });
});
