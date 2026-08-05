// Deno tests for the Fleety system prompt (PRD D-17b token-budget gate + D-17c
// structural assertions). Matches the repo convention for edge-function tests
// (sibling *.test.ts files use deno.land/std assert). Run in CI via:
//   deno test supabase/functions/techfleet-chat/prompt.test.ts
//
// D-17b: the base prompt (every dynamic slot empty) must not exceed the token
// ceiling, so retrieved KB/context always has guaranteed headroom at scale.
// D-17c: required sections appear exactly once, output is deterministic, and
// the assembly order is byte-for-byte faithful to the original inline prompt.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALIAS_MAP,
  buildSystemPrompt,
  PRACTICAL_CONTRACT,
  type PromptContext,
  SYSTEM_PROMPT_BASE,
  tonePresetFor,
} from "./prompt.ts";

// The fixed instruction scaffold — base persona + canary + practical contract +
// alias map + tone, with NO dynamic content — must stay within this ceiling so
// runtime KB/context always has headroom. Measured base is ~1,854 tokens
// (practical worst case); 2,000 leaves ~8% headroom. Raising it is a conscious
// decision, never an accident: a bloated base silently steals KB budget at
// request time.
const TOKEN_CEILING = 2000;

function emptyCtx(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    audience: "member",
    canaryPhrase: "FLEETY-SYSTEM-CANARY-7x9k2",
    practical: true, // worst case for the token budget (adds PRACTICAL_CONTRACT)
    cannedContext: "",
    userContext: "",
    playbookContext: "",
    exampleContext: "",
    knowledgeContext: "",
    frameworkContext: "",
    fewShotContext: "",
    webContext: "",
    ...overrides,
  };
}

// Rough token estimate: ~4 chars per token — the same heuristic index.ts uses
// for its cost counter, so the gate matches production accounting.
function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

Deno.test("base prompt (empty slots, practical) stays within the token ceiling", () => {
  const base = buildSystemPrompt(emptyCtx());
  const tokens = estimateTokens(base);
  assert(
    tokens <= TOKEN_CEILING,
    `Base prompt is ~${tokens} tokens — exceeds ceiling of ${TOKEN_CEILING}. ` +
      `Trim the base prompt before merging.`
  );
});

Deno.test("required instruction sections each appear exactly once", () => {
  const base = buildSystemPrompt(emptyCtx());
  for (const marker of [
    "KNOWLEDGE BASE:",
    "TERMINOLOGY ALIASES",
    "PRACTICAL MODE — ANSWER CONTRACT",
    "[CANARY:FLEETY-SYSTEM-CANARY-7x9k2]",
  ]) {
    const occurrences = base.split(marker).length - 1;
    assertEquals(occurrences, 1, `"${marker}" must appear exactly once (found ${occurrences}).`);
  }
});

Deno.test("practical contract is omitted for non-operational intents", () => {
  const base = buildSystemPrompt(emptyCtx({ practical: false }));
  assertEquals(base.includes("PRACTICAL MODE — ANSWER CONTRACT"), false);
});

Deno.test("output is deterministic for identical input", () => {
  assertEquals(buildSystemPrompt(emptyCtx()), buildSystemPrompt(emptyCtx()));
});

Deno.test("each audience gets its own tone preset; unknown falls back to member", () => {
  for (const audience of ["member", "teacher", "admin", "trainee"]) {
    const prompt = buildSystemPrompt(emptyCtx({ audience }));
    assert(prompt.includes(tonePresetFor(audience)));
  }
  // Non-teacher/admin audiences resolve to the trainee/member preset — exactly
  // as the original inline ternary did.
  assertEquals(tonePresetFor("trainee"), tonePresetFor("member"));
});

Deno.test("assembly order is byte-for-byte faithful to the original inline prompt", () => {
  const ctx = emptyCtx({
    cannedContext: "<<CANNED>>",
    userContext: "<<USER>>",
    playbookContext: "<<PLAYBOOK>>",
    exampleContext: "<<EXAMPLE>>",
    knowledgeContext: "<<KB>>",
    frameworkContext: "<<FRAMEWORK>>",
    fewShotContext: "<<FEWSHOT>>",
    webContext: "<<WEB>>",
  });
  const expected =
    SYSTEM_PROMPT_BASE +
    `\n[CANARY:${ctx.canaryPhrase}]\n` +
    ctx.cannedContext +
    ctx.userContext +
    ctx.playbookContext +
    ctx.exampleContext +
    PRACTICAL_CONTRACT +
    ALIAS_MAP +
    tonePresetFor(ctx.audience) +
    ctx.knowledgeContext +
    ctx.frameworkContext +
    ctx.fewShotContext +
    ctx.webContext;
  assertEquals(buildSystemPrompt(ctx), expected);
});
