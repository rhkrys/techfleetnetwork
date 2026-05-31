/**
 * Regression gate: every active known_issue_catalog row MUST have at least
 * one bdd_scenarios row whose notes column references `incident:<id>`. This
 * is the bdd-gate guardrail — if a future "permanent fix" lands a catalog
 * entry without a regression scenario, this test fails immediately.
 *
 * Skips gracefully when the Supabase env vars are not set (local laptop dev).
 */
import { describe, it, expect } from "vitest";

const URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

const enabled = !!(URL && KEY);

(enabled ? describe : describe.skip)("incident: known-issue-catalog-coverage gate", () => {
  it("every active catalog entry has a regression BDD scenario", async () => {
    const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

    const [catalogRes, scenariosRes] = await Promise.all([
      fetch(`${URL}/rest/v1/known_issue_catalog?select=id,pattern,reason&is_active=eq.true`, { headers }),
      fetch(`${URL}/rest/v1/bdd_scenarios?select=scenario_id,notes&notes=ilike.*incident:*`, { headers }),
    ]);

    expect(catalogRes.ok).toBe(true);
    expect(scenariosRes.ok).toBe(true);

    const catalog = (await catalogRes.json()) as Array<{ id: string; pattern: string; reason: string }>;
    const scenarios = (await scenariosRes.json()) as Array<{ scenario_id: string; notes: string }>;

    const coveredIds = new Set(
      scenarios.flatMap((s) => {
        const matches = s.notes?.match(/incident:([0-9a-f-]{36}|[A-Z0-9-]+)/gi) ?? [];
        return matches.map((m) => m.replace(/^incident:/i, ""));
      }),
    );

    const uncovered = catalog.filter((c) => !coveredIds.has(c.id) && !coveredIds.has("ALL"));

    if (uncovered.length > 0) {
      // Emit a digestible failure so the dev sees exactly what to write.
      const lines = uncovered.map((c) => `  - ${c.id}  pattern="${c.pattern.slice(0, 60)}"`).join("\n");
      throw new Error(
        `bdd-gate: ${uncovered.length} known_issue_catalog entry(ies) without a regression BDD scenario.\n` +
          `Add a row to bdd_scenarios with notes containing "incident:<id>" (or "incident:ALL" for a sweep).\n${lines}`,
      );
    }
    expect(uncovered.length).toBe(0);
  }, 20_000);
});
