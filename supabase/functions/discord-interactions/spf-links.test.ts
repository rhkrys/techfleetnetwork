// Regression: the /fleety Discord bot must never surface internal KB identifiers (framework://…) as
// links — it must resolve SPF entities to their public GitHub Pages explore page, or drop the link.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { frameworkEntityId, publicKbUrl, spfPageUrl, stripInternalLinks } from "./spf-links.ts";

const ID = "ff0ec515-481f-4e33-a383-7e018c9d73ac";
const map = new Map([[ID, { entity_type: "skill", slug: "problem-statements" }]]);
const PUBLIC =
  "https://techfleetworks.github.io/skills-and-practices-framework/explore/?e=skill#item/problem-statements";

Deno.test("frameworkEntityId pulls the UUID from an internal entity url", () => {
  assertEquals(frameworkEntityId(`framework://entity/skills/${ID}`), ID);
  assertEquals(frameworkEntityId("https://guide.techfleet.org/x"), null);
  assertEquals(frameworkEntityId("framework://Team-Practices"), null);
});

Deno.test("publicKbUrl resolves a known entity to its public explore page", () => {
  assertEquals(publicKbUrl(`framework://entity/skills/${ID}`, map), PUBLIC);
});

Deno.test(
  "publicKbUrl drops the link for an unresolvable/internal url (never leaks framework://)",
  () => {
    assertEquals(publicKbUrl(`framework://entity/skills/${ID}`, new Map()), null);
    assertEquals(publicKbUrl("csv://reference/x", map), null);
    assertEquals(publicKbUrl("framework://Team-Practices", map), null);
  }
);

Deno.test("publicKbUrl passes real public urls through untouched", () => {
  assertEquals(
    publicKbUrl("https://guide.techfleet.org/agile", map),
    "https://guide.techfleet.org/agile"
  );
  assertEquals(publicKbUrl(null, map), null);
});

Deno.test("spfPageUrl matches the web Fleety 2.0 scheme", () => {
  assertEquals(spfPageUrl("skill", "problem-statements"), PUBLIC);
  assertEquals(spfPageUrl("skill", undefined), null);
});

Deno.test("stripInternalLinks removes any residual internal-scheme links from model output", () => {
  assertEquals(
    stripInternalLinks(`See [Problem Statements](framework://entity/skills/${ID}) for detail.`),
    "See Problem Statements for detail."
  );
  assertEquals(stripInternalLinks("ref (csv://reference/x) here"), "ref  here");
  assertEquals(stripInternalLinks(`bare framework://entity/skills/${ID} end`), "bare  end");
});
