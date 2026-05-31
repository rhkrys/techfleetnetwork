/**
 * Phase 0 WCAG 2.2 A / AA / AAA accessibility audit.
 *
 * Iterates every route in `e2e/a11y/routes.ts`, runs axe-core against the
 * rendered DOM, and writes a structured JSON report to `a11y-report/`.
 *
 * Architecture notes (important — easy to regress):
 *
 *  - We do NOT use `test.describe.configure({ mode: "serial" })`. Serial
 *    mode means a single failed/skipped test aborts every subsequent
 *    test in the describe with "did not run", which leaves the report
 *    empty. Each route test must stand alone.
 *
 *  - Auth bootstrap happens once in `beforeAll`. We capture the resulting
 *    Supabase session from `localStorage` and replay it on every per-route
 *    page via `addInitScript`, so authed routes work without re-logging
 *    in and without depending on Playwright's `storageState` config.
 *
 *  - The report is written in `afterAll`, which runs even when individual
 *    route tests fail. The CI workflow also wipes `a11y-report/` before
 *    the run so a stale committed stub can never masquerade as fresh output.
 *
 * Credentials are read from env (TF_ADMIN_EMAIL / TF_ADMIN_PASSWORD).
 * If they aren't present the spec scans only public routes and reports
 * the rest as skipped — that way the workflow still produces a partial
 * baseline instead of failing outright.
 *
 * What axe catches: ~57% of WCAG violations (Deque published figure) —
 * the deterministic, machine-checkable subset (alt, contrast, labels,
 * ARIA, landmarks, headings, focus, duplicate ids, lang, …).
 * What axe misses: meaning of alt text, logical focus order, accuracy
 * of captions, helpfulness of error messages, etc. Those go into the
 * Phase 2 manual checklist.
 */
import { test, expect } from "../../playwright-fixture";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext } from "@playwright/test";
import { ROUTES, SCANNABLE_ROUTES, type RouteSpec } from "./routes";
import { WCAG_CHECKLIST, PRINCIPLES, type ChecklistItem } from "./wcag-checklist";
import { DOM_PROBES, type ProbeResult } from "./dom-probes";
import { STATIC_CHECKS, type StaticResult } from "./static-checks";

const REPORT_DIR = "a11y-report";

// Per-route DOM probe results: { route → { probeId → ProbeResult } }
const probeResults = new Map<string, Record<string, ProbeResult>>();
// Static checks run once for the whole audit.
const staticResults: Record<string, StaticResult> = {};

// Full WCAG 2.2 surface + best-practice rules. Per user Option C we
// include AAA, but axe-core's AAA coverage is intentionally narrow
// (color-contrast-enhanced, identical-links, etc.) — most AAA criteria
// are not machine-detectable and will appear in the Phase 2 checklist.
const AXE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag2aaa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
];

interface RouteFinding {
  route: RouteSpec;
  status: "scanned" | "skipped" | "error";
  message?: string;
  url?: string;
  violations?: Array<{
    id: string;
    impact: string | null | undefined;
    description: string;
    help: string;
    helpUrl: string;
    wcagTags: string[];
    nodes: Array<{ target: string[]; html: string; failureSummary?: string }>;
  }>;
}

const adminEmail = process.env.TF_ADMIN_EMAIL ?? "";
const adminPassword = process.env.TF_ADMIN_PASSWORD ?? "";
const haveAdminCreds = !!adminEmail && !!adminPassword;
// When set (CI), an empty/failed admin bootstrap MUST fail the suite instead
// of silently degrading to a public-only scan that produces a green "0/0" gate.
const requireAuthedScan = process.env.A11Y_REQUIRE_AUTHED_SCAN === "1";

// Captured once in beforeAll, replayed in every per-route page. Shape:
// the entire window.localStorage at end of login (Supabase session token,
// auth-related flags, theme, etc.).
let authedLocalStorage: Record<string, string> | null = null;
let authBootstrapError: string | null = null;
const findings: RouteFinding[] = [];

test.describe("WCAG 2.2 A/AA/AAA audit (axe-core)", () => {
  test.beforeAll(async ({ browser }) => {
    if (!haveAdminCreds) {
      authBootstrapError = "TF_ADMIN_EMAIL / TF_ADMIN_PASSWORD not provided.";
      if (requireAuthedScan) {
        throw new Error(
          "[a11y-audit] A11Y_REQUIRE_AUTHED_SCAN=1 but TF_ADMIN_EMAIL / TF_ADMIN_PASSWORD " +
            "are not set. Configure them as GitHub Actions repo secrets.",
        );
      }
      return;
    }

    let context: BrowserContext | null = null;
    try {
      context = await browser.newContext();
      const page = await context.newPage();

      await page.goto("/login");
      await page.waitForLoadState("networkidle").catch(() => {});

      // Seed a stable device id up front so any auth-adjacent logic that keys
      // off device identity behaves consistently across the bootstrap page and
      // every later route page that replays localStorage.
      await page.evaluate(() => {
        const key = "tfn.device_id.v1";
        if (!window.localStorage.getItem(key)) {
          window.localStorage.setItem(key, "playwright-a11y-audit-device");
        }
      });

      await page.getByLabel(/email/i).fill(adminEmail);

      const passwordInput = page
        .locator('input[id="password"], input[autocomplete="current-password"], input[type="password"]')
        .first();
      await expect(passwordInput).toBeVisible({ timeout: 15_000 });
      await passwordInput.fill(adminPassword);

      // Strict-mode-safe: the credentials form's submit button. Avoid the
      // permissive name regex — it also matches "Sign in with Google" and
      // the "Connect" provider button on the login page.
      const submitButton = page
        .locator('form button[type="submit"]')
        .filter({ hasText: /sign in|log in/i })
        .first();
      await expect(submitButton).toBeVisible({ timeout: 10_000 });
      await submitButton.click();

      // SPA-safe auth bootstrap: do not depend on router navigation here.
      // The admin passkey gate can intentionally keep the URL on /login while
      // still establishing a valid session in browser storage. For the audit,
      // the only signal we need is a real auth token landing in localStorage.
      await page.waitForFunction(
        () =>
          Object.keys(window.localStorage).some((key) => {
            if (!/auth-token/i.test(key)) return false;
            const value = window.localStorage.getItem(key) ?? "";
            return value.includes("access_token") || value.includes("refresh_token");
          }),
        undefined,
        { timeout: 30_000 },
      ).catch((err) => {
        throw new Error(
          `Auth token never appeared in localStorage after sign-in click: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

      // Give React auth state + route guards a beat to finish their first
      // render cycle before we freeze the storage snapshot.
      await page.waitForTimeout(750);

      // Snapshot localStorage for replay on subsequent contexts. Supabase
      // stores the session under a project-scoped `sb-*-auth-token` key,
      // so we just copy everything to keep the spec resilient to key churn.
      authedLocalStorage = await page.evaluate(() => {
        const out: Record<string, string> = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k) out[k] = window.localStorage.getItem(k) ?? "";
        }
        return out;
      });

      const hasAuthToken = Object.entries(authedLocalStorage).some(
        ([key, value]) => /auth-token/i.test(key) && /access_token|refresh_token/.test(value),
      );

      if (!hasAuthToken) {
        throw new Error(`Login finished without a stored auth token. Current URL: ${page.url()}`);
      }
    } catch (err) {
      authBootstrapError = err instanceof Error ? err.message : String(err);
      if (requireAuthedScan) {
        // Hard-fail the suite in CI so the empty-scan gate never gets a
        // chance to silently pass.
        throw new Error(`[a11y-audit] Admin bootstrap failed under A11Y_REQUIRE_AUTHED_SCAN=1: ${authBootstrapError}`);
      }
      // Local dev: still produce a partial public-only scan.
      console.warn(`Admin bootstrap failed; continuing with public-only audit. ${authBootstrapError}`);
    } finally {
      await context?.close().catch(() => {});
    }
  });

  for (const route of ROUTES) {
    test(`a11y: ${route.label} (${route.path})`, async ({ page }) => {
      // Skip routes that can't be scanned (need real DB ids, email tokens, etc.)
      if (route.skipReason) {
        findings.push({ route, status: "skipped", message: route.skipReason });
        test.skip(true, route.skipReason);
        return;
      }

      // Skip authed/admin routes if creds are missing or login bootstrap failed.
      if (!authedLocalStorage && route.kind !== "public") {
        findings.push({
          route,
          status: "skipped",
          message: !haveAdminCreds
            ? "No admin credentials available in this scan run."
            : `Admin bootstrap failed before authenticated scanning: ${authBootstrapError}`,
        });
        test.skip(true, !haveAdminCreds ? "Admin credentials not provided." : "Admin bootstrap failed.");
        return;
      }

      try {
        // Replay captured session into this page's localStorage BEFORE any
        // app code runs, so AuthContext sees a logged-in user on first render.
        if (authedLocalStorage) {
          const snapshot = authedLocalStorage;
          await page.addInitScript((entries: Record<string, string>) => {
            try {
              for (const [k, v] of Object.entries(entries)) {
                window.localStorage.setItem(k, v);
              }
            } catch {
              // Storage might be blocked on the about:blank origin pre-nav;
              // the next nav will land on the real origin and re-run init.
            }
          }, snapshot);
        }

        await page.goto(route.path);
        // App is a Vite SPA; wait for network to settle so async-loaded UI is
        // present in the DOM before axe walks it.
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
        // Small settle for any client-side route guards / data fetches.
        await page.waitForTimeout(500);

        const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

        findings.push({
          route,
          status: "scanned",
          url: page.url(),
          violations: result.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            description: v.description,
            help: v.help,
            helpUrl: v.helpUrl,
            wcagTags: v.tags.filter((t) => t.startsWith("wcag")),
            nodes: v.nodes.slice(0, 5).map((n) => ({
              target: n.target as string[],
              html: n.html.slice(0, 400),
              failureSummary: n.failureSummary,
            })),
          })),
        });

        // Run all DOM probes for this route. Probes are tiny and stateless
        // — running them inline avoids a second navigation.
        const probeOutputs: Record<string, ProbeResult> = {};
        for (const item of WCAG_CHECKLIST) {
          if (item.kind !== "dom" || !item.domProbe) continue;
          const probeFn = DOM_PROBES[item.domProbe];
          if (!probeFn) {
            probeOutputs[item.domProbe] = { status: "needs_review", details: `Probe "${item.domProbe}" not implemented.` };
            continue;
          }
          try {
            // Special handling: 1.4.10 Reflow → resize to 320px first.
            if (item.domProbe === "no-horizontal-scroll-at-320") {
              await page.setViewportSize({ width: 320, height: 800 });
              await page.waitForTimeout(150);
            }
            const out = await page.evaluate(`(${probeFn.toString()})()`) as ProbeResult;
            probeOutputs[item.domProbe] = out;
            if (item.domProbe === "no-horizontal-scroll-at-320") {
              await page.setViewportSize({ width: 1280, height: 800 });
            }
          } catch (e) {
            probeOutputs[item.domProbe] = { status: "needs_review", details: `Probe error: ${(e as Error).message}` };
          }
        }
        probeResults.set(route.path, probeOutputs);

        // We do NOT fail the test on violations during Phase 0 — the goal
        // is a complete baseline report. Phase 3 adds a CI gate that
        // fails on regressions vs this baseline.
      } catch (err) {
        findings.push({
          route,
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  test.afterAll(async () => {
    await mkdir(REPORT_DIR, { recursive: true });

    const totals = {
      routesTotal: ROUTES.length,
      scanned: findings.filter((f) => f.status === "scanned").length,
      skipped: findings.filter((f) => f.status === "skipped").length,
      errored: findings.filter((f) => f.status === "error").length,
      violationsTotal: findings.reduce((sum, f) => sum + (f.violations?.length ?? 0), 0),
      byImpact: { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 } as Record<string, number>,
      byCriterion: {} as Record<string, number>,
      byRule: {} as Record<string, number>,
    };

    for (const f of findings) {
      for (const v of f.violations ?? []) {
        const key = (v.impact ?? "unknown") as keyof typeof totals.byImpact;
        totals.byImpact[key] = (totals.byImpact[key] ?? 0) + 1;
        totals.byRule[v.id] = (totals.byRule[v.id] ?? 0) + 1;
        for (const tag of v.wcagTags) {
          totals.byCriterion[tag] = (totals.byCriterion[tag] ?? 0) + 1;
        }
      }
    }

    // ── Run static repo-wide checks ─────────────────────────────────
    for (const item of WCAG_CHECKLIST) {
      if (item.kind !== "static" || !item.staticCheck) continue;
      const fn = STATIC_CHECKS[item.staticCheck];
      if (!fn) {
        staticResults[item.staticCheck] = { status: "needs_review", details: `Static check "${item.staticCheck}" not implemented.` };
        continue;
      }
      try {
        staticResults[item.staticCheck] = await fn();
      } catch (e) {
        staticResults[item.staticCheck] = { status: "needs_review", details: `Static check error: ${(e as Error).message}` };
      }
    }

    // ── Build per-criterion checklist roll-up ───────────────────────
    // For every WCAG SC: roll up axe / probe / static results into a
    // single status. The audit NEVER silently skips a criterion — every
    // entry resolves to pass / fail / needs_review with evidence.
    type CriterionStatus = "pass" | "fail" | "needs_review";
    interface CriterionResult {
      sc: string;
      level: "A" | "AA";
      principle: string;
      title: string;
      kind: ChecklistItem["kind"];
      status: CriterionStatus;
      summary: string;
      evidence?: unknown;
    }

    const checklist: CriterionResult[] = WCAG_CHECKLIST.map((item) => {
      const principle = PRINCIPLES[item.sc.split(".")[0]] ?? "Other";
      let status: CriterionStatus = "pass";
      let summary = "";
      let evidence: unknown;

      if (item.kind === "axe") {
        const ruleSet = new Set(item.axeRules ?? []);
        const hits: Array<{ route: string; rule: string; nodes: number }> = [];
        for (const f of findings) {
          for (const v of f.violations ?? []) {
            if (ruleSet.has(v.id)) hits.push({ route: f.route.path, rule: v.id, nodes: v.nodes.length });
          }
        }
        if (hits.length === 0) {
          status = "pass";
          summary = `axe rules ${[...ruleSet].join(", ")} reported no violations across ${totals.scanned} scanned route(s).`;
        } else {
          status = "fail";
          summary = `${hits.length} violation(s) of ${[...ruleSet].join("/")} across ${new Set(hits.map((h) => h.route)).size} route(s).`;
          evidence = hits.slice(0, 20);
        }
      } else if (item.kind === "dom" && item.domProbe) {
        const allOutputs: Array<{ route: string; result: ProbeResult }> = [];
        for (const [routePath, probes] of probeResults.entries()) {
          if (probes[item.domProbe]) allOutputs.push({ route: routePath, result: probes[item.domProbe] });
        }
        const fails = allOutputs.filter((o) => o.result.status === "fail");
        const reviews = allOutputs.filter((o) => o.result.status === "needs_review");
        const passes = allOutputs.filter((o) => o.result.status === "pass");
        // A probe is allowed to "pass on 0 routes" only when its target
        // surface (e.g. <video>, role=tooltip) genuinely doesn't exist on any
        // scanned route. We mark those as `needs_review` with a clear note so
        // the report never claims passing coverage we don't have.
        if (fails.length) {
          status = "fail";
          summary = `Probe "${item.domProbe}" failed on ${fails.length} route(s).`;
          evidence = fails.slice(0, 10);
        } else if (reviews.length) {
          status = "needs_review";
          summary = `Probe "${item.domProbe}" flagged ${reviews.length} route(s) for human review.`;
          evidence = reviews.slice(0, 10);
        } else if (passes.length === 0) {
          status = "needs_review";
          summary = `Probe "${item.domProbe}" had no candidate elements on any scanned route — wire a fixture page or mark this surface n/a explicitly.`;
        } else {
          status = "pass";
          summary = `Probe "${item.domProbe}" passed on ${passes.length} route(s).`;
        }
      } else if (item.kind === "static" && item.staticCheck) {
        const r = staticResults[item.staticCheck];
        if (!r) {
          status = "needs_review";
          summary = `Static check "${item.staticCheck}" produced no result.`;
        } else {
          status = r.status;
          summary = r.details ?? `Static check "${item.staticCheck}" → ${r.status}.`;
          evidence = r.evidence;
        }
      } else if (item.kind === "manual") {
        status = "needs_review";
        summary = item.manualReason ?? "Requires human review — not machine-decidable.";
      }

      return { sc: item.sc, level: item.level, principle, title: item.title, kind: item.kind, status, summary, evidence };
    });

    const checklistTotals = {
      total: checklist.length,
      pass: checklist.filter((c) => c.status === "pass").length,
      fail: checklist.filter((c) => c.status === "fail").length,
      needs_review: checklist.filter((c) => c.status === "needs_review").length,
    };

    const report = {
      generatedAt: new Date().toISOString(),
      authedScan: !!authedLocalStorage,
      coverageNote: !haveAdminCreds
        ? "Public-only scan — admin credentials not provided in this run."
        : authBootstrapError
          ? `Public-only scan — admin bootstrap failed before authenticated routes were scanned: ${authBootstrapError}`
          : "Authenticated scan as admin user (TF_ADMIN_EMAIL).",
      axeTags: AXE_TAGS,
      totals,
      scannableRouteCount: SCANNABLE_ROUTES.length,
      checklist: {
        totals: checklistTotals,
        criteria: checklist,
      },
      staticChecks: staticResults,
      results: findings,
    };

    await writeFile(join(REPORT_DIR, "a11y-report.json"), JSON.stringify(report, null, 2), "utf8");

    // Console summary so the report is readable in CI logs without
    // downloading the artifact.
    /* eslint-disable no-console */
    console.log("\n────────── WCAG 2.2 audit summary ──────────");
    console.log(`Routes total:      ${totals.routesTotal}`);
    console.log(`  scanned:         ${totals.scanned}`);
    console.log(`  skipped:         ${totals.skipped}`);
    console.log(`  errored:         ${totals.errored}`);
    console.log(`Violations total:  ${totals.violationsTotal}`);
    console.log(`By impact:         ${JSON.stringify(totals.byImpact)}`);
    console.log(`\n────────── WCAG checklist coverage (${checklist.length} criteria) ──────────`);
    console.log(`  pass:            ${checklistTotals.pass}`);
    console.log(`  fail:            ${checklistTotals.fail}`);
    console.log(`  needs_review:    ${checklistTotals.needs_review}`);
    const fails = checklist.filter((c) => c.status === "fail");
    if (fails.length) {
      console.log(`Failing criteria:`);
      fails.forEach((c) => console.log(`  ${c.sc} (${c.level}) — ${c.title}: ${c.summary}`));
    }
    console.log(`Top axe rules:`);
    Object.entries(totals.byRule)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([rule, count]) => console.log(`  ${count.toString().padStart(4)}  ${rule}`));
    console.log("─────────────────────────────────────────────\n");
    /* eslint-enable no-console */
  });
});

