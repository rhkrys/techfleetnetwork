// Audit T-D regression — escapeHtml neutralizes the 5 HTML-significant chars.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { escapeHtml } from "./escape-html.ts";

Deno.test("escapes all HTML-significant characters", () => {
  assertEquals(
    escapeHtml(`<img src=x onerror="alert('xss')">`),
    "&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;"
  );
});

Deno.test("escapes ampersand first (no double-encoding of entities)", () => {
  assertEquals(escapeHtml("Tom & Jerry <3"), "Tom &amp; Jerry &lt;3");
});

Deno.test("null/undefined -> empty string", () => {
  assertEquals(escapeHtml(null), "");
  assertEquals(escapeHtml(undefined), "");
});

Deno.test("plain text is unchanged", () => {
  assertEquals(escapeHtml("React 19 Fundamentals"), "React 19 Fundamentals");
});
