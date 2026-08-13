import { assertEquals } from "jsr:@std/assert@1";
import { figmaMaterialBySlug, type FigmaSub, planFigmaFetch } from "./pipeline.ts";

Deno.test(
  "planFigmaFetch batches node ids per file, dedupes, and skips non-figma/whole-file links",
  () => {
    const { byFile, subs } = planFigmaFetch([
      {
        component_slug: "goals",
        external_url: "https://www.figma.com/board/ABC/x?node-id=27-5104",
      },
      {
        component_slug: "client",
        external_url: "https://www.figma.com/board/ABC/x?node-id=6720-8670",
      },
      {
        component_slug: "goals",
        external_url: "https://www.figma.com/board/ABC/x?node-id=27-5104",
      }, // dupe id
      { component_slug: "problems", external_url: "https://www.figma.com/board/ABC/x" }, // no node -> skipped
      { component_slug: "notes", external_url: "https://evil.example.com/board/x?node-id=1-2" }, // not figma -> skipped
      { component_slug: "empty", external_url: null },
    ]);
    assertEquals(byFile.get("ABC")?.sort(), ["27:5104", "6720:8670"]); // dash form normalized to colon, deduped
    assertEquals(subs.length, 3); // goals x2 + client (whole-file + evil + null dropped)
    assertEquals(
      subs.every((s) => s.fileKey === "ABC"),
      true
    );
  }
);

Deno.test("figmaMaterialBySlug joins fetched node text back onto each component slug", () => {
  const subs: FigmaSub[] = [
    { slug: "goals", fileKey: "ABC", nodeId: "27:5104" },
    { slug: "client", fileKey: "ABC", nodeId: "6720:8670" },
    { slug: "missing", fileKey: "ABC", nodeId: "9:9" }, // no fetched text -> not present
  ];
  const nodeText = new Map<string, Record<string, string[]>>([
    [
      "ABC",
      {
        "27:5104": ["Ship the MVP", "Define strategy"],
        "6720:8670": ["Tech Fleet is a nonprofit"],
      },
    ],
  ]);
  const bySlug = figmaMaterialBySlug(subs, nodeText);
  assertEquals(bySlug.get("goals"), ["Ship the MVP", "Define strategy"]);
  assertEquals(bySlug.get("client"), ["Tech Fleet is a nonprofit"]);
  assertEquals(bySlug.has("missing"), false); // a node that returned nothing adds no material
});

Deno.test("figmaMaterialBySlug accumulates multiple figma submissions on one component", () => {
  const subs: FigmaSub[] = [
    { slug: "goals", fileKey: "ABC", nodeId: "1:1" },
    { slug: "goals", fileKey: "ABC", nodeId: "2:2" },
  ];
  const nodeText = new Map<string, Record<string, string[]>>([
    ["ABC", { "1:1": ["a"], "2:2": ["b"] }],
  ]);
  assertEquals(figmaMaterialBySlug(subs, nodeText).get("goals"), ["a", "b"]);
});
