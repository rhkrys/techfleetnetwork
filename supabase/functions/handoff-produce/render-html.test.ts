import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { escapeHtml, renderVersionHtml } from "./render-html.ts";
import { buildVersionOutline, type HandoffComponent } from "./assemble.ts";

const COMPONENTS: HandoffComponent[] = [
  {
    slug: "empathy-1",
    "Hand-Off Story Arc": "Part 1: Empathy Building",
    Component: "Problems",
    "Is this in the Client Hand-Off?": "Yes",
    "Is this in the Teammate Hand-off?": "Yes",
    "Is this in the Teammate Case Study?": "Yes",
    "Is this in the Tech Fleet Org Case Study?": "Yes",
    "From Which Deliverable Does This Information Come?": [
      { slug: "problem-statements", label: "Problem Statements" },
    ],
  },
];

Deno.test("escapeHtml neutralizes angle brackets, quotes, ampersands", () => {
  assertStringIncludes(
    escapeHtml(`<script>"a"&'b'`),
    "&lt;script&gt;&quot;a&quot;&amp;&#39;b&#39;"
  );
});

Deno.test("renderVersionHtml produces a self-contained branded print document", () => {
  const outline = buildVersionOutline("client", COMPONENTS);
  const html = renderVersionHtml(
    outline,
    [{ slug: "empathy-1", markdown: "People could not find pricing.\n\n- pain one\n- pain two" }],
    { projectName: "Acme", phase: "phase_1", generatedLabel: "Generated from SPF v1." }
  );
  assertStringIncludes(html, "<!doctype html>");
  // SECURITY: strict CSP is emitted as defense-in-depth on top of escapeHtml/safeHref — no scripts,
  // no remote fetches, so injected markup could neither execute nor exfiltrate.
  assertStringIncludes(html, `http-equiv="Content-Security-Policy"`);
  assertStringIncludes(html, "default-src 'none'");
  assertStringIncludes(html, "<title>Client Hand-Off</title>");
  assertStringIncludes(html, "@media print"); // print-optimized
  assertStringIncludes(html, "#0056A7"); // Tech Fleet Blue brand token
  assertStringIncludes(html, "<h2>Part 1: Empathy Building</h2>"); // arc heading
  assertStringIncludes(html, "<h3>Problems</h3>"); // component subheading
  assertStringIncludes(html, "<h2>Milestones worked</h2>"); // top matter
  assertStringIncludes(html, "<p>People could not find pricing.</p>");
  assertStringIncludes(html, "<ul><li>pain one</li><li>pain two</li></ul>"); // bullets
  assertStringIncludes(html, "Acme");
});

Deno.test("renderVersionHtml renders numbered lists as <ol> (ordered/prioritized items)", () => {
  const outline = buildVersionOutline("client", COMPONENTS);
  const html = renderVersionHtml(outline, [
    {
      slug: "empathy-1",
      markdown: "We prioritized:\n\n1. first thing\n2. second thing\n3. third thing",
    },
  ]);
  assertStringIncludes(
    html,
    "<ol><li>first thing</li><li>second thing</li><li>third thing</li></ol>"
  );
});

Deno.test("SECURITY: LLM prose containing HTML/script is escaped, not rendered", () => {
  const outline = buildVersionOutline("client", COMPONENTS);
  const html = renderVersionHtml(outline, [
    {
      slug: "empathy-1",
      markdown: `<script>alert('xss')</script> and <img src=x onerror=alert(1)>`,
    },
  ]);
  assert(!html.includes("<script>alert"), "raw <script> must not survive");
  assert(!html.includes("<img src=x"), "raw <img> must not survive");
  assertStringIncludes(html, "&lt;script&gt;"); // escaped form present instead
});

Deno.test(
  "SECURITY: only **bold** becomes markup; other markdown stays literal escaped text",
  () => {
    const outline = buildVersionOutline("client", COMPONENTS);
    const html = renderVersionHtml(outline, [
      { slug: "empathy-1", markdown: "this is **important** but <b>this</b> is not" },
    ]);
    assertStringIncludes(html, "<strong>important</strong>");
    assert(!html.includes("<b>this</b>"), "raw <b> from the model must be escaped");
    assertStringIncludes(html, "&lt;b&gt;this&lt;/b&gt;");
  }
);

Deno.test(
  "SECURITY: links render only http(s) hrefs; javascript: URLs are dropped to plain text",
  () => {
    const outline = buildVersionOutline("client", COMPONENTS);
    const links = new Map([
      [
        "empathy-1",
        [
          { label: "Board node", url: "https://figma.com/board/x?node-id=1-2" },
          { label: "Evil", url: "javascript:alert(1)" },
        ],
      ],
    ]);
    const html = renderVersionHtml(outline, [{ slug: "empathy-1", markdown: "x" }], {}, links);
    assertStringIncludes(html, `<a href="https://figma.com/board/x?node-id=1-2">Board node</a>`);
    assert(!html.includes("javascript:alert"), "javascript: href must not render");
    assertStringIncludes(html, "<li>Evil</li>"); // shown as plain text, no href
  }
);

Deno.test("missing component prose gets an honest placeholder", () => {
  const outline = buildVersionOutline("client", COMPONENTS);
  const html = renderVersionHtml(outline, []);
  assertStringIncludes(html, "Awaiting content");
});
