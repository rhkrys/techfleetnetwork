import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  collectText,
  groupByContainer,
  type FigmaNode,
  normalizeNodeId,
  parseFigmaUrl,
} from "./figma.ts";

// A board section like a real FigJam node: content in many node types, plus decoration to skip.
const fixture: FigmaNode = {
  id: "1:1",
  type: "SECTION",
  name: "MX PROJECT GOALS",
  children: [
    { id: "1:2", type: "TEXT", characters: "Ship the MVP by Q3" },
    {
      id: "1:3",
      type: "STICKY",
      characters: "Define a new member strategy",
      name: "Define a new member strategy",
    },
    { id: "1:4", type: "SHAPE_WITH_TEXT", characters: "Client Intake" },
    { id: "1:5", type: "VECTOR", name: "Vector" }, // decoration -> skipped
    {
      id: "1:6",
      type: "GROUP",
      name: "Group 633165",
      children: [
        {
          id: "1:7",
          type: "TABLE",
          name: "Table",
          children: [
            { id: "1:8", type: "TABLE_CELL", characters: "Sprint Goal" },
            { id: "1:9", type: "TABLE_CELL", characters: "Outcome we want" },
          ],
        },
      ],
    },
    { id: "1:10", type: "CONNECTOR", characters: "leads to" },
    { id: "1:11", type: "CODE_BLOCK", code: "SELECT * FROM members" },
    { id: "1:12", type: "RECTANGLE", name: "Rectangle 18" }, // decoration -> skipped
    { id: "1:13", type: "LINK_UNFURL", name: "The Write Practice" }, // link title IS content
    { id: "1:14", type: "EMBED", name: "Fillout" }, // embed source IS content
    {
      id: "1:15",
      type: "TEXT",
      characters: "See the form",
      styleOverrideTable: { "1": { hyperlink: { url: "https://form.fillout.com/t/abc" } } },
    },
  ],
};

Deno.test("collectText captures content from ALL text-bearing types, wherever it lives", () => {
  const t = collectText(fixture);
  for (const kept of [
    "Ship the MVP by Q3",
    "Define a new member strategy",
    "Client Intake",
    "Sprint Goal",
    "Outcome we want",
    "leads to",
    "SELECT * FROM members",
    "The Write Practice",
    "Fillout",
    "https://form.fillout.com/t/abc",
  ]) {
    assert(t.includes(kept), `should capture: ${kept}`);
  }
});

Deno.test("collectText skips decoration node names (not content)", () => {
  const t = collectText(fixture).join(" | ");
  for (const junk of ["Vector", "Group 633165", "Rectangle 18"]) {
    assert(!t.includes(junk), `should NOT capture structural name: ${junk}`);
  }
});

Deno.test("collectText does not double-count when characters and name are the same", () => {
  assertEquals(collectText({ type: "STICKY", characters: "one goal", name: "one goal" }), [
    "one goal",
  ]);
});

Deno.test("groupByContainer buckets content under the nearest named section", () => {
  const groups = groupByContainer(fixture);
  assertEquals(groups.length, 1);
  assertEquals(groups[0].name, "MX PROJECT GOALS");
  assert(groups[0].text.includes("Sprint Goal")); // table content bucketed under the section
});

Deno.test("normalizeNodeId accepts the URL dash form and the API colon form", () => {
  assertEquals(normalizeNodeId("6720-8670"), "6720:8670");
  assertEquals(normalizeNodeId("6720:8670"), "6720:8670");
});

Deno.test("parseFigmaUrl extracts fileKey + nodeId and is host-locked (SSRF)", () => {
  const r = parseFigmaUrl(
    "https://www.figma.com/board/m7hgV5TPF6LI9j0eJvCaxP/Member-Experience?node-id=27-5104&t=abc"
  );
  assertEquals(r.fileKey, "m7hgV5TPF6LI9j0eJvCaxP");
  assertEquals(r.nodeId, "27:5104");
  assertThrows(
    () => parseFigmaUrl("https://evil.example.com/board/x?node-id=1-2"),
    Error,
    "figma.com"
  );
  assertThrows(() => parseFigmaUrl("http://www.figma.com/board/x"), Error, "https"); // not https
  assertThrows(() => parseFigmaUrl("https://www.figma.com/pricing"), Error, "file key"); // no file
});
