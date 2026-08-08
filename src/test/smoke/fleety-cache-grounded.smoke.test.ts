import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/**
 * Guards FLEETY-013: only GROUNDED answers are written to the permanent response
 * cache. Since the cache no longer time-expires (FLEETY-011), an ungrounded /
 * fabricated reply would otherwise be served for the entire life of its
 * kb_version — a real risk whenever retrieval is degraded. `isCacheable` must
 * therefore require `hasGrounding`. This reads the edge source directly
 * (Deno-only fn) and fails loudly if the guard is dropped.
 */
describe("fleety cache — grounded answers only", () => {
  const chat = read("supabase/functions/techfleet-chat/index.ts");

  it("FLEETY-013: isCacheable is gated on hasGrounding", () => {
    // Find the isCacheable definition and assert hasGrounding participates.
    const m = chat.match(/const isCacheable\s*=([\s\S]{0,260}?);/);
    expect(m, "isCacheable definition not found").toBeTruthy();
    expect(m![1]).toMatch(/\bhasGrounding\b/);
  });

  it("hasGrounding is derived from real grounding signals, not hardcoded", () => {
    // Sanity: hasGrounding must be computed from the context slots (so the guard
    // actually reflects whether the turn was grounded).
    expect(chat).toMatch(/const hasGrounding\s*=\s*!!\(/);
    expect(chat).toMatch(/knowledgeContext[\s\S]{0,160}frameworkContext/);
  });
});
