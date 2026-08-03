// Regression: admin_list_users() must not nest a set-returning function inside
// array_agg() — that is illegal SQL (SQLSTATE 0A000) and returned HTTP 400 on
// every call, blanking the User Admin roster. Backs BDD ADMIN-LIST-SRF-001.
//
// Hermetic file-content check (repo convention). The buggy original migration is
// left as immutable history; a later CREATE OR REPLACE supersedes it, so this
// asserts the LATEST (effective) definition is correct.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const migDir = resolve(process.cwd(), "supabase/migrations");
const defining = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) =>
    /create or replace function public\.admin_list_users\b/i.test(
      readFileSync(resolve(migDir, f), "utf8"),
    ),
  )
  .sort(); // timestamp-prefixed → lexicographic == chronological
const effective =
  defining.length > 0 ? readFileSync(resolve(migDir, defining[defining.length - 1]), "utf8") : "";

describe("admin_list_users SRF fix (ADMIN-LIST-SRF-001)", () => {
  it("has an effective definition", () => {
    expect(defining.length).toBeGreaterThan(0);
  });

  it("does NOT nest a set-returning function inside array_agg (illegal SQL / 400)", () => {
    expect(effective).not.toMatch(/array_agg\s*\(\s*distinct\s+jsonb_array_elements_text/i);
  });

  it("expands providers via a FROM clause instead", () => {
    expect(effective).toMatch(/from\s+jsonb_array_elements_text\([\s\S]*?\)\s+as\s+prov/i);
  });
});
