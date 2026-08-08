import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/**
 * Guards the "permanent, growing" Fleety response cache (FLEETY-011/012).
 *
 * The cache is what keeps AI cost bounded — a hit serves stored markdown for ~$0
 * and never calls Groq. Two regressions would quietly break it:
 *   1. Re-introducing a time-based TTL (`last_used_at >= now() - interval '…'`)
 *      in a lookup would make the cache stop growing / expire entries.
 *   2. A dimension mismatch (cache column not vector(768)) silently fails every
 *      semantic store/lookup — exactly the latent 1536-vs-768 bug this migration
 *      fixed. Retrieval and the cache both embed at 768 (gemini-embedding-001).
 *
 * These assert the migration source directly (SQL isn't executed in vitest), and
 * fail loudly if either property regresses. Staleness safety is unchanged and
 * intentional: lookups still scope by kb_version, and thumbs-down still purges.
 */
describe("fleety response cache — permanent + 768-dim", () => {
  const mig = read("supabase/migrations/20260807130000_fleety_cache_permanent.sql");

  it("FLEETY-012: cache embedding is re-spaced to 768 across column + functions + index", () => {
    // Column altered to 768.
    expect(mig).toMatch(/ALTER COLUMN query_embedding TYPE extensions\.vector\(768\)/);
    // Both embedding-typed function params are 768, not the old 1536.
    expect(mig).toMatch(/_query_embedding extensions\.vector\(768\)/);
    expect(mig).not.toMatch(/extensions\.vector\(1536\)/);
    // ANN index rebuilt (HNSW) for the 768 column.
    expect(mig).toMatch(/USING hnsw \(query_embedding extensions\.vector_cosine_ops\)/);
  });

  it("FLEETY-011: the 7-day (any time-based) freshness filter is gone from lookups", () => {
    // No time-window predicate on last_used_at anywhere in the new functions.
    expect(mig).not.toMatch(/last_used_at\s*>=\s*now\(\)\s*-\s*interval/);
  });

  it("FLEETY-011: permanence guardrails are retained (kb_version scoping)", () => {
    // Permanent storage stays SAFE because lookups still require the current
    // kb_version — superseded answers go dormant instead of being served.
    expect(mig).toMatch(/c\.kb_version\s*=\s*current_v/);
  });

  it("does not weaken access control (service-role only, DEFINER, pinned path)", () => {
    expect(mig).toMatch(/SECURITY DEFINER/);
    expect(mig).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fleety_cache_semantic_lookup[\s\S]*TO service_role/
    );
    // No accidental grant to anon/authenticated on the cache functions.
    expect(mig).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fleety_cache_[a-z_]+\([^)]*\) TO (anon|authenticated)/
    );
  });
});
