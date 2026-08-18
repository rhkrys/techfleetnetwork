import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { figmaNodesToText, parseFigmaKey } from "./figma-extract.ts";

Deno.test("parseFigmaKey: reads key from file/design/board/proto URLs", () => {
  assertEquals(
    parseFigmaKey("https://www.figma.com/file/abc123XYZ/My-Board?node-id=1-2"),
    "abc123XYZ"
  );
  assertEquals(parseFigmaKey("https://figma.com/design/KEY45678/Spec"), "KEY45678");
  assertEquals(parseFigmaKey("https://www.figma.com/board/FIGJAMkey1/Ideas"), "FIGJAMkey1");
  assertEquals(parseFigmaKey("https://www.figma.com/proto/PROTOkey1/Flow"), "PROTOkey1");
});

Deno.test("parseFigmaKey: rejects non-figma and non-file figma URLs", () => {
  assertEquals(parseFigmaKey("https://evil.com/file/abc123XYZ/x"), null);
  assertEquals(parseFigmaKey("https://www.figma.com/pricing"), null);
  assertEquals(parseFigmaKey("not a url"), null);
  // Host-spoof guard: "figma.com" must be the real suffix, not a substring of the host.
  assertEquals(parseFigmaKey("https://figma.com.evil.com/file/abc123XYZ/x"), null);
});

Deno.test("figmaNodesToText: extracts TEXT characters and container headings in order", () => {
  const file = {
    name: "Discovery Board",
    document: {
      type: "DOCUMENT",
      children: [
        {
          type: "CANVAS",
          name: "Page 1",
          children: [
            {
              type: "FRAME",
              name: "Problem Statement",
              children: [
                { type: "TEXT", name: "t1", characters: "Users can't find the docs." },
                { type: "TEXT", name: "t2", characters: "" },
              ],
            },
          ],
        },
      ],
    },
  };
  const text = figmaNodesToText(file);
  assertEquals(text.includes("# Discovery Board"), true);
  assertEquals(text.includes("Problem Statement"), true);
  assertEquals(text.includes("Users can't find the docs."), true);
});

Deno.test("figmaNodesToText: is bounded by maxChars", () => {
  const big = "x".repeat(500);
  const file = {
    name: "Big",
    document: {
      type: "CANVAS",
      name: "P",
      children: Array.from({ length: 50 }, (_, i) => ({
        type: "TEXT",
        name: `t${i}`,
        characters: big,
      })),
    },
  };
  const text = figmaNodesToText(file, 1000);
  assertEquals(text.length <= 1000, true);
});

Deno.test("figmaNodesToText: tolerates malformed input", () => {
  assertEquals(figmaNodesToText(null), "");
  assertEquals(figmaNodesToText(42), "");
  assertEquals(figmaNodesToText({ document: { children: "nope" } }), "");
});
