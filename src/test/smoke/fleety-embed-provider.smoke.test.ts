import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/**
 * Regression guard for the Fleety embedding-provider unification (PRD D-01/D-04,
 * UC-23). This PR removed the third-party LOVABLE_API_KEY gateway fallback so a
 * single embedding model — Gemini text-embedding-004 — is used everywhere. If a
 * future change reintroduces a gateway fallback or a second model, KB rows would
 * be embedded into a different vector space and similarity search would silently
 * degrade. These assertions read the edge-function source directly (the function
 * is Deno-only and cannot be imported into vitest) and fail loudly on regression.
 */
describe("fleety-embed single embedding provider", () => {
  const embed = read("supabase/functions/fleety-embed/index.ts");

  it("FLEETY-EMBED-001: no LOVABLE_API_KEY gateway fallback remains", () => {
    expect(embed).not.toMatch(/LOVABLE_API_KEY/);
    // No OpenAI-compatible gateway embeddings endpoint.
    expect(embed).not.toMatch(/v1\/embeddings/);
  });

  it("FLEETY-EMBED-002: uses Gemini text-embedding-004 at 768 dimensions", () => {
    expect(embed).toMatch(/text-embedding-004/);
    expect(embed).toMatch(/EMBED_DIM\s*=\s*768/);
    expect(embed).toMatch(/GEMINI_API_KEY/);
  });

  it("FLEETY-EMBED-003: fails loudly when the embedding key is missing", () => {
    // Must throw rather than silently embedding in a different vector space.
    expect(embed).toMatch(/GEMINI_API_KEY is not configured/);
  });
});
