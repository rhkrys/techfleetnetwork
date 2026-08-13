import { assert, assertEquals } from "jsr:@std/assert@1";
import { type ArcWriter, writeVersionPerArc } from "./write-version.ts";
import type { ComponentFactBase } from "./prompts.ts";
import type { OutlineComponent, VersionOutline } from "./assemble.ts";

function comp(slug: string, arc: string): OutlineComponent {
  return {
    slug,
    component: slug.toUpperCase(),
    storyArc: arc,
    directInput: false,
    deliverables: [],
  };
}

// Two arcs, two components each.
const OUTLINE: VersionOutline = {
  audience: "teammate",
  title: "Teammate Hand-Off",
  sections: [
    { arc: "Pre-amble", components: [comp("goals", "Pre-amble"), comp("client", "Pre-amble")] },
    {
      arc: "Part 1: Empathy Building",
      components: [comp("problems", "Part 1"), comp("research", "Part 1")],
    },
  ],
  includedCount: 4,
};

const FACTS: ComponentFactBase[] = [
  { slug: "goals", component: "GOALS", storyArc: "Pre-amble", facts: ["g1"] },
  { slug: "client", component: "CLIENT", storyArc: "Pre-amble", facts: ["c1"] },
  { slug: "problems", component: "PROBLEMS", storyArc: "Part 1", facts: ["p1"] },
  { slug: "research", component: "RESEARCH", storyArc: "Part 1", facts: ["r1"] },
];

// A writer that echoes each requested component's slug with trivial prose.
const echoWriter: ArcWriter = (_a, arcOutline) =>
  Promise.resolve(
    arcOutline.sections[0].components.map((c) => ({ slug: c.slug, markdown: `prose:${c.slug}` }))
  );

Deno.test("writes every arc and merges all components in outline order", async () => {
  const { written, failedArcs } = await writeVersionPerArc("teammate", OUTLINE, FACTS, echoWriter);
  assertEquals(failedArcs, []);
  assertEquals(
    written.map((w) => w.slug),
    ["goals", "client", "problems", "research"]
  );
  assertEquals(written[0].markdown, "prose:goals");
});

Deno.test("makes ONE writer call per arc, not one for the whole version", async () => {
  let calls = 0;
  const counting: ArcWriter = (a, o, f) => {
    calls++;
    return echoWriter(a, o, f);
  };
  await writeVersionPerArc("teammate", OUTLINE, FACTS, counting);
  assertEquals(calls, 2); // one per arc — the whole point of the fix
});

Deno.test(
  "a failing arc is isolated: other arcs still produce, failure is recorded (not silent)",
  async () => {
    const errs: string[] = [];
    const flaky: ArcWriter = (a, o, f) => {
      if (o.sections[0].arc === "Pre-amble")
        return Promise.reject(new Error("no structured output"));
      return echoWriter(a, o, f);
    };
    const { written, failedArcs } = await writeVersionPerArc(
      "teammate",
      OUTLINE,
      FACTS,
      flaky,
      (arc) => errs.push(arc)
    );
    assertEquals(failedArcs, ["Pre-amble"]);
    assertEquals(errs, ["Pre-amble"]); // onArcError fired -> caller can log the degradation
    assertEquals(
      written.map((w) => w.slug),
      ["problems", "research"]
    ); // Part 1 survived
  }
);

Deno.test("each arc receives ONLY its own facts (small, bounded prompt)", async () => {
  const seen: Record<string, string[]> = {};
  const spy: ArcWriter = (a, o, facts) => {
    seen[o.sections[0].arc] = facts.map((f) => f.slug);
    return echoWriter(a, o, facts);
  };
  await writeVersionPerArc("teammate", OUTLINE, FACTS, spy);
  assertEquals(seen["Pre-amble"], ["goals", "client"]);
  assertEquals(seen["Part 1: Empathy Building"], ["problems", "research"]);
});

Deno.test("drops a slug a model echoes that belongs to no component in the arc", async () => {
  const leaky: ArcWriter = (_a, o) => {
    const mine = o.sections[0].components.map((c) => ({
      slug: c.slug,
      markdown: `prose:${c.slug}`,
    }));
    // A model hallucinates an extra entry whose slug is not in THIS arc (here, in no arc at all).
    return Promise.resolve([...mine, { slug: "ghost", markdown: "LEAK not in the outline" }]);
  };
  const { written } = await writeVersionPerArc("teammate", OUTLINE, FACTS, leaky);
  assert(!written.some((w) => w.slug === "ghost"), "foreign/hallucinated slug must be dropped");
  assertEquals(
    written.map((w) => w.slug),
    ["goals", "client", "problems", "research"]
  );
});

Deno.test("empty outline yields empty result, no failures", async () => {
  const empty: VersionOutline = {
    audience: "client",
    title: "Client Hand-Off",
    sections: [],
    includedCount: 0,
  };
  const { written, failedArcs } = await writeVersionPerArc("client", empty, [], echoWriter);
  assertEquals(written, []);
  assertEquals(failedArcs, []);
});
