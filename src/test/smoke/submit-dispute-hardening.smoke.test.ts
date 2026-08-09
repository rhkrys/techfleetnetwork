// Smoke coverage for audit T-H — submit-dispute cost/abuse hardening.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(
  resolve(process.cwd(), "supabase/functions/submit-dispute/index.ts"),
  "utf8"
);

describe("submit-dispute hardening (smoke)", () => {
  it("T-H-DISPUTE-001: rate-limits per IP and returns generic errors", () => {
    expect(src).toMatch(/enforceEdgeRateLimit\(req,\s*\{\s*action:\s*["']submit_dispute["']/);
    expect(src).toMatch(/status.*429|429/);
    // No raw RPC error message leaked to the client.
    expect(src).not.toMatch(/error:\s*error\.message/);
  });
});
