// Unit tests for the pure core of supabase/functions/guide-ingest (SSRF guard,
// llms.txt parser, markdown-URL derivation). No network — runs in deno-check CI.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertGuideUrlAllowed,
  chunkMarkdown,
  chunkUrl,
  GUIDE_ORIGIN,
  markdownUrlFor,
  parseLlmsTxt,
} from "./lib.ts";

Deno.test("chunkMarkdown: short text is one chunk; long text splits under the budget (A1)", () => {
  assertEquals(chunkMarkdown(""), []);
  assertEquals(chunkMarkdown("short page"), ["short page"]);
  const para = "para text here.";
  const long = Array.from({ length: 800 }, () => para).join("\n\n"); // ~12k chars
  const chunks = chunkMarkdown(long, 5500);
  assert(chunks.length > 1, "long page splits into multiple chunks");
  for (const c of chunks) assert(c.length <= 5500, "no chunk exceeds the budget");
  // no content lost (paragraph count preserved across chunks)
  const rejoined = chunks.join("\n\n");
  assertEquals(rejoined.split(para).length - 1, 800, "every paragraph survives chunking");
});

Deno.test("chunkMarkdown: a single over-budget paragraph is hard-split", () => {
  const huge = "x".repeat(12000);
  const chunks = chunkMarkdown(huge, 5500);
  assert(chunks.length >= 3, "one giant paragraph is hard-split");
  for (const c of chunks) assert(c.length <= 5500);
});

Deno.test("chunkUrl: chunk 0 keeps the page url; later chunks get #pN", () => {
  assertEquals(chunkUrl("https://guide.techfleet.org/x", 0), "https://guide.techfleet.org/x");
  assertEquals(chunkUrl("https://guide.techfleet.org/x", 1), "https://guide.techfleet.org/x#p2");
  assertEquals(chunkUrl("https://guide.techfleet.org/x", 4), "https://guide.techfleet.org/x#p5");
});

Deno.test("assertGuideUrlAllowed accepts https guide URLs, rejects everything else (SSRF)", () => {
  assertGuideUrlAllowed(`${GUIDE_ORIGIN}/get-started/welcome`);
  assertThrows(() => assertGuideUrlAllowed("http://guide.techfleet.org/x"), Error, "https");
  assertThrows(
    () => assertGuideUrlAllowed("https://evil.example.com/x"),
    Error,
    "host not allowed"
  );
  assertThrows(
    () => assertGuideUrlAllowed("https://guide.techfleet.org.evil.com/x"),
    Error,
    "host"
  );
  assertThrows(() => assertGuideUrlAllowed("not a url"), Error, "invalid");
});

Deno.test("markdownUrlFor appends .md, strips trailing slash, is idempotent", () => {
  assertEquals(
    markdownUrlFor(
      `${GUIDE_ORIGIN}/agile-training-portal/agile-handbook/agile-methods/scrum-method/what-is-scrum`
    ),
    `${GUIDE_ORIGIN}/agile-training-portal/agile-handbook/agile-methods/scrum-method/what-is-scrum.md`
  );
  assertEquals(markdownUrlFor(`${GUIDE_ORIGIN}/foo/`), `${GUIDE_ORIGIN}/foo.md`);
  assertEquals(markdownUrlFor(`${GUIDE_ORIGIN}/foo.md`), `${GUIDE_ORIGIN}/foo.md`);
});

Deno.test("parseLlmsTxt extracts on-host pages, dedupes, drops off-host + index + files", () => {
  const txt = [
    "# Tech Fleet User Guide",
    "- [Welcome](https://guide.techfleet.org/get-started/welcome): Start here",
    "- [Relative Page](/about-our-org/mission): About us",
    "- [Duplicate](https://guide.techfleet.org/get-started/welcome): dupe should be dropped",
    "- [External](https://youtu.be/abc): a video",
    "- [Index](https://guide.techfleet.org/llms.txt): the index itself",
    "- [Asset](https://guide.techfleet.org/files/Abc123): an image",
    "- [Bare](https://guide.techfleet.org/resources/glossary)",
  ].join("\n");

  const pages = parseLlmsTxt(txt);
  // Use exact-URL membership (Set.has / ===), never URL substring checks — both
  // because it's a stricter assertion and because substring URL checks trip
  // CodeQL's js/incomplete-url-substring-sanitization heuristic.
  const WELCOME = "https://guide.techfleet.org/get-started/welcome";
  const urlSet = new Set(pages.map((p) => p.url));

  assert(urlSet.has(WELCOME));
  assert(urlSet.has("https://guide.techfleet.org/about-our-org/mission")); // relative resolved
  assert(urlSet.has("https://guide.techfleet.org/resources/glossary")); // bare link
  assert(!urlSet.has("https://youtu.be/abc")); // off-host dropped
  assert(!urlSet.has("https://guide.techfleet.org/llms.txt")); // index dropped
  assert(!urlSet.has("https://guide.techfleet.org/files/Abc123")); // asset dropped
  // Deduped: welcome appears exactly once.
  assertEquals(pages.filter((p) => p.url === WELCOME).length, 1);
  // Title carried through.
  assertEquals(pages.find((p) => p.url === WELCOME)?.title, "Welcome");
});
