// Unit tests for the pure SPF->KB content builder in supabase/functions/fleety-embed
// (spf-kb.ts). No network/DB — runs in deno-check CI.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSpfKbRow,
  groupSteps,
  parseWorkshopStep,
  spfEntityUrl,
  type SpfRow,
} from "./spf-kb.ts";

Deno.test("spfEntityUrl builds a type-disambiguated, still-navigable deep-link", () => {
  const url = spfEntityUrl("workshop", "rapid-ideation-workshop-template");
  assertEquals(
    url,
    "https://techfleetworks.github.io/skills-and-practices-framework/explore/?e=workshop#item/rapid-ideation-workshop-template"
  );
  // The SPA routes on location.hash, which is everything after '#' — byte-identical to the
  // slug-only link — so navigation is unchanged while the URL is unique per (type, slug).
  assertEquals(new URL(url).hash, "#item/rapid-ideation-workshop-template");
});

Deno.test("spfEntityUrl: same slug across types yields DISTINCT urls (collision fix)", () => {
  // The bug: a slug-only URL collided distinct entities onto one KB row (data loss + no
  // convergence). Different types must now produce different urls.
  const skill = spfEntityUrl("skill", "facilitation");
  const practice = spfEntityUrl("practice", "facilitation");
  assert(skill !== practice, "same slug, different type must not collide");
  // ...but both still open the same underlying entity page (same hash route).
  assertEquals(new URL(skill).hash, new URL(practice).hash);
});

Deno.test("parseWorkshopStep pulls the parent workshop slug + ordered step fields", () => {
  const { workshopSlug, step } = parseWorkshopStep({
    Workshop: [{ slug: "rapid-ideation-workshop-template", label: "Rapid Ideation" }],
    Order: "1",
    "Step Title": "Set the context",
    "Do This Now": "Write why this work came about.",
    "Output of This Step": "A shared context statement.",
    "Done When": "The team agrees why it matters.",
    "Time Box": "~5 min",
  });
  assertEquals(workshopSlug, "rapid-ideation-workshop-template");
  assertEquals(step.order, 1);
  assertEquals(step.title, "Set the context");
  assert(step.doThisNow.includes("Write why"));
});

Deno.test("buildSpfKbRow folds ordered steps into the workshop row + deep-links it", () => {
  const stepRows: SpfRow[] = [
    {
      entity_type: "workshop_step",
      slug: "2",
      name: "2",
      description: null,
      data: {
        Workshop: [{ slug: "rapid-ideation", label: "Rapid Ideation" }],
        Order: "2",
        "Step Title": "Diverge",
        "Do This Now": "Generate many ideas.",
        "Output of This Step": "A wall of ideas.",
      },
    },
    {
      entity_type: "workshop_step",
      slug: "1",
      name: "1",
      description: null,
      data: {
        Workshop: [{ slug: "rapid-ideation", label: "Rapid Ideation" }],
        Order: "1",
        "Step Title": "Set the context",
        "Do This Now": "Write the so-what.",
      },
    },
  ];
  const steps = groupSteps(stepRows);
  const workshop: SpfRow = {
    entity_type: "workshop",
    slug: "rapid-ideation",
    name: "Rapid Ideation Workshop",
    description: "A fast ideation session.",
    data: {
      "Deliverable the Workshop Produces": [{ slug: "idea-list", label: "Idea List" }],
    },
  };
  const row = buildSpfKbRow(workshop, steps)!;
  assert(row);
  assertEquals(row.url, spfEntityUrl("workshop", "rapid-ideation"));
  assertEquals(row.title, "Workshop: Rapid Ideation Workshop");
  // Steps appear in ascending Order (1 before 2), not input order.
  const i1 = row.content.indexOf("Set the context");
  const i2 = row.content.indexOf("Diverge");
  assert(i1 > 0 && i2 > 0 && i1 < i2, "steps must be ordered 1 then 2");
  assert(row.content.includes("Idea List"), "produced deliverable is included");
  assert(row.content.includes("Steps to run this workshop"));
});

Deno.test(
  "buildSpfKbRow returns null for non-embedded types (steps are folded, not standalone)",
  () => {
    const stepRow: SpfRow = {
      entity_type: "workshop_step",
      slug: "9",
      name: "9",
      description: null,
      data: {},
    };
    assertEquals(buildSpfKbRow(stepRow), null);
  }
);

Deno.test("buildSpfKbRow renders a career-transition with a from->into title", () => {
  const row = buildSpfKbRow({
    entity_type: "career_transition",
    slug: "ux-design-from-academia",
    name: "UX Design from Academia",
    description: null,
    data: {
      "Target Field": "UX Design",
      "Transition From": "Academia",
      "First Steps": "Build a portfolio piece.",
      "Foundational Skills to Build": [{ slug: "research", label: "User Research" }],
      "Summary of the Gaps": "You need visual design reps.",
    },
  })!;
  assertEquals(row.url, spfEntityUrl("career_transition", "ux-design-from-academia"));
  assert(row.title.includes("into UX Design"));
  assert(row.title.includes("from Academia"));
  assert(row.content.includes("First steps: Build a portfolio piece."));
  assert(row.content.includes("User Research"));
});

Deno.test("buildSpfKbRow renders a milestone with its deliverables", () => {
  const row = buildSpfKbRow({
    entity_type: "project_milestone",
    slug: "discovery",
    name: "Discovery",
    description: "Understand the problem space.",
    data: {
      "All Deliverables In the Milestone": [
        { slug: "research-plan", label: "Research Plan" },
        { slug: "personas", label: "Personas" },
      ],
    },
  })!;
  assertEquals(row.title, "Milestone: Discovery");
  assert(row.content.includes("Research Plan"));
  assert(row.content.includes("Personas"));
});
