import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  type BoardSection,
  buildMappingPrompt,
  type ComponentTargets,
  isTemplateSection,
  prefilterSections,
  resolveSections,
} from "./mapper.ts";

Deno.test("isTemplateSection rejects scaffolding, reference lists, and hand-off outputs", () => {
  assert(isTemplateSection("UX RESEARCH ANALYSIS WORKSHOP INSTRUCTIONS"), "instructions");
  assert(isTemplateSection("EXAMPLE Create the MMP Release-Level Vision Board"), "example");
  assert(isTemplateSection("Experience Design Milestone"), "milestone reference list");
  assert(isTemplateSection("Deliverables for Web-Based Projects"), "deliverables-for reference");
  assert(isTemplateSection("Team-Facing Hand Off"), "the output itself");
  assert(isTemplateSection("ENTER YOUR PROJECT GOALS"), "blank prompt");
  // real work sections are KEPT
  assert(!isTemplateSection("MX PROJECT GOALS", "robust data on needs"), "real work kept");
  assert(
    !isTemplateSection("ORG-LEVEL KPIs", "business measurements of success"),
    "real work kept"
  );
  assert(!isTemplateSection("CRAZY 8'S SKETCHING"), "real work kept");
});

Deno.test(
  "prefilterSections surfaces the right sections via NAME or TEXT overlap, drops the rest",
  () => {
    const kpi: ComponentTargets = {
      slug: "kpi",
      component: "Key performance indicators",
      description: "success measurements",
      workshops: ["KPI Success Measurements Definition Workshop"],
      deliverables: ["Key Performance Indicators"],
      activities: ["define success measurements"],
    };
    const sections: BoardSection[] = [
      { nodeId: "1", name: "ORG-LEVEL KPIs", text: "business measurements of success for the org" },
      {
        nodeId: "2",
        name: "CUSTOMER-LEVEL KPIs",
        text: "success measurements per audience outcome",
      },
      { nodeId: "3", name: "Crazy 8's Sketching", text: "eight idea sketches for the HMW" }, // unrelated
      { nodeId: "4", name: "Section 12", text: "the team measured success via these indicators" }, // matches by TEXT, not name
      { nodeId: "5", name: "Team Ice Breakers", text: "two truths and a lie" }, // unrelated
    ];
    const got = prefilterSections(kpi, sections, 45).map((s) => s.nodeId);
    assert(got.includes("1"), "org-level surfaced by name");
    assert(got.includes("2"), "customer-level surfaced by name");
    assert(got.includes("4"), "surfaced by TEXT overlap even though name is 'Section 12'");
    assert(!got.includes("5"), "unrelated section dropped");
  }
);

const SECTIONS: BoardSection[] = [
  { nodeId: "1:1", name: "Crazy 8's Sketching" },
  { nodeId: "1:2", name: "UX Research Analysis" },
  { nodeId: "1:3", name: "Resulting Site Map" },
  { nodeId: "1:4", name: "Working Agreements" },
];

const UX_DESIGN: ComponentTargets = {
  slug: "ux",
  component: "UX design work",
  description: "prototypes, interaction design, design specs",
  workshops: ["Rapid Ideation Workshop"],
  deliverables: ["Wireframes", "Sketches", "Low-Fidelity Prototypes"],
  activities: ["rapid ideation", "interaction design"],
};

Deno.test(
  "buildMappingPrompt grounds the choice in SPF workshops/deliverables and lists the sections",
  () => {
    const p = buildMappingPrompt(UX_DESIGN, SECTIONS);
    const sys = p.messages[0].content;
    const user = p.messages[1].content;
    assert(sys.includes("by MEANING"));
    assert(sys.includes("NOT by whether the section name contains the component's title words"));
    assertEquals(p.toolName, "emit_mapping");
    // the SPF targets are what the model matches against
    assert(user.includes("Rapid Ideation Workshop"));
    assert(user.includes("Wireframes, Sketches, Low-Fidelity Prototypes"));
    // the candidate sections are enumerated
    assert(user.includes("Crazy 8's Sketching"));
    assert(user.includes("UX Research Analysis"));
  }
);

Deno.test(
  "resolveSections maps chosen names back to node ids (case-insensitive), dedupes, drops unknowns",
  () => {
    const chosen = [
      { name: "crazy 8's sketching", confidence: 0.9 }, // case-insensitive hit
      { name: "Resulting Site Map", confidence: 0.7 },
      { name: "Resulting Site Map", confidence: 0.5 }, // duplicate -> dropped
      { name: "A Section That Does Not Exist", confidence: 0.99 }, // not in list -> dropped
    ];
    const out = resolveSections(chosen, SECTIONS);
    assertEquals(
      out.map((o) => o.nodeId),
      ["1:1", "1:3"]
    );
    assertEquals(out[0].confidence, 0.9);
  }
);

Deno.test("resolveSections returns empty when nothing matches", () => {
  assertEquals(resolveSections([{ name: "nope", confidence: 1 }], SECTIONS), []);
});
