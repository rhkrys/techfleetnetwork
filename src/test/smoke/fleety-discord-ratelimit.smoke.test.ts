import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/**
 * Regression guard for the Discord /fleety outage (2026-08): the adapter's rate limiter called
 * the AUTH-ONLY check_rate_limit, which rejects any identifier that isn't a 64-char SHA-256 hash
 * and any action outside its login/signup/reset whitelist. Passing `discord:<id>` + "fleety" made
 * it return {allowed:false} on EVERY call, so /fleety only ever posted "you've asked a lot in the
 * last hour" and never answered — for days. It must use the GENERIC check_edge_rate_limit.
 */
describe("discord /fleety uses the generic edge rate limiter", () => {
  const src = read("supabase/functions/discord-interactions/index.ts");

  it("calls check_edge_rate_limit (generic, accepts any identifier/action)", () => {
    expect(src).toMatch(/rpc\(\s*["']check_edge_rate_limit["']/);
  });

  it("does NOT call the auth-only check_rate_limit (it would block every /fleety)", () => {
    expect(src).not.toMatch(/rpc\(\s*["']check_rate_limit["']/);
  });

  it("still fails OPEN so a limiter error never blocks a real question", () => {
    expect(src).toMatch(/return true; \/\/ fail open/);
  });
});
