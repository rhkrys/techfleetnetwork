import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/**
 * Guards FLEETY-014: the L2 exact-match response cache. A verbatim repeat of a
 * prior question must be served with zero LLM (OpenRouter/DeepSeek) call AND without depending on the
 * embedding (so it still hits during an embedding-provider outage). It runs in
 * parallel with embed+router (no added latency) and returns early on a hit.
 * Reads the edge source directly (Deno-only fn).
 */
describe("fleety L2 exact-match cache", () => {
  const chat = read("supabase/functions/techfleet-chat/index.ts");

  it("FLEETY-014: exact lookup uses the same normalized hash as the store", () => {
    // Store hash (isCacheable path) and L2 lookup hash must match exactly, or a
    // repeat would never hit. Both are sha256(audience|trim().toLowerCase()).
    const hashUses = chat.match(
      /sha256Hex\(`\$\{audience\}\|\$\{lastUserMessage\.trim\(\)\.toLowerCase\(\)\}`\)/g
    );
    expect(hashUses, "expected the normalized hash in both store + L2 lookup").toBeTruthy();
    expect(hashUses!.length).toBeGreaterThanOrEqual(2);
  });

  it("FLEETY-014: L2 lookup runs in parallel with embed + router (no added latency)", () => {
    // fleety_cache_lookup is destructured alongside embedQuery + routeWithModel.
    expect(chat).toMatch(
      /const \[queryEmbedding, routerDecision, exactHit\] = await Promise\.all\(\[/
    );
    expect(chat).toMatch(/fleety_cache_lookup", \{ _query_hash: exactHash, _audience: audience \}/);
  });

  it("FLEETY-014: an exact hit returns early with a distinct cache header, before generation", () => {
    expect(chat).toMatch(/if \(exactHit\)/);
    expect(chat).toMatch(/"X-Fleety-Cache":\s*"hit-exact"/);
    // Served via the shared cache SSE replay (same UX as L3).
    expect(chat).toMatch(/return new Response\(buildCacheSSEStream\(exactHit\.response_md\)/);
  });

  it("FLEETY-014: does not double-count hits (lookup RPC already increments)", () => {
    // Slice the exact-hit block only (up to the L3 semantic-cache marker) and
    // assert it records COST but does NOT also call record_hit — the
    // fleety_cache_lookup RPC already did SET hits = hits + 1.
    const start = chat.indexOf("if (exactHit)");
    const end = chat.indexOf("L3: Semantic response cache", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = chat.slice(start, end);
    expect(block).toMatch(/fleety_record_cost/);
    expect(block).not.toMatch(/fleety_cache_record_hit/);
  });
});
