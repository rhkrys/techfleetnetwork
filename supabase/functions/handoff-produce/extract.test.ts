// Unit tests for supabase/functions/handoff-produce (extraction + dedup helpers).
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  approxTokens,
  chunkText,
  dedupeFacts,
  isTemplateItem,
  looksLikeTemplate,
  mergeFacts,
  stripTemplateItems,
} from "./extract.ts";

Deno.test(
  "isTemplateItem drops AI-summary blocks, bare dates, headings, and workshop prompts",
  () => {
    assert(
      isTemplateItem("🌱 Community impact assessment • Tracking community growth post-training."),
      "emoji AI summary"
    );
    assert(isTemplateItem("January 6, 2026"), "bare date");
    assert(isTemplateItem("Results"), "bare heading");
    assert(isTemplateItem("MANUS - MIDDLE MANAGERS"), "tool label");
    assert(
      isTemplateItem("Write ideas that you can introduce to measure success"),
      "workshop prompt"
    );
    assert(
      isTemplateItem("FORMAT KPI's will need to schedule a workshop. Template link: https://x"),
      "template link"
    );
    // real KPIs are KEPT
    assert(
      !isTemplateItem("Amount of individuals getting job offers after joining TF"),
      "real KPI kept"
    );
    assert(
      !isTemplateItem("% of members who land jobs, promotions, or freelance work after Tech Fleet"),
      "real KPI kept"
    );
  }
);

Deno.test("mergeFacts no longer truncates content-rich sections at 60 (raised backstop)", () => {
  const many = Array.from({ length: 150 }, (_, i) => `kpi number ${i}`);
  const { facts, dropped } = mergeFacts([many]);
  assertEquals(facts.length, 150); // all 150 kept, not cut to 60
  assertEquals(dropped, 0);
});

Deno.test("stripTemplateItems keeps real terse stickies but drops placeholder scaffolding", () => {
  const material = [
    "In the space below, provide thoughts about how the last phase went.", // instruction -> drop
    "Enter here\nEnter here\nEnter here", // repeated placeholder -> drop
    "Liked the camaraderie between teammates", // real, terse (39 chars) -> KEEP
    "We moved too slowly on research efforts, could stand to be more lean", // real -> KEEP
    "Takeaway\nTakeaway\nTakeaway", // repeated placeholder -> drop
  ].join("\n\n");
  const kept = stripTemplateItems(material);
  assert(kept.includes("Liked the camaraderie between teammates"), "real terse sticky kept");
  assert(kept.includes("moved too slowly on research"), "real sticky kept");
  assert(!kept.includes("Enter here"), "repeated placeholder dropped");
  assert(!kept.includes("In the space below"), "instruction dropped");
  assert(!/Takeaway/i.test(kept), "repeated placeholder dropped");
});

Deno.test("approxTokens is a rough chars/4 estimate", () => {
  assertEquals(approxTokens(""), 0);
  assertEquals(approxTokens("abcd"), 1);
  assert(approxTokens("a".repeat(4000)) === 1000);
});

Deno.test("looksLikeTemplate flags unfilled scaffolding, keeps real work", () => {
  const template =
    "In the space below, write down a summary of takeaways from this section. " +
    "Takeaway Takeaway Takeaway Takeaway. Describe an action item. Describe an action item. " +
    "Rules of thumb: one user group per vision board.";
  assert(looksLikeTemplate(template), "should flag the empty template");

  const real =
    "Tech Fleet uses a two part application system. It removes duplicate data entry across " +
    "project applications, and forms teams Leads first so a mentor is present before Apprentices join.";
  assert(!looksLikeTemplate(real), "should keep real filled content");

  assert(looksLikeTemplate("Sprint 1 Goals"), "a bare heading is noise");
});

Deno.test("chunkText reads everything: no truncation, bounded size", () => {
  const body = Array.from({ length: 50 }, (_, i) => `Sentence number ${i} with some content.`).join(
    " "
  );
  const chunks = chunkText(body, 300, 40);
  assert(chunks.length > 1, "long text splits into multiple chunks");
  for (const ch of chunks) assert(ch.length <= 300 + 40, "each chunk is bounded");
  // every source word survives somewhere (nothing dropped)
  for (let i = 0; i < 50; i++)
    assert(
      chunks.some((c) => c.includes(`number ${i} `)),
      `word ${i} kept`
    );
});

Deno.test("chunkText returns a single chunk when it already fits", () => {
  assertEquals(chunkText("short and sweet", 12000), ["short and sweet"]);
  assertEquals(chunkText("   ", 12000), []); // whitespace-only -> nothing
});

Deno.test("mergeFacts dedupes case/space-insensitively and caps with a dropped count", () => {
  const merged = mergeFacts([
    ["The team shipped the MVP.", "Research used WEF data."],
    ["the team shipped the MVP.", "New unique fact."], // dup of first (case/space)
  ]);
  assertEquals(merged.facts.length, 3);
  assertEquals(merged.dropped, 0);

  const many = Array.from({ length: 70 }, (_, i) => `fact ${i}`);
  const capped = mergeFacts([many], 60);
  assertEquals(capped.facts.length, 60);
  assertEquals(capped.dropped, 10);
});

Deno.test(
  "dedupeFacts SAFETY: never merges distinct points (the whole KPI funnel survives)",
  () => {
    // These are all DIFFERENT measures. Dedup must keep every one — merging any would lose real content,
    // the exact failure the arbitrary top-N cap caused. This is the property that makes the stage safe.
    const distinct = [
      "Share who complete onboarding within 30 days",
      "Share who join a collaborative group within 30 days of converting",
      "Share who set a first learning goal after sign-up",
      "Awareness KPIs: newsletter open and click rate",
      "Engagement KPIs: Discord activity and event attendance",
      "Onboarding conversion: drop-off by step",
      "New members show engagement by posting",
      "Late-career members show engagement by mentoring and coaching",
    ];
    const { facts, dropped } = dedupeFacts(distinct);
    assertEquals(dropped, 0, "no distinct point may be dropped");
    assertEquals(facts.length, distinct.length);
  }
);

Deno.test(
  "dedupeFacts collapses reordered/punctuation-variant restatements of the SAME point",
  () => {
    const { facts, dropped } = dedupeFacts([
      "Discord activity and event attendance",
      "event attendance and Discord activity", // same words, reordered -> exact-dedup misses it, this catches it
      "Discord activity, and event attendance!", // punctuation only -> a duplicate
      "Class registration completion rate", // distinct -> kept
    ]);
    assertEquals(dropped, 2);
    assertEquals(facts.length, 2);
    assert(
      facts.some((f) => /Class registration/.test(f)),
      "the distinct fact survives"
    );
  }
);

Deno.test(
  "dedupeFacts keeps the MORE COMPLETE near-duplicate (no nuance lost to the merge)",
  () => {
    // A one-word addition keeps overlap above threshold (Jaccard 5/6 = 0.83), so these merge and the
    // richer phrasing must win. (A LARGER addition drops overlap below threshold and is kept as a
    // distinct point — see the next test — which is the conservative, non-lossy default.)
    const { facts, dropped } = dedupeFacts([
      "Discord activity and event attendance",
      "Discord activity and event attendance rate",
    ]);
    assertEquals(dropped, 1);
    assertEquals(facts.length, 1);
    assertEquals(facts[0], "Discord activity and event attendance rate", "richer phrasing kept");
  }
);

Deno.test(
  "dedupeFacts is CONSERVATIVE: a specific fact is not swallowed by a shorter general one",
  () => {
    // "...within 30 days of joining" only shares 44% of words with the short form, so BOTH survive. The
    // stage would rather keep a mild redundancy than risk merging away a distinct, more-specific point.
    const { facts, dropped } = dedupeFacts([
      "share who complete onboarding",
      "share who complete onboarding within 30 days of joining",
    ]);
    assertEquals(dropped, 0);
    assertEquals(facts.length, 2);
  }
);

Deno.test("dedupeFacts preserves order and reports a non-silent dropped count", () => {
  const { facts, dropped } = dedupeFacts([
    "Alpha metric",
    "Beta metric",
    "alpha metric",
    "Gamma metric",
  ]);
  assertEquals(facts, ["Alpha metric", "Beta metric", "Gamma metric"]); // first-seen order, "alpha" is the dup
  assertEquals(dropped, 1);
});
