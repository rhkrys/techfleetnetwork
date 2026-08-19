import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dedupeSources, formatSourceLabel } from "@/lib/fleety/sources";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/**
 * Guards the "Fleety only sent links" fix. Root cause was two things: (1) the old prettyUrl showed
 * only host+path, so every SPF deep-link (.../explore/?e=<type>#item/<slug>) rendered as the SAME
 * string — five identical-looking links; and (2) the Sources block filled the embed and rendered
 * before the answer, so members never saw the answer. Now all three surfaces render the shared
 * <FleetySources> (collapsed, deduped, per-entity labels) gated on the answer having content.
 */
describe("formatSourceLabel distinguishes SPF deep-links", () => {
  it("labels an SPF explore deep-link by its entity, not the shared base path", () => {
    const a = formatSourceLabel(
      "https://techfleetworks.github.io/skills-and-practices-framework/explore/?e=skill#item/facilitation"
    );
    const b = formatSourceLabel(
      "https://techfleetworks.github.io/skills-and-practices-framework/explore/?e=practice#item/psychological-safety"
    );
    expect(a).not.toBe(b); // the OLD bug made these identical
    expect(a.toLowerCase()).toContain("facilitation");
    expect(b.toLowerCase()).toContain("psychological safety");
  });
  it("falls back to host + last segment for non-SPF links", () => {
    expect(formatSourceLabel("https://guide.techfleet.org/agile/scrum-events")).toContain(
      "scrum events"
    );
  });
  it("never throws on a malformed url", () => {
    expect(formatSourceLabel("not a url")).toBe("not a url");
  });
});

describe("dedupeSources drops exact duplicates, preserves order", () => {
  it("collapses repeats", () => {
    expect(dedupeSources(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });
});

const SURFACES = [
  "src/pages/ChatPage.tsx",
  "src/components/FleetyChatWidget.tsx",
  "src/components/resources/GuidanceEmbed.tsx",
];

describe("all chat surfaces render the shared Sources control, gated on answer content", () => {
  for (const path of SURFACES) {
    describe(path, () => {
      const src = read(path);
      it("still reads the X-Fleety-Sources guarantee header (D-08)", () => {
        expect(src).toMatch(/headers\.get\(["']X-Fleety-Sources["']\)/);
      });
      it("uses <FleetySources> (no per-surface source list)", () => {
        expect(src).toMatch(/from ["']@\/components\/fleety\/FleetySources["']/);
        expect(src).toMatch(/<FleetySources\s+urls=/);
      });
      it("gates sources on the answer having content (answer shows first)", () => {
        expect(src).toMatch(/msg\.content\.length > 0 && <FleetySources/);
      });
      it("no longer hand-rolls the '📚 Sources' block", () => {
        expect(src).not.toMatch(/📚 Sources/);
      });
    });
  }
});

describe("FleetySources renders safe, collapsed citations (D-08 guarantee preserved)", () => {
  const src = read("src/components/fleety/FleetySources.tsx");
  it("opens links safely in a new tab", () => {
    expect(src).toMatch(/rel=["']noopener noreferrer["']/);
    expect(src).toMatch(/target=["']_blank["']/);
  });
  it("is collapsed by default so the answer is what shows first", () => {
    expect(src).toMatch(/<details/);
  });
  it("labels + dedupes via the shared helpers", () => {
    expect(src).toMatch(/formatSourceLabel/);
    expect(src).toMatch(/dedupeSources/);
  });
});
