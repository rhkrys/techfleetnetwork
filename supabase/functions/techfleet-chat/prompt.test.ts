// Deno tests for the Fleety system prompt (PRD D-17b token-budget gate + D-17c
// structural assertions). Matches the repo convention for edge-function tests
// (sibling *.test.ts files use deno.land/std assert). Run in CI via:
//   deno test supabase/functions/techfleet-chat/prompt.test.ts
//
// D-17b: the base prompt (empty dynamic slots) must not exceed the token
// ceiling, so dynamic KB/context always has guaranteed headroom at scale.
// D-17c: required section headers each appear exactly once and output is
// deterministic for the same input.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSystemPrompt, formatUserContext, TONE_PRESETS } from "./prompt.ts";

const TOKEN_CEILING = 1200;

const EMPTY_CTX = {
  audience: "member" as const,
  tonePreset: TONE_PRESETS.member,
  userContext: "",
  kbContext: "",
};

// Rough token estimate: ~4 chars per token. Conservative for English prose.
function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

Deno.test("base prompt stays within the token ceiling", () => {
  const base = buildSystemPrompt(EMPTY_CTX);
  const tokens = estimateTokens(base);
  assert(
    tokens <= TOKEN_CEILING,
    `Base prompt is ~${tokens} tokens — exceeds ceiling of ${TOKEN_CEILING}. ` +
      `Trim the base prompt before merging.`,
  );
});

Deno.test("required section headers appear exactly once", () => {
  const base = buildSystemPrompt(EMPTY_CTX);
  for (const section of ["[AUDIENCE TONE]", "[USER CONTEXT]", "[KNOWLEDGE]"]) {
    const occurrences = base.split(section).length - 1;
    assertEquals(
      occurrences,
      1,
      `Section "${section}" must appear exactly once (found ${occurrences}).`,
    );
  }
});

Deno.test("output is deterministic for identical input", () => {
  assertEquals(buildSystemPrompt(EMPTY_CTX), buildSystemPrompt(EMPTY_CTX));
});

Deno.test("every audience tone preset builds a valid prompt", () => {
  for (const audience of ["member", "teacher", "admin"] as const) {
    const prompt = buildSystemPrompt({
      audience,
      tonePreset: TONE_PRESETS[audience],
      userContext: "",
      kbContext: "",
    });
    assert(prompt.includes(TONE_PRESETS[audience]));
  }
});

Deno.test("formatUserContext returns empty string when there is no memory", () => {
  assertEquals(formatUserContext([]), "");
});

Deno.test("formatUserContext renders one line per memory under a header", () => {
  const out = formatUserContext([
    { memory_key: "role", memory_value: "UX Researcher", category: "role" },
    { memory_key: "project", memory_value: "Accessibility Audit", category: "project" },
  ]);
  assert(out.startsWith("What I know about this member:"));
  assertEquals(out.split("\n").length, 3); // header + 2 memories
});
