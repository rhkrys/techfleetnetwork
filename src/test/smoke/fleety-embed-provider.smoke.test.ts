import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/**
 * Regression guard for the Fleety embedding provider. A single embedding model —
 * Gemini gemini-embedding-001 (@768) — must be used everywhere, defined once in
 * _shared/gemini-embed.ts and shared by the query (techfleet-chat) and ingest
 * (fleety-embed) paths. If a change reintroduces a gateway fallback, a second
 * model, or the RETIRED text-embedding-004 as the active model, KB rows and
 * queries would land in different vector spaces and retrieval would silently
 * break (exactly what happened when Google retired text-embedding-004 → HTTP
 * 404). These assertions read the source directly (Deno-only, can't be imported
 * into vitest) and fail loudly on regression.
 */
describe("fleety-embed single embedding provider", () => {
  const embed = read("supabase/functions/fleety-embed/index.ts");
  const shared = read("supabase/functions/_shared/gemini-embed.ts");

  it("FLEETY-EMBED-001: no LOVABLE_API_KEY gateway fallback remains", () => {
    expect(embed).not.toMatch(/LOVABLE_API_KEY/);
    // No OpenAI-compatible gateway embeddings endpoint.
    expect(embed).not.toMatch(/v1\/embeddings/);
  });

  it("FLEETY-EMBED-002: uses the shared gemini-embedding-001 @768 contract", () => {
    // fleety-embed defers to the single source of truth and embeds documents.
    expect(embed).toMatch(/_shared\/gemini-embed\.ts/);
    expect(embed).toMatch(/RETRIEVAL_DOCUMENT/);
    expect(embed).toMatch(/GEMINI_API_KEY/);
    // The shared contract pins the CURRENT model + 768 dims...
    expect(shared).toMatch(/gemini-embedding-001/);
    expect(shared).toMatch(/GEMINI_EMBED_DIM\s*=\s*768/);
    // ...and never uses the retired model as the active model (a comment noting
    // its retirement is fine; `models/text-embedding-004` as a call is not).
    // Guard the ACTIVE-model URL form only — the header comment legitimately
    // documents that text-embedding-004 was retired.
    expect(embed).not.toMatch(/models\/text-embedding-004/);
    expect(shared).not.toMatch(/models\/text-embedding-004/);
  });

  it("FLEETY-EMBED-003: fails loudly when the embedding key is missing", () => {
    // Must throw rather than silently embedding in a different vector space.
    expect(embed).toMatch(/GEMINI_API_KEY is not configured/);
  });
});
