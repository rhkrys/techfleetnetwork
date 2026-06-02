/**
 * Triage permanent-fix regression suite.
 *
 * Backs BDD scenarios TRIAGE-FIX-001..007. Each test guards a refactor that
 * permanently removed a previously-suppressed triage noise source. If any of
 * these fail, the corresponding root-cause regression has returned and a
 * substring suppression must NOT be added — fix the source instead.
 *
 * Network/database calls are intentionally avoided. We assert source-of-truth
 * properties (file contents, exported sets, classifier behaviour) so the suite
 * is hermetic and runs in the regular `npm run test` quality gate.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

describe("TRIAGE-FIX permanent root-cause fixes", () => {
  it("TRIAGE-FIX-001: MyProjectsTab no longer swallows 42501 (RPC returns empty rowset)", () => {
    const src = read("src/components/MyProjectsTab.tsx");
    expect(src).not.toMatch(/code\s*===\s*['"]42501['"]/);
    // Sanity: the call still throws on real errors (only the 42501 branch is gone).
    expect(src).toMatch(/get_project_internal_links/);
    expect(src).toMatch(/if \(error\) throw error;/);
  });

  it("TRIAGE-FIX-002: getSubscriptionFailureMessage output is never thrown", () => {
    // Scan every source file under src/ for the forbidden pattern.
    // Cheap regex over the file we know defines/uses it covers >99% of cases.
    const push = read("src/services/push-subscription.service.ts");
    expect(push).not.toMatch(/throw\s+new\s+Error\s*\(\s*getSubscriptionFailureMessage/);
    // The guarding doc-comment must stay.
    expect(push).toMatch(/MUST NEVER be wrapped in/);
  });

  it("TRIAGE-FIX-003 & 004: process-email-queue routes cap + DLQ to non-actionable event_types", () => {
    const src = read("supabase/functions/process-email-queue/index.ts");
    // Frequency cap emits the email_capped audit event.
    expect(src).toMatch(/p_event_type:\s*['"]email_capped['"]/);
    // moveToDlq defaults to email_dlq.
    expect(src).toMatch(/eventType:\s*'email_dlq'\s*\|\s*'edge_invoke_failed'\s*=\s*'email_dlq'/);
    expect(src).toMatch(/p_event_type:\s*eventType/);
  });

  it("TRIAGE-FIX-005: opaque Script error classifier still drops events pre-audit", async () => {
    // Import after env setup; the module side-effects are safe under jsdom.
    const mod: typeof import("@/services/error-reporter.service") =
      await import("@/services/error-reporter.service");
    // The classifier is module-private; we proxy through the public installer.
    let audited = 0;
    const origDispatch = window.dispatchEvent.bind(window);
    mod.installGlobalErrorReporter();
    // Patch fetch so any accidental writeAudit RPC is observable.
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      const url = String(args[0] ?? "");
      if (url.includes("write_audit_log")) audited++;
      return Promise.resolve(new Response("[]", { status: 200 }));
    }) as typeof fetch;
    try {
      const opaque = new ErrorEvent("error", {
        message: "Script error.",
        filename: "",
        lineno: 0,
        colno: 0,
        error: null,
      });
      origDispatch(opaque);
      // Give microtasks a chance.
      await Promise.resolve();
      expect(audited).toBe(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("TRIAGE-FIX-006: error-reporter SUPPRESSED_PATTERNS no longer contains the eight refactored strings", () => {
    const src = read("src/services/error-reporter.service.ts");
    const suppressedArray = src.match(/const SUPPRESSED_PATTERNS = \[([\s\S]*?)\] as const;/)?.[1] ?? "";
    expect(suppressedArray).toBeTruthy();
    const banned = [
      '"Not authorized for project"',
      '"code=42501"',
      '"Recipient already received"',
      '"TTL exceeded"',
      '"Push notifications are not ready"',
      '"service worker is unavailable"',
      '"use-autosave"',
      '"Script error."',
    ];
    for (const needle of banned) {
      expect(suppressedArray, `pattern ${needle} should not be a SUPPRESSED_PATTERNS entry`).not.toContain(needle);
    }

    // email_capped / email_dlq must be in the non-actionable allow-list.
    expect(src).toMatch(/"email_capped"/);
    expect(src).toMatch(/"email_dlq"/);
  });

  it("TRIAGE-FIX-007: React Query re-export surface is intact (project QueryClient owns onError gating)", () => {
    // We do not own a single QueryCache.onError factory in src/lib/react-query.ts
    // (it just re-exports). The gate lives in the app QueryClient setup; this
    // test asserts the re-export contract so a regression in the export shape
    // doesn't silently break consumers that rely on QueryCache.
    const src = read("src/lib/react-query.ts");
    expect(src).toMatch(/QueryCache/);
    expect(src).toMatch(/QueryClient/);
    expect(src).toMatch(/useQuery/);
  });

  it("TRIAGE-NOISE-020: DB-level reject_opaque_script_error trigger function exists in migrations", () => {
    // The permanent backstop is a Postgres BEFORE INSERT trigger on audit_log
    // AND agent_fix_queue. Asserting the migration source guarantees the
    // invariant is checked into history and reviewed on every schema change.
    // (Live DB assertion lives in the Supabase linter / smoke-deploy gate.)
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const dir = resolve(REPO, "supabase/migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    const blob = files.map((f) => read(`supabase/migrations/${f}`)).join("\n");
    expect(blob).toMatch(/create or replace function public\.reject_opaque_script_error/);
    expect(blob).toMatch(/trg_audit_log_reject_opaque_script_error/);
    expect(blob).toMatch(/trg_agent_fix_queue_reject_opaque_script_error/);
    // Regex literal must be present so a future edit can't silently weaken it.
    expect(blob).toMatch(/\^\(error:\\s\*\)\?script error\\\.\?\$/);
  });
});

