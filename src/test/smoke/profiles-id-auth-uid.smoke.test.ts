// Smoke coverage for audit T-A — profiles.id (PK) vs auth.uid() (== user_id)
// confusion. Identity lookups/updates must key on user_id, never the random PK;
// confusing them silently no-ops (consent never persisted, GDPR anonymize
// skipped, tickets invisible). These tests exercise the regression guard
// (scripts/ci/check-profiles-id-auth-uid.mjs) behaviorally against fixtures and
// pin the record_policy_ack fix migration.
import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const REPO = process.cwd();
const GUARD = resolve(REPO, "scripts/ci/check-profiles-id-auth-uid.mjs");
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

const tmps: string[] = [];
afterAll(() => {
  for (const d of tmps) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

/** Run the guard with cwd=root; return its exit code (0 = clean, 1 = violations). */
function runGuard(root: string): number {
  try {
    execFileSync("node", [GUARD], { cwd: root, stdio: "pipe" });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? 1;
  }
}

/** Build a throwaway repo-shaped fixture and return its root path. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ta-guard-"));
  tmps.push(root);
  // The guard scans BOTH supabase/functions and supabase/migrations and (post
  // gate-integrity hardening) fails closed if either root is missing — a real repo
  // always has both. Present both here so a fixture exercising only one still
  // models a realistic repo; the empty sibling contributes 0 files and 0 violations.
  mkdirSync(join(root, "supabase/functions"), { recursive: true });
  mkdirSync(join(root, "supabase/migrations"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(resolve(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe("profiles.id vs auth.uid() guard (smoke)", () => {
  it("T-A-001: flags an edge fn that keys profiles on the PK with an auth uid", () => {
    const root = fixture({
      "supabase/functions/bad/index.ts": [
        "const userId = user.id;",
        'const { data } = await client.from("profiles").select("id").eq("id", userId).maybeSingle();',
      ].join("\n"),
    });
    expect(runGuard(root)).toBe(1);
  });

  it("T-A-002: allows a genuine profiles-PK lookup (.eq('id', prof.id))", () => {
    const root = fixture({
      "supabase/functions/ok/index.ts": [
        'const { data: prof } = await client.from("profiles").select("id").eq("user_id", uid).maybeSingle();',
        'await client.from("class_members").update({ x: 1 }).eq("id", prof.id);',
        "// second profiles touch by resolved PK is fine:",
        'await client.from("profiles").update({ y: 2 }).eq("id", prof.id);',
      ].join("\n"),
    });
    expect(runGuard(root)).toBe(0);
  });

  it("T-A-003: flags a post-cutoff migration that updates profiles WHERE id = auth.uid()", () => {
    const root = fixture({
      "supabase/migrations/20260810000000_bad.sql":
        "UPDATE public.profiles SET foo = now() WHERE id = auth.uid();",
    });
    expect(runGuard(root)).toBe(1);
  });

  it("T-A-004: passes a post-cutoff migration that keys profiles on user_id", () => {
    const root = fixture({
      "supabase/migrations/20260810000000_good.sql":
        "UPDATE public.profiles SET foo = now() WHERE user_id = auth.uid();",
    });
    expect(runGuard(root)).toBe(0);
  });

  it("T-A-005: the real repo passes the guard (edge-fn fixes already landed)", () => {
    expect(runGuard(REPO)).toBe(0);
  });

  it("T-A-006: record_policy_ack fix migration keys the profiles UPDATE on user_id", () => {
    const mig =
      readdirSync(resolve(REPO, "supabase/migrations"))
        .filter((f) => /fix_record_policy_ack_profiles_userid\.sql$/.test(f))
        .map((f) => read(`supabase/migrations/${f}`))[0] ?? "";
    expect(mig).toBeTruthy();
    expect(mig).toMatch(/update public\.profiles[\s\S]*where user_id = auth\.uid\(\)/i);
    expect(mig).not.toMatch(/where id = auth\.uid\(\)/i);
  });

  it("T-A-007: the guard is wired into the CI lint-arch matrix", () => {
    expect(existsSync(GUARD)).toBe(true);
    expect(read(".github/workflows/ci.yml")).toContain("check-profiles-id-auth-uid.mjs");
  });
});
