import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/**
 * Regression guard for the retrieval single-point-of-failure fix (2.2-D / UC-22).
 *
 * Fleety's KB retrieval used to run ONLY when a per-query embedding succeeded. When the free-tier
 * embedding quota tripped (429) or the provider was down, `embedQuery` returned null, semantic
 * search was skipped, and there was NO fallback — so Fleety went blind to the ENTIRE corpus at once
 * (skills, practices, careers) until the quota reset. This guard fails if the lexical fallback
 * (which needs no embedding) is dropped, or if the RPC loses its least-privilege lockdown.
 */
describe("Fleety KB lexical fallback (2.2-D)", () => {
  const chat = read("supabase/functions/techfleet-chat/index.ts");
  const migration = read("supabase/migrations/20260818140000_fleety_kb_lexical_fallback.sql");

  it("techfleet-chat falls back to lexical search when semantic finds nothing", () => {
    expect(chat).toMatch(/fleety_kb_lexical_search/);
    // fallback fires when there are zero semantic hits (covers the embedding-down case)
    expect(chat).toMatch(/kbHits\.length === 0/);
    expect(chat).toMatch(/kbRetrievalMode/);
  });

  it("surfaces retrieval degradation for observability (never silent)", () => {
    expect(chat).toMatch(/embeddingDegraded/);
    expect(chat).toMatch(/X-Fleety-Retrieval/);
  });

  it("the lexical RPC exists, needs no embedding, and is service-role-only", () => {
    expect(migration).toMatch(/create or replace function public\.fleety_kb_lexical_search/i);
    expect(migration).toMatch(/to_tsvector/i); // full-text, not vector
    expect(migration).not.toMatch(/vector\(768\)/); // must NOT require an embedding
    // least-privilege: revoked from anon/authenticated/PUBLIC, granted only to service_role
    expect(migration).toMatch(/revoke execute on function public\.fleety_kb_lexical_search/i);
    expect(migration).toMatch(
      /grant\s+execute on function public\.fleety_kb_lexical_search[\s\S]*service_role/i
    );
  });
});
