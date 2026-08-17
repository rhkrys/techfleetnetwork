// @security — unit tests for the shared SSRF allow-list + URL extraction used by both
// fleety-review and techfleet-chat's in-chat "review my link". No network (runs in deno-check CI).
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertMaterialUrlAllowed,
  extractAllowedUrls,
  fetchMaterialText,
  isMaterialUrlAllowed,
} from "./material-fetch.ts";

Deno.test("allows Figma + Tech Fleet hosts over https (incl. figma subdomains)", () => {
  assertMaterialUrlAllowed("https://www.figma.com/file/abc/My-Deliverable");
  assertMaterialUrlAllowed("https://figma.com/board/xyz");
  assertMaterialUrlAllowed("https://api.figma.com/v1/files/abc");
  assertMaterialUrlAllowed("https://guide.techfleet.org/handbook");
  assertMaterialUrlAllowed("https://techfleetworks.github.io/skills-and-practices-framework/");
});

Deno.test("blocks SSRF vectors", () => {
  assertThrows(() => assertMaterialUrlAllowed("http://www.figma.com/x"), Error, "https");
  assertThrows(
    () => assertMaterialUrlAllowed("https://169.254.169.254/latest/meta-data/"),
    Error,
    "IP-literal"
  );
  assertThrows(() => assertMaterialUrlAllowed("https://[::1]/x"), Error, "IP-literal");
  assertThrows(() => assertMaterialUrlAllowed("https://user:pw@figma.com/x"), Error, "credentials");
  assertThrows(() => assertMaterialUrlAllowed("https://evil.com/x"), Error, "not allow-listed");
  // Suffix-spoof: allow-listed token appears but is not the registrable host.
  assertThrows(
    () => assertMaterialUrlAllowed("https://figma.com.evil.com/x"),
    Error,
    "not allow-listed"
  );
  assertThrows(
    () => assertMaterialUrlAllowed("https://guide.techfleet.org.evil.com/x"),
    Error,
    "not allow-listed"
  );
});

Deno.test("isMaterialUrlAllowed is the non-throwing predicate form", () => {
  assert(isMaterialUrlAllowed("https://www.figma.com/file/abc"));
  assert(!isMaterialUrlAllowed("https://evil.com"));
  assert(!isMaterialUrlAllowed("not a url"));
});

Deno.test(
  "extractAllowedUrls: only allow-listed https URLs, deduped, capped, punctuation-trimmed",
  () => {
    const text =
      "Here's my work https://www.figma.com/file/abc/persona. Also see https://evil.com/x " +
      "and https://guide.techfleet.org/page), plus a repeat https://www.figma.com/file/abc/persona.";
    const urls = extractAllowedUrls(text, 2);
    assertEquals(urls, [
      "https://www.figma.com/file/abc/persona",
      "https://guide.techfleet.org/page",
    ]);
  }
);

Deno.test("extractAllowedUrls: nothing when no allow-listed links present", () => {
  assertEquals(extractAllowedUrls("just a question about milestones, no link"), []);
  assertEquals(extractAllowedUrls("http://figma.com/x (not https)"), []);
});

Deno.test("fetchMaterialText refuses a disallowed URL BEFORE any network call", async () => {
  await assertRejects(() => fetchMaterialText("https://169.254.169.254/"), Error, "IP-literal");
  await assertRejects(() => fetchMaterialText("https://evil.com/x"), Error, "not allow-listed");
});
