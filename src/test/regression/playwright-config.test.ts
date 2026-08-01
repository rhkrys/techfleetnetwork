import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * BDD W1-RG-CI-003 / W1-RG-CI-004 / W1-RG-CI-005 — Static guarantees about
 * the Playwright config and regression workflow. Fast static-asset tests so
 * a misconfigured config can never silently regress and reintroduce shard
 * cancellations.
 */
const ROOT = resolve(__dirname, "..", "..", "..");

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("Regression CI invariants", () => {
  const pwConfig = read("playwright.config.ts");
  // regression.yml was replaced by the unified ci.yml (its `e2e` job now owns
  // the sharded Playwright run). Read that instead.
  const wf = read(".github/workflows/ci.yml");

  it("W1-RG-CI-004: per-test timeout is at most 45s", () => {
    expect(pwConfig).toMatch(/timeout:\s*45_000/);
  });

  it("W1-RG-CI-003: CI retries are capped at 1", () => {
    expect(pwConfig).toMatch(/retries:\s*isCI\s*\?\s*1\s*:\s*0/);
  });

  it("globalTimeout caps a shard at 20 minutes", () => {
    expect(pwConfig).toMatch(/globalTimeout:\s*20\s*\*\s*60\s*\*\s*1000/);
  });

  it("e2e job uses 6 shards", () => {
    expect(wf).toMatch(/shard:\s*\[1,\s*2,\s*3,\s*4,\s*5,\s*6\]/);
  });

  it("e2e shards upload blob reports for aggregation", () => {
    expect(wf).toMatch(/playwright-blob-shard-/);
  });

  it("W1-RG-CI-005: auth.e2e.ts caps retries to 1 per describe", () => {
    const auth = read("e2e/auth.e2e.ts");
    const matches = auth.match(/test\.describe\.configure\(\{[^}]*retries:\s*1/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
