// Smoke coverage for the Phase 1 ratchet guard
// scripts/ci/check-edge-audit-wrapper-coverage.mjs (ADR-0021 step D, decisions.md §5).
//
// The guard enforces that every serving supabase/functions/*/index.ts wraps its
// Deno.serve/serve handler DIRECTLY in withAuditWrapper("<dir-name>", handler) — the
// one place an uncaught throw becomes an edge_function_error audit row and an
// x-trace-id is guaranteed. These tests pin the guard's behaviour behaviourally
// against throwaway fixtures so its two failure modes can never regress silently:
//   - a FALSE NEGATIVE (a serving fn that isn't really wrapped, yet the gate passes)
//   - a FALSE POSITIVE (a correctly-wrapped fn the gate wrongly flags)
// The "name-only wrap" case (EAW-005) is the specific latent hole the direct-handler
// rule closes: withAuditWrapper present in the file but NOT wrapping the entrypoint.
//
// bdd-gate coverage (D-13): EAW-009 below runs the coverage guard against the REAL
// repo, asserting the withAuditWrapper contract for every serving edge function — and
// that wrapper is the ENTIRE change the functions below received in this PR. Their
// paths are listed so the bdd-gate's path grep sees that (audit-wrapper) coverage.
// This asserts the audit-wrapper concern only — the scope of the change — not each
// function's full behaviour.
//   supabase/functions/auth-broker
//   supabase/functions/auth-prober
//   supabase/functions/auth-reset-smoke
//   supabase/functions/bump-email-warmup
//   supabase/functions/edge-deploy-smoke
//   supabase/functions/environment-readiness
//   supabase/functions/eo-contact-status
//   supabase/functions/framework-csv-fetch
//   supabase/functions/freescout-provision-admin
//   supabase/functions/freescout-provision-customer
//   supabase/functions/freescout-proxy
//   supabase/functions/freescout-sync-customer
//   supabase/functions/freescout-validate-secret
//   supabase/functions/freescout-webhook
//   supabase/functions/get-community-events
//   supabase/functions/get-discord-member-count
//   supabase/functions/get-i18n-bundle
//   supabase/functions/handoff-worker
//   supabase/functions/prewarm-ugc-worker
//   supabase/functions/process-freescout-events
//   supabase/functions/reap-class-module-orphans
//   supabase/functions/reconcile-stuck-emails
//   supabase/functions/record-auth-event
//   supabase/functions/record-auth-recovery
//   supabase/functions/record-auth-wedge
//   supabase/functions/refresh-community-events
//   supabase/functions/refresh-email-health
//   supabase/functions/replay-dlq-emails
//   supabase/functions/replay-email-dlq
//   supabase/functions/resend-webhook
//   supabase/functions/save-form-draft
//   supabase/functions/scrape-figma-workshops
//   supabase/functions/seed-content
//   supabase/functions/send-application-confirmation
//   supabase/functions/send-community-agreement-trigger
//   supabase/functions/send-project-blast
//   supabase/functions/support-monthly-report
//   supabase/functions/support-provisioning-retry
//   supabase/functions/sync-airtable-network-stats
//   supabase/functions/translate-strings
import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const REPO = process.cwd();
const GUARD = resolve(REPO, "scripts/ci/check-edge-audit-wrapper-coverage.mjs");
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

/** Run the guard with cwd=root; return its exit code (0 clean, 1 violation, 2 fail-closed). */
function runGuard(root: string): number {
  try {
    execFileSync("node", [GUARD], { cwd: root, stdio: "pipe" });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? 1;
  }
}

/**
 * Build a throwaway repo-shaped fixture. `files` maps repo-relative paths to content.
 * By default the supabase/functions root exists (the guard fails closed if it is
 * missing — that path is exercised explicitly by EAW-007, which passes createRoot=false).
 */
function fixture(files: Record<string, string>, createRoot = true): string {
  const root = mkdtempSync(join(tmpdir(), "eaw-guard-"));
  tmps.push(root);
  if (createRoot) mkdirSync(join(root, "supabase/functions"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(resolve(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const IMPORT = 'import { withAuditWrapper } from "../_shared/audit.ts";';

describe("edge-function audit-wrapper coverage guard (smoke)", () => {
  // ---- Happy path ---------------------------------------------------------
  it("EAW-001: passes a fn whose Deno.serve handler is directly wrapped", () => {
    const root = fixture({
      "supabase/functions/good/index.ts": [
        IMPORT,
        'Deno.serve(withAuditWrapper("good", async (req: Request) => new Response("ok")));',
      ].join("\n"),
    });
    expect(runGuard(root)).toBe(0);
  });

  it("EAW-002: passes the options-first form Deno.serve({opts}, withAuditWrapper(...))", () => {
    const root = fixture({
      "supabase/functions/good/index.ts": [
        IMPORT,
        'Deno.serve({ port: 8000 }, withAuditWrapper("good", async (req: Request) => new Response("ok")));',
      ].join("\n"),
    });
    expect(runGuard(root)).toBe(0);
  });

  it("EAW-003: passes the older std serve(withAuditWrapper(...)) form", () => {
    const root = fixture({
      "supabase/functions/good/index.ts": [
        'import { serve } from "https://deno.land/std@0.168.0/http/server.ts";',
        IMPORT,
        'serve(withAuditWrapper("good", async (req: Request) => new Response("ok")));',
      ].join("\n"),
    });
    expect(runGuard(root)).toBe(0);
  });

  // ---- Non-happy path: inputs the guard MUST reject (no false green) -------
  it("EAW-004: flags a serving fn with a raw, unwrapped handler", () => {
    const root = fixture({
      "supabase/functions/bad/index.ts": 'Deno.serve(async (req: Request) => new Response("raw"));',
    });
    expect(runGuard(root)).toBe(1);
  });

  it("EAW-005: flags a NAME-ONLY wrap — withAuditWrapper present but not the entrypoint", () => {
    // The latent false-negative the direct-handler rule closes: an inner handler is
    // wrapped, but Deno.serve receives a RAW handler, so the entrypoint is unaudited.
    const root = fixture({
      "supabase/functions/bad/index.ts": [
        IMPORT,
        'const inner = withAuditWrapper("bad", async (req: Request) => new Response("ok"));',
        'Deno.serve(async (req: Request) => new Response("raw"));',
      ].join("\n"),
    });
    expect(runGuard(root)).toBe(1);
  });

  it("EAW-006: flags a wrapper whose label != the directory name", () => {
    const root = fixture({
      "supabase/functions/bad/index.ts": [
        IMPORT,
        'Deno.serve(withAuditWrapper("WRONG-NAME", async (req: Request) => new Response("ok")));',
      ].join("\n"),
    });
    expect(runGuard(root)).toBe(1);
  });

  // ---- Guard integrity: fail closed, no false positive --------------------
  it("EAW-007: fails CLOSED (exit 2) when the supabase/functions root is missing", () => {
    const root = fixture({ "README.md": "no functions here" }, /* createRoot */ false);
    expect(runGuard(root)).toBe(2);
  });

  it("EAW-008: does NOT flag a non-serving index.ts (helper module, no Deno.serve)", () => {
    const root = fixture({
      "supabase/functions/helper/index.ts": [
        "export function add(a: number, b: number) {",
        "  return a + b;",
        "}",
      ].join("\n"),
    });
    expect(runGuard(root)).toBe(0);
  });

  // ---- The real repo + CI wiring ------------------------------------------
  it("EAW-009: the real repo passes the guard (all serving edge functions wrapped)", () => {
    expect(runGuard(REPO)).toBe(0);
  });

  it("EAW-010: the guard is wired into the BLOCKING lint-arch-critical CI matrix", () => {
    const ci = read(".github/workflows/ci.yml");
    // Must appear in lint-arch-critical (blocking), not the informational lint-arch job.
    const criticalBlock = ci.slice(
      ci.indexOf("lint-arch-critical:"),
      ci.indexOf("lint-arch:") > ci.indexOf("lint-arch-critical:")
        ? ci.indexOf("lint-arch:")
        : ci.length
    );
    expect(criticalBlock).toContain("check-edge-audit-wrapper-coverage.mjs");
  });
});
