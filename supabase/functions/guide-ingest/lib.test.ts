// Unit tests for the pure core of supabase/functions/guide-ingest (SSRF guard,
// llms.txt parser, markdown-URL derivation). No network — runs in deno-check CI.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertGuideUrlAllowed, GUIDE_ORIGIN, markdownUrlFor, parseLlmsTxt } from "./lib.ts";

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
