import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Issue E (2026-06-02 audit) — `email_domain_health.window_days` 42703 drift
 * guard. The EmailDeliverabilityCard selects a set of columns from the view;
 * if a migration drops or renames any of them the deliverability tab silently
 * 500s on production. This smoke parses the literal column list from the
 * client query and asserts the SQL view declares every one.
 */
// email_domain_health is a TABLE whose columns are declared across a CREATE
// TABLE plus several ALTER TABLE ... ADD COLUMN migrations, so aggregate every
// migration that references it and assert the card's columns appear somewhere
// in that combined DDL. (Still catches a genuinely-dropped/renamed column.)
function collectMigrationSqlReferencing(entity: string): string {
  const dir = "supabase/migrations";
  const files = readdirSync(dir).sort();
  let combined = "";
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    if (sql.toLowerCase().includes(entity.toLowerCase())) combined += "\n" + sql;
  }
  if (!combined) throw new Error(`No migration references ${entity}`);
  return combined;
}

describe("email_domain_health view shape", () => {
  it("declares every column EmailDeliverabilityCard selects", () => {
    const client = readFileSync("src/components/system-health/EmailDeliverabilityCard.tsx", "utf8");
    const selectMatch = client.match(
      /from\(\s*"email_domain_health"[\s\S]*?\.select\(\s*"([^"]+)"/
    );
    expect(selectMatch, "client select() literal not found").toBeTruthy();
    const cols = selectMatch![1]
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    expect(cols.length).toBeGreaterThan(0);

    const viewSql = collectMigrationSqlReferencing("email_domain_health");
    for (const col of cols) {
      expect(
        viewSql.toLowerCase().includes(col.toLowerCase()),
        `email_domain_health view is missing column "${col}" referenced by EmailDeliverabilityCard`
      ).toBe(true);
    }
  });
});
