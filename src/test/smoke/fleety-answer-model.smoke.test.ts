import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/**
 * Regression guard for Fleety's ANSWER model (the Groq "brain" that writes
 * replies — distinct from the Gemini embedding model guarded in
 * fleety-embed-provider.smoke.test.ts).
 *
 * `llama-3.3-70b-versatile` is being deprecated by Groq (scheduled shutoff
 * 2026-08-16). Left in place it would fail exactly like the retired embedding
 * model did — a silent HTTP error, then ungrounded/broken answers. PR6 moved
 * every call site (router, main generation, cost accounting, log) onto a single
 * `GROQ_MODEL` constant set to the current production model. These assertions
 * read the source directly (Deno-only edge fn, can't be imported into vitest)
 * and fail loudly if a deprecated model or a hard-coded model string creeps
 * back in.
 */
describe("fleety answer model (Groq) single source of truth", () => {
  const chat = read("supabase/functions/techfleet-chat/index.ts");

  it("FLEETY-MODEL-001: the deprecated llama-3.3-70b answer model is gone from call sites", () => {
    // A comment documenting the deprecation is fine; a model string passed to
    // the API is not. Guard the JSON payload form `model: "...llama-3.3-70b..."`.
    expect(chat).not.toMatch(/model:\s*["']llama-3\.3-70b-versatile["']/);
    // And the cost-accounting _model field must not pin it either.
    expect(chat).not.toMatch(/_model:\s*["']llama-3\.3-70b-versatile["']/);
  });

  it("FLEETY-MODEL-002: a single GROQ_MODEL constant drives every call site", () => {
    // Defined once, on a current non-deprecated, non-Meta model (gpt-oss-20b or
    // 120b — both OpenAI open-weight; the deprecating Meta Llama is banned below).
    expect(chat).toMatch(/const GROQ_MODEL\s*=\s*["']openai\/gpt-oss-(20|120)b["']/);
    // Router + main generation + cost + log all reference the constant, never a
    // literal. Expect at least the 4 known call sites to use `GROQ_MODEL`.
    const uses = chat.match(/\bGROQ_MODEL\b/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(5); // 1 decl + >=4 references
  });

  it("FLEETY-MODEL-003: reasoning_effort is pinned low to protect the streaming latency SLO", () => {
    // gpt-oss is reasoning-capable; low effort keeps reasoning off the critical
    // path so time-to-first-content-token stays within the p95<3s target.
    expect(chat).toMatch(/const GROQ_REASONING_EFFORT\s*=\s*["']low["']/);
    expect(chat).toMatch(/reasoning_effort:\s*GROQ_REASONING_EFFORT/);
  });
});
