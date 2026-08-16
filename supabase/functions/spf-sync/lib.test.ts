// Unit tests for supabase/functions/spf-sync (pure sync core).
// Deno unit tests for the pure SPF-sync core (deno-check job, no network).
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertSpfUrlAllowed,
  entityTypeFor,
  normalizeDataset,
  normalizeRecord,
  SPF_ENTITY_TYPE,
} from "./lib.ts";
import { datasetUrls, SPF_DATASETS } from "../_shared/spf/contract.ts";
import handoffMap from "../_shared/spf/fixtures/handoff-deliverables-map.sample.json" with { type: "json" };

Deno.test("every pinned dataset has an entity_type mapping", () => {
  for (const key of Object.keys(SPF_DATASETS)) {
    assert(SPF_ENTITY_TYPE[key], `missing entity_type for ${key}`);
  }
  assertEquals(entityTypeFor("handoff-deliverables-map"), "handoff_component");
  assertEquals(entityTypeFor("deliverables"), "deliverable");
});

Deno.test("entityTypeFor rejects an unknown dataset", () => {
  assertThrows(() => entityTypeFor("nope"));
});

Deno.test("SSRF guard allows the real pinned SPF URLs (incl. multi-file datasets)", () => {
  for (const key of Object.keys(SPF_DATASETS)) {
    for (const url of datasetUrls(key)) {
      assertSpfUrlAllowed(url); // throws on failure
    }
  }
});

Deno.test("SSRF guard blocks non-https, wrong host, metadata IP, and bad path", () => {
  assertThrows(() =>
    assertSpfUrlAllowed("http://techfleetworks.github.io/skills-and-practices-framework/x.json")
  );
  assertThrows(() =>
    assertSpfUrlAllowed("https://evil.example.com/skills-and-practices-framework/x.json")
  );
  assertThrows(() => assertSpfUrlAllowed("https://169.254.169.254/latest/meta-data/"));
  assertThrows(() =>
    assertSpfUrlAllowed("https://techfleetworks.github.io/some-other-repo/x.json")
  );
  assertThrows(() => assertSpfUrlAllowed("not a url"));
});

Deno.test(
  "normalizeRecord maps the handoff map: Component is the name, Description the description, full record kept in data",
  () => {
    const rec = handoffMap[0] as Record<string, unknown>;
    const row = normalizeRecord("handoff-deliverables-map", rec);
    assertEquals(row.slug, "pre-amble");
    assertEquals(row.name, "Project goals"); // Component, not the repeated arc
    assertEquals(row.description, "The goals the phase was working toward");
    assertEquals(row.category, null);
    // full record preserved (lossless) — the audience flags survive in data
    assertEquals((row.data as Record<string, unknown>)["Is this in the Client Hand-Off?"], "No");
  }
);

Deno.test("normalizeDataset maps every record and preserves slugs", () => {
  const rows = normalizeDataset(
    "handoff-deliverables-map",
    handoffMap as Record<string, unknown>[]
  );
  assertEquals(rows.length, handoffMap.length);
  assert(rows.every((r) => r.slug.length > 0 && r.name.length > 0));
  assertEquals(rows[1].slug, "pre-amble-4");
});
