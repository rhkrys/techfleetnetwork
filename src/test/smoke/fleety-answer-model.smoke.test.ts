import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/**
 * Regression guard for Fleety's ANSWER model (the "brain" that writes replies —
 * distinct from the Gemini embedding model guarded in
 * fleety-embed-provider.smoke.test.ts).
 *
 * Owner decision 2026-08-16: generation runs on DeepSeek via OpenRouter — NEVER
 * Groq, Llama, or Gemini. A single `FLEETY_LLM_MODEL` constant drives every call
 * site (router, main generation, cost accounting, log). These assertions read the
 * source directly (Deno-only edge fn, can't be imported into vitest) and fail
 * loudly if a banned provider/model or a hard-coded model string creeps back in,
 * or if the determinism params regress.
 */
describe("fleety answer model (OpenRouter/DeepSeek) single source of truth", () => {
  const chat = read("supabase/functions/techfleet-chat/index.ts");

  it("FLEETY-MODEL-001: no banned provider/model strings reach the API", () => {
    // The Groq host and Llama/gpt-oss model strings must not be passed to the API.
    // (A comment naming them as banned is fine; a call/payload is not.)
    expect(chat).not.toMatch(/api\.groq\.com/);
    expect(chat).not.toMatch(/model:\s*["'][^"']*llama[^"']*["']/i);
    expect(chat).not.toMatch(/model:\s*["'][^"']*gpt-oss[^"']*["']/i);
    // reasoning_effort was Groq-specific; it must not be in any payload anymore.
    expect(chat).not.toMatch(/reasoning_effort:/);
  });

  it("FLEETY-MODEL-002: a single FLEETY_LLM_MODEL constant (DeepSeek default) drives every call site", () => {
    // Defined once, env-overridable, defaulting to the decided DeepSeek model.
    expect(chat).toMatch(
      /const FLEETY_LLM_MODEL\s*=\s*Deno\.env\.get\(["']FLEETY_LLM_MODEL["']\)\s*\|\|\s*["']deepseek\/[^"']+["']/
    );
    // Router + main generation + cost + log all reference the constant, never a literal.
    const uses = chat.match(/\bFLEETY_LLM_MODEL\b/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(5); // 1 decl + >=4 references
    // Calls go to the OpenRouter host via a single constant.
    expect(chat).toMatch(
      /const OPENROUTER_URL\s*=\s*["']https:\/\/openrouter\.ai\/api\/v1\/chat\/completions["']/
    );
    // Key is the shared OpenRouter key (LLM_API_KEY), not GROQ_API_KEY.
    expect(chat).toMatch(/Deno\.env\.get\(["']LLM_API_KEY["']\)/);
    expect(chat).not.toMatch(/Deno\.env\.get\(["']GROQ_API_KEY["']\)/);
  });

  it("FLEETY-MODEL-003: generation is deterministic (temperature 0 + fixed seed)", () => {
    // Owner goal: the same question must not vary over time. Guard the params so a
    // future edit can't silently reintroduce sampling drift.
    expect(chat).toMatch(/const FLEETY_LLM_TEMPERATURE\s*=\s*0\b/);
    expect(chat).toMatch(/const FLEETY_LLM_SEED\s*=\s*\d+/);
    expect(chat).toMatch(/temperature:\s*FLEETY_LLM_TEMPERATURE/);
    expect(chat).toMatch(/seed:\s*FLEETY_LLM_SEED/);
  });

  it("FLEETY-MODEL-004: DeepSeek calls are pinned to US inference providers (data residency)", () => {
    // User chat can contain personal data; DeepSeek must only run on US-headquartered
    // providers — reusing the hand-off port's US_INFERENCE_PROVIDERS allow-list.
    expect(chat).toMatch(
      /import\s*\{\s*US_INFERENCE_PROVIDERS\s*\}\s*from\s*["']\.\.\/_shared\/llm\/port\.ts["']/
    );
    expect(chat).toMatch(/only:\s*US_INFERENCE_PROVIDERS/);
    expect(chat).toMatch(/provider:\s*OPENROUTER_PROVIDER/);
  });
});
