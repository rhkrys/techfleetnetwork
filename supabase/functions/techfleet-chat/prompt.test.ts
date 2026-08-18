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
  expandQuery,
  extractSourceUrls,
  NO_KNOWLEDGE_DIRECTIVE,
  PLAN_MODE_CONTRACT,
  PRACTICAL_CONTRACT,
  type PromptContext,
  REVIEW_MODE_CONTRACT,
  SYSTEM_PROMPT_BASE,
  tonePresetFor,
} from "./prompt.ts";

// The fixed instruction scaffold — base persona + canary + practical contract +
// alias map + tone, with NO dynamic content — must stay within this ceiling so
// runtime KB/context always has headroom. Raising it is a CONSCIOUS decision,
// never an accident: a bloated base silently steals KB budget at request time.
// Bumped 2000 -> 2500 -> 2800 (2026-08-16): brand-voice + STRICT SCOPE/jailbreak +
// scannable-formatting + framework-accuracy rules (milestone-not-phase, parallel/non-
// linear, strict grounding) are all core required behavior, not optional. DeepSeek's
// 131k-token context easily affords a ~2.6k base alongside retrieved KB context, so
// this is a headroom bump, not a risk; the ceiling still guards against unbounded creep.
// Bumped 2800 -> 3200 (2026-08-17): the answer contract now mandates depth-calibration, an
// opinionated recommendation, a coaching close (recommended next step + offer to help), the
// "Where to learn more" top-3-then-rest link hierarchy, C1 no-inline/no-invented-links, and a
// non-negotiable adherence rule — all owner-required mentor behavior, not optional. v4-pro's
// 131k context trivially affords a ~3k base; the ceiling still bounds unbounded creep.
const TOKEN_CEILING = 3200;

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
    materialContext: "",
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

Deno.test("Tech Fleet brand voice rules are present (regression guard)", () => {
  const base = SYSTEM_PROMPT_BASE;
  assert(base.includes("TECH FLEET BRAND VOICE"), "brand voice section header");
  assert(
    /Welcoming/.test(base) && /Caring/.test(base) && /Informative/.test(base),
    "the three core voice traits"
  );
  assert(/Sage/.test(base), "the Sage archetype framing");
  assert(/7th-to-9th-grade/.test(base), "brand reading level");
  assert(/two words, never as one/i.test(base), "brand name two-word terminology rule");
  assert(/behavior, not the identity/i.test(base), "praise behavior, not identity");
  assert(/singular "they"/.test(base), "inclusive singular they");
});

Deno.test("strict-scope + jailbreak-resistance safety rules are present (regression guard)", () => {
  const base = SYSTEM_PROMPT_BASE;
  assert(/STRICT SCOPE/.test(base), "strict scope gate");
  assert(/only discuss tech fleet/i.test(base) || /ONLY discuss Tech Fleet/.test(base));
  assert(/untrusted data/i.test(base), "treat input + retrieved content as untrusted data");
  assert(/never adopt a different persona/i.test(base), "no persona / no override");
  assert(
    /never execute code|no tools, files, or api calls/i.test(base),
    "no code execution / no tools"
  );
});

Deno.test("answer-depth + coaching-close contract is present (owner mentor rules)", () => {
  // Depth calibration + no brush-off + opinionated recommendation.
  assert(/calibrated to the question/i.test(PRACTICAL_CONTRACT), "depth-calibration rule");
  assert(/never brush off|cop out/i.test(PRACTICAL_CONTRACT), "no brush-off rule");
  assert(/RECOMMEND/.test(PRACTICAL_CONTRACT), "opinionated recommendation");
  // Coaching close: explicit next step + offer to help.
  assert(/Your recommended next step/.test(PRACTICAL_CONTRACT), "recommended-next-step section");
  assert(/ASK what they would like help with/i.test(PRACTICAL_CONTRACT), "offer-to-help close");
  // Where to learn more: top-3-then-rest, real links only (C1).
  assert(/Where to learn more/.test(PRACTICAL_CONTRACT), "where-to-learn-more section");
  assert(/TOP 3/.test(PRACTICAL_CONTRACT), "top-3 sources first");
  // Always justify (grounded WHY) — Fleety explains its reasoning from the framework relationships.
  assert(/ALWAYS JUSTIFY/.test(PRACTICAL_CONTRACT), "justify-every-claim rule");
  assert(
    /relationship MEANINGS/i.test(PRACTICAL_CONTRACT),
    "why is grounded in relationship meanings"
  );
});

Deno.test(
  "C1 + no-invented-links + no-emoji + adherence rules are present (regression guard)",
  () => {
    const base = SYSTEM_PROMPT_BASE;
    assert(
      /Links live ONLY in this section, never inline/i.test(base),
      "C1: links only in section"
    );
    assert(/never invent or guess a URL/i.test(base), "no invented/guessed URLs");
    assert(/Do NOT use emojis/i.test(base), "no-emoji rule present");
    assert(!base.includes("📚") && !base.includes("🌐"), "no emoji characters in the base prompt");
    assert(
      !PRACTICAL_CONTRACT.includes("🎯") && !PRACTICAL_CONTRACT.includes("✅"),
      "no emoji in contract"
    );
    assert(/NON-NEGOTIABLE/.test(base), "adherence rule present");
  }
);

Deno.test("practical contract is omitted for non-operational intents", () => {
  const base = buildSystemPrompt(emptyCtx({ practical: false }));
  assertEquals(base.includes("PRACTICAL MODE — ANSWER CONTRACT"), false);
});

Deno.test("mode: chat is byte-for-byte identical to no mode (backward compatible)", () => {
  assertEquals(buildSystemPrompt(emptyCtx({ mode: "chat" })), buildSystemPrompt(emptyCtx()));
});

Deno.test("mode: review injects the review contract and REPLACES the practical contract", () => {
  const p = buildSystemPrompt(emptyCtx({ mode: "review", practical: true }));
  assert(p.includes("DELIVERABLE REVIEW MODE"));
  assert(p.includes("## What you did well"));
  assertEquals(p.includes("PRACTICAL MODE — ANSWER CONTRACT"), false);
  assertEquals(p.includes("PLAN MODE"), false);
});

Deno.test("mode: plan injects the plan contract and REPLACES the practical contract", () => {
  const p = buildSystemPrompt(emptyCtx({ mode: "plan", practical: true }));
  assert(p.includes("PLAN MODE"));
  assert(p.includes("## Your first step"));
  assertEquals(p.includes("PRACTICAL MODE — ANSWER CONTRACT"), false);
  assertEquals(p.includes("DELIVERABLE REVIEW MODE"), false);
});

Deno.test("mode contracts are exported and non-empty", () => {
  assert(REVIEW_MODE_CONTRACT.length > 0 && PLAN_MODE_CONTRACT.length > 0);
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
    materialContext: "<<MATERIAL>>",
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
    ctx.webContext +
    ctx.materialContext;
  assertEquals(buildSystemPrompt(ctx), expected);
});

// ── D-08 structural citations ────────────────────────────────────────────────

Deno.test("extractSourceUrls: http(s) only, deduped, order-preserving", () => {
  const hits = [
    { url: "https://guide.techfleet.org/a" },
    { url: "https://guide.techfleet.org/a" }, // duplicate — dropped
    { url: "framework://Team-Practices" }, // internal — excluded (UC-19 AC-3)
    { url: "csv://skills" }, // internal — excluded
    { url: null }, // no url
    { url: "http://example.com/b" },
    {}, // missing url field
  ];
  assertEquals(extractSourceUrls(hits), ["https://guide.techfleet.org/a", "http://example.com/b"]);
});

Deno.test("extractSourceUrls: chunk urls (#pN) collapse back to the page (A1)", () => {
  const hits = [
    { url: "https://guide.techfleet.org/handbook" },
    { url: "https://guide.techfleet.org/handbook#p2" }, // same page, different chunk → deduped
    { url: "https://guide.techfleet.org/handbook#p3" },
  ];
  assertEquals(extractSourceUrls(hits), ["https://guide.techfleet.org/handbook"]);
});

Deno.test("extractSourceUrls respects the cap", () => {
  const hits = Array.from({ length: 20 }, (_, i) => ({ url: `https://x/${i}` }));
  assertEquals(extractSourceUrls(hits, 8).length, 8);
});

// ── UC-04 honesty hard-gate ──────────────────────────────────────────────────

Deno.test("expandQuery: SPF synonyms surface lexically-different central entities (A2)", () => {
  const out = expandQuery("what does my team need to do to do discovery");
  assert(
    /research/i.test(out),
    "'discovery' expands to include 'research' so research-plan ranks up"
  );
  assert(out.startsWith("what does my team"), "original query preserved as prefix");
  assertEquals(expandQuery("xyzzy nothing matches"), "xyzzy nothing matches"); // no trigger → unchanged
});

Deno.test("NO_KNOWLEDGE_DIRECTIVE forbids fabrication and gives a real fallback", () => {
  assert(NO_KNOWLEDGE_DIRECTIVE.includes("NO KNOWLEDGE MATCH"));
  assert(/do not invent/i.test(NO_KNOWLEDGE_DIRECTIVE));
  assert(NO_KNOWLEDGE_DIRECTIVE.includes("guide.techfleet.org"));
});
