// Deno contract test for the pinned SPF v1 shape (runs in CI's deno-check job, no
// network). Fixtures are VERBATIM records captured from the live v1 API on 2026-08-10.
// If SPF ships a v2 that renames/removes a field the hand-off feature or graph rebuild
// depends on, this test (or the runtime validator it exercises) fails FIRST — a
// controlled, visible break instead of a silent production regression. See contract.ts.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  HANDOFF_AUDIENCE_FLAGS,
  HANDOFF_STORY_ARCS,
  SPF_DATASETS,
  SPF_VERSION,
  spfDatasetUrl,
  validateRecords,
} from "./contract.ts";
import handoffMap from "./fixtures/handoff-deliverables-map.sample.json" with { type: "json" };
import workshops from "./fixtures/workshops.sample.json" with { type: "json" };

const clone = <T>(x: T): T => structuredClone(x);

Deno.test("pinned to v1", () => {
  assertEquals(SPF_VERSION, "v1");
});

Deno.test("real handoff-deliverables-map records satisfy the contract", () => {
  const r = validateRecords("handoff-deliverables-map", handoffMap);
  assert(r.ok, `expected valid, got errors:\n${r.errors.join("\n")}`);
});

Deno.test("direct-input component (no deliverable/workshop link) is valid", () => {
  // Record id 4 is a direct-team-input row: the optional refArrays are absent.
  const directInput = handoffMap.filter((x) => x.slug === "pre-amble-4");
  assertEquals(directInput.length, 1);
  assert(validateRecords("handoff-deliverables-map", directInput).ok);
});

Deno.test("real workshops records satisfy the contract", () => {
  const r = validateRecords("workshops", workshops);
  assert(r.ok, `expected valid, got errors:\n${r.errors.join("\n")}`);
});

Deno.test("registry pins the story arc + the four audience flags", () => {
  const spec = SPF_DATASETS["handoff-deliverables-map"];
  for (const flag of HANDOFF_AUDIENCE_FLAGS) {
    assert(spec.required.includes(flag), `missing required flag: ${flag}`);
    assertEquals(spec.enums?.[flag], ["Yes", "No"]);
  }
  assertEquals(spec.enums?.["Hand-Off Story Arc"], HANDOFF_STORY_ARCS);
});

Deno.test("DRIFT: a renamed required field fails validation", () => {
  const drifted = clone(handoffMap);
  // Simulate a v2 rename: "Hand-Off Story Arc" -> "Story Arc".
  const rec = drifted[0] as Record<string, unknown>;
  rec["Story Arc"] = rec["Hand-Off Story Arc"];
  delete rec["Hand-Off Story Arc"];
  const r = validateRecords("handoff-deliverables-map", drifted);
  assert(!r.ok);
  assertStringIncludes(r.errors.join("\n"), "Hand-Off Story Arc");
});

Deno.test("DRIFT: an out-of-enum audience flag fails validation", () => {
  const drifted = clone(handoffMap);
  (drifted[0] as Record<string, unknown>)["Is this in the Client Hand-Off?"] = "yes";
  const r = validateRecords("handoff-deliverables-map", drifted);
  assert(!r.ok);
  assertStringIncludes(r.errors.join("\n"), "Is this in the Client Hand-Off?");
});

Deno.test("DRIFT: a malformed {slug,label} link fails validation", () => {
  const drifted = clone(handoffMap);
  (drifted[0] as Record<string, unknown>)["From Which Deliverable Does This Information Come?"] = [
    { slug: "project-plan" },
  ]; // missing label
  const r = validateRecords("handoff-deliverables-map", drifted);
  assert(!r.ok);
});

Deno.test("schema-evolution tolerance: an unknown NEW field is ignored", () => {
  const evolved = clone(handoffMap);
  (evolved[0] as Record<string, unknown>)["Some New v1.1 Field"] = 123;
  assert(validateRecords("handoff-deliverables-map", evolved).ok);
});

Deno.test("non-array payload is rejected (fail-closed)", () => {
  assert(!validateRecords("handoff-deliverables-map", { not: "an array" }).ok);
});

Deno.test("unknown dataset is rejected", () => {
  assert(!validateRecords("not-a-real-dataset", []).ok);
});

Deno.test("spfDatasetUrl builds the pinned v1 path", () => {
  assertEquals(
    spfDatasetUrl("handoff-deliverables-map"),
    "https://techfleetworks.github.io/skills-and-practices-framework/data/json/framework-data/handoff-deliverables-map.json"
  );
});
