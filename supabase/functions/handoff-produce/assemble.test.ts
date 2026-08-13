// Deno tests for the deterministic hand-off assembler (Phase B2, no network).
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildAllVersionOutlines,
  buildVersionOutline,
  HANDOFF_AUDIENCES,
  isIncluded,
  normalizeTypography,
  renderVersionMarkdown,
  STORY_ARC_ORDER,
  stripLeadingHeading,
  type HandoffComponent,
} from "./assemble.ts";

Deno.test(
  "normalizeTypography straightens curly quotes + non-breaking hyphen to plain ASCII",
  () => {
    // The exact AI-typography tells seen from Qwen / Terra Pro / gpt-oss.
    assertEquals(normalizeTypography("here’s the honest part"), "here's the honest part");
    assertEquals(normalizeTypography("“peer‑to‑peer” mentoring"), '"peer-to-peer" mentoring');
    // Still enforces the em/en-dash rule (superset of noEmDash).
    assertEquals(normalizeTypography("a — b"), "a, b");
    // Leaves ordinary ASCII (and hyphen-minus in URLs/node ids) untouched; idempotent.
    const clean = "See node-id 27-5104 at https://ex.com/a-b";
    assertEquals(normalizeTypography(clean), clean);
    assertEquals(normalizeTypography(normalizeTypography("it’s fine")), "it's fine");
  }
);

// A small synthetic map exercising every flag combination + arc grouping + direct-input.
const COMPONENTS: HandoffComponent[] = [
  {
    slug: "pre-amble-1",
    "Hand-Off Story Arc": "Pre-amble",
    Component: "Project goals",
    "Is this in the Client Hand-Off?": "No",
    "Is this in the Teammate Hand-off?": "Yes",
    "Is this in the Teammate Case Study?": "Yes",
    "Is this in the Tech Fleet Org Case Study?": "Yes",
    "From Which Deliverable Does This Information Come?": [
      { slug: "project-plan", label: "Project Plan" },
    ],
  },
  {
    slug: "pre-amble-4",
    "Hand-Off Story Arc": "Pre-amble",
    Component: "Reflections (direct input)",
    "Is this in the Client Hand-Off?": "No",
    "Is this in the Teammate Hand-off?": "Yes",
    "Is this in the Teammate Case Study?": "Yes",
    "Is this in the Tech Fleet Org Case Study?": "No",
    // no deliverable link => direct input
  },
  {
    slug: "empathy-1",
    "Hand-Off Story Arc": "Part 1: Empathy Building",
    Component: "Problems",
    "Is this in the Client Hand-Off?": "Yes",
    "Is this in the Teammate Hand-off?": "Yes",
    "Is this in the Teammate Case Study?": "Yes",
    "Is this in the Tech Fleet Org Case Study?": "Yes",
    "From Which Deliverable Does This Information Come?": [
      { slug: "problem-statements", label: "Problem Statements" },
    ],
  },
  {
    slug: "sequel-eval",
    "Hand-Off Story Arc": "Part 4: The Sequel",
    Component: "Evaluation research",
    "Is this in the Client Hand-Off?": "No",
    "Is this in the Teammate Hand-off?": "No",
    "Is this in the Teammate Case Study?": "No",
    "Is this in the Tech Fleet Org Case Study?": "Yes",
    "From Which Deliverable Does This Information Come?": [
      { slug: "research-report", label: "Research Report" },
    ],
  },
];

Deno.test("inclusion follows the per-audience flag exactly", () => {
  assertEquals(isIncluded(COMPONENTS[0], "client"), false);
  assertEquals(isIncluded(COMPONENTS[0], "teammate"), true);
  assertEquals(isIncluded(COMPONENTS[3], "org_case_study"), true);
  assertEquals(isIncluded(COMPONENTS[3], "teammate_case_study"), false);
});

Deno.test("client version excludes teammate-only + org-only components", () => {
  const client = buildVersionOutline("client", COMPONENTS);
  const slugs = client.sections.flatMap((s) => s.components.map((c) => c.slug));
  assertEquals(slugs, ["empathy-1"]); // only the all-Yes component is client-flagged here
  assertEquals(client.includedCount, 1);
});

Deno.test("org case study is the only one to include the evaluation-research component", () => {
  const org = buildVersionOutline("org_case_study", COMPONENTS);
  const slugs = org.sections.flatMap((s) => s.components.map((c) => c.slug));
  assert(slugs.includes("sequel-eval"));
  for (const a of HANDOFF_AUDIENCES) {
    if (a === "org_case_study") continue;
    const other = buildVersionOutline(a, COMPONENTS).sections.flatMap((s) =>
      s.components.map((c) => c.slug)
    );
    assert(!other.includes("sequel-eval"), `${a} should not include sequel-eval`);
  }
});

Deno.test("sections are grouped + ordered by the fixed 5-part story arc", () => {
  const teammate = buildVersionOutline("teammate", COMPONENTS);
  const arcs = teammate.sections.map((s) => s.arc);
  // arcs present must appear in canonical order
  const canonicalIdx = arcs.map((a) =>
    STORY_ARC_ORDER.indexOf(a as (typeof STORY_ARC_ORDER)[number])
  );
  assertEquals(
    canonicalIdx,
    [...canonicalIdx].sort((x, y) => x - y)
  );
  assert(
    canonicalIdx.every((i) => i >= 0),
    "every arc is a known story-arc"
  );
});

Deno.test("direct-input components (no deliverable link) are flagged", () => {
  const teammate = buildVersionOutline("teammate", COMPONENTS);
  const preamble = teammate.sections.find((s) => s.arc === "Pre-amble")!;
  const directInput = preamble.components.find((c) => c.slug === "pre-amble-4")!;
  assertEquals(directInput.directInput, true);
  const linked = preamble.components.find((c) => c.slug === "pre-amble-1")!;
  assertEquals(linked.directInput, false);
});

Deno.test(
  "renderVersionMarkdown: per-component subheadings, top matter, placeholders, arc order",
  () => {
    const outline = buildVersionOutline("teammate", COMPONENTS);
    const md = renderVersionMarkdown(
      outline,
      [{ slug: "pre-amble-1", markdown: "The team set out to ship the MVP." }], // only one component written
      { projectName: "Acme", phase: "phase_1" }
    );
    assertStringIncludes(md, "# Teammate Hand-Off");
    assertStringIncludes(md, "Acme");
    assertStringIncludes(md, "## Milestones worked");
    assertStringIncludes(md, "## Deliverables we iterated on");
    assertStringIncludes(md, "## Pre-amble");
    assertStringIncludes(md, "### Project goals"); // the component subheading for pre-amble-1
    assertStringIncludes(md, "The team set out to ship the MVP.");
    assertStringIncludes(md, "### Reflections (direct input)"); // pre-amble-4 subheading present too
    assertStringIncludes(md, "_Awaiting content._"); // an unwritten component
    assert(md.indexOf("## Pre-amble") < md.indexOf("## Part 1: Empathy Building"));
  }
);

Deno.test("stripLeadingHeading removes a model-added heading but keeps prose", () => {
  assertEquals(stripLeadingHeading("## Pre-amble\nYou built X.").trim(), "You built X.");
  assertEquals(stripLeadingHeading("###  the journey\n\nWe shipped.").trim(), "We shipped.");
  // no leading heading -> unchanged
  assertEquals(stripLeadingHeading("Just prose.").trim(), "Just prose.");
});

Deno.test("renderVersionMarkdown strips a writer-repeated component heading (no duplicate)", () => {
  const outline = buildVersionOutline("teammate", COMPONENTS);
  const md = renderVersionMarkdown(outline, [
    { slug: "pre-amble-1", markdown: "### Project goals\nWe shipped the MVP." },
  ]);
  // exactly one "### Project goals" (the renderer's), the model's repeat stripped
  assertEquals((md.match(/^###\s+Project goals\s*$/gim) ?? []).length, 1);
  assertStringIncludes(md, "We shipped the MVP.");
});

Deno.test(
  "renderVersionMarkdown renders submitted deep-links, else falls back to deliverable names",
  () => {
    const outline = buildVersionOutline("teammate", COMPONENTS);
    const links = new Map([
      [
        "pre-amble-1",
        [{ label: "Project Plan (Figma)", url: "https://www.figma.com/board/x?node-id=1-2" }],
      ],
    ]);
    const md = renderVersionMarkdown(
      outline,
      [{ slug: "pre-amble-1", markdown: "goals" }],
      {},
      links
    );
    assertStringIncludes(md, "[Project Plan (Figma)](https://www.figma.com/board/x?node-id=1-2)");
    // an arc with no submitted links still lists framework deliverable names (fallback)
    assertStringIncludes(md, "**Links to deliverables:**");
  }
);

Deno.test("VOICE: em/en dashes never reach the rendered output (hard rule)", () => {
  const outline = buildVersionOutline("teammate", COMPONENTS);
  const md = renderVersionMarkdown(
    outline,
    [{ slug: "pre-amble-1", markdown: "The team shipped the MVP — on time — and learned a lot." }],
    { projectName: "Acme — Phase 3" }
  );
  assert(!md.includes("—"), "no em dash in output");
  assert(!md.includes("–"), "no en dash in output");
  assertStringIncludes(md, "The team shipped the MVP, on time, and learned a lot.");
});

Deno.test("all four audiences build, each with the shared title + only known arcs", () => {
  const all = buildAllVersionOutlines(COMPONENTS);
  assertEquals(all.length, 4);
  assertEquals(
    all.map((v) => v.audience),
    [...HANDOFF_AUDIENCES]
  );
  for (const v of all) {
    assert(v.title.length > 0);
    for (const s of v.sections)
      assert(STORY_ARC_ORDER.includes(s.arc as (typeof STORY_ARC_ORDER)[number]));
  }
});
