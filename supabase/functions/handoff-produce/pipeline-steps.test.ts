import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildRunPlan,
  type Cursor,
  driveRun,
  firstCursor,
  firstWriteCursor,
  initialState,
  type PipelineState,
  runGaps,
  type StepEffects,
} from "./pipeline-steps.ts";
import type { HandoffComponent } from "./assemble.ts";
import type { ComponentFactBase } from "./prompts.ts";

// Three components, all in the Teammate version, across two arcs (Pre-amble x2, Part 1 x1).
function comp(slug: string, arc: string): HandoffComponent {
  return {
    slug,
    Component: slug.toUpperCase(),
    "Hand-Off Story Arc": arc,
    "Is this in the Teammate Hand-off?": "Yes",
    "Is this in the Client Hand-Off?": "No",
    "Is this in the Teammate Case Study?": "No",
    "Is this in the Tech Fleet Org Case Study?": "No",
  } as HandoffComponent;
}
const COMPONENTS = [
  comp("goals", "Pre-amble"),
  comp("client", "Pre-amble"),
  comp("problems", "Part 1: Empathy Building"),
];

function fakeEffects(sink: {
  extracts: string[];
  finals: Array<{ audience: string; count: number }>;
}): StepEffects {
  return {
    ingestFigma: () => Promise.resolve(),
    extractFacts: (c) => {
      sink.extracts.push(c.slug);
      return Promise.resolve({
        slug: c.slug,
        component: String(c.Component),
        storyArc: String(c["Hand-Off Story Arc"]),
        facts: [`f-${c.slug}`],
      });
    },
    writeArc: (unit) =>
      Promise.resolve(
        unit.outline.sections[unit.arcIndex].components.map((cc) => ({
          slug: cc.slug,
          markdown: `w-${cc.slug}`,
        }))
      ),
    finalize: (unit, written) => {
      sink.finals.push({ audience: unit.audience, count: written.length });
      return Promise.resolve();
    },
  };
}
const always = {
  shouldContinue: () => true,
  checkpoint: (_s: PipelineState) => Promise.resolve(true),
};

Deno.test("buildRunPlan derives ordered units purely from the components", () => {
  const plan = buildRunPlan(COMPONENTS, []);
  assertEquals(plan.extract.length, 3);
  assertEquals(plan.write.length, 2); // two arcs for the teammate audience
  assertEquals(plan.finalize.length, 1); // only the teammate version has content
  assertEquals(plan.write[0].audience, "teammate");
  assertEquals(plan.write[0].arcIndex, 0);
});

Deno.test("buildRunPlan scopes a targeted re-create to the requested audiences", () => {
  const all = buildRunPlan(COMPONENTS, []);
  // Fixtures are teammate-only, so scoping to 'teammate' equals the full plan...
  const teammateOnly = buildRunPlan(COMPONENTS, [], ["teammate"]);
  assertEquals(
    teammateOnly.finalize.map((f) => f.audience),
    ["teammate"]
  );
  assertEquals(teammateOnly.write.length, all.write.length);
  // ...and scoping to an audience with no included components yields an empty plan (nothing re-writes).
  const clientOnly = buildRunPlan(COMPONENTS, [], ["client"]);
  assertEquals(clientOnly.finalize.length, 0);
  assertEquals(clientOnly.write.length, 0);
});

Deno.test("firstWriteCursor skips extraction (writer-only) or ends when nothing to write", () => {
  assertEquals(firstWriteCursor(buildRunPlan(COMPONENTS, [])), { stage: "write", i: 0 });
  assertEquals(firstWriteCursor(buildRunPlan(COMPONENTS, [], ["client"])), { stage: "done" });
});

Deno.test(
  "ingest units run FIRST, are checkpointed, and a writer-only re-create skips them",
  async () => {
    const ingest = [{ fileKey: "ABC", nodeIds: ["1:1"] }];
    const plan = buildRunPlan(COMPONENTS, ingest);
    assertEquals(plan.ingest.length, 1);
    assertEquals(firstCursor(plan), { stage: "ingest", i: 0 }); // a fresh full run starts at ingest

    const seen: string[] = [];
    const sink = {
      extracts: [] as string[],
      finals: [] as Array<{ audience: string; count: number }>,
    };
    const eff: StepEffects = {
      ...fakeEffects(sink),
      ingestFigma: (f) => {
        seen.push(f.fileKey);
        return Promise.resolve();
      },
    };
    const start: PipelineState = { cursor: firstCursor(plan), factBase: [], written: {} };
    const { stopped } = await driveRun(start, plan, eff, always);
    assertEquals(stopped, "done");
    assertEquals(seen, ["ABC"]); // the board was ingested...
    assertEquals(sink.extracts, ["goals", "client", "problems"]); // ...before extraction ran

    // A writer-only re-create carries no ingest (it reuses the persisted fact base + extracted_text).
    assertEquals(buildRunPlan(COMPONENTS, ingest, ["teammate"]).ingest.length, 0);
  }
);

Deno.test("driveRun runs a fresh run to completion in unit order", async () => {
  const sink = {
    extracts: [] as string[],
    finals: [] as Array<{ audience: string; count: number }>,
  };
  const plan = buildRunPlan(COMPONENTS, []);
  const { state, stopped } = await driveRun(initialState(), plan, fakeEffects(sink), always);
  assertEquals(stopped, "done");
  assertEquals(sink.extracts, ["goals", "client", "problems"]); // all extracted, in order
  assertEquals(state.factBase.length, 3);
  assertEquals(
    state.written.teammate.map((w) => w.slug),
    ["goals", "client", "problems"]
  );
  assertEquals(sink.finals, [{ audience: "teammate", count: 3 }]); // finalized once, with all prose
});

Deno.test(
  "driveRun RESUMES from a persisted mid-run cursor without re-running earlier units",
  async () => {
    const sink = {
      extracts: [] as string[],
      finals: [] as Array<{ audience: string; count: number }>,
    };
    const plan = buildRunPlan(COMPONENTS, []);
    // State as if a prior worker finished extraction + the first write arc, then died.
    const resumed: PipelineState = {
      cursor: { stage: "write", i: 1 } as Cursor,
      factBase: COMPONENTS.map(
        (c) =>
          ({
            slug: c.slug,
            component: String(c.Component),
            storyArc: String(c["Hand-Off Story Arc"]),
            facts: [`f-${c.slug}`],
          }) as ComponentFactBase
      ),
      written: {
        teammate: [
          { slug: "goals", markdown: "w-goals" },
          { slug: "client", markdown: "w-client" },
        ],
      },
    };
    const { state, stopped } = await driveRun(resumed, plan, fakeEffects(sink), always);
    assertEquals(stopped, "done");
    assertEquals(sink.extracts, []); // extraction NOT repeated — the expensive work is not redone
    assertEquals(
      state.written.teammate.map((w) => w.slug),
      ["goals", "client", "problems"]
    ); // only the last arc added
    assertEquals(sink.finals, [{ audience: "teammate", count: 3 }]);
  }
);

Deno.test(
  "driveRun stops early on the soft budget and reports 'budget' with partial state",
  async () => {
    const sink = {
      extracts: [] as string[],
      finals: [] as Array<{ audience: string; count: number }>,
    };
    const plan = buildRunPlan(COMPONENTS, []);
    let allowed = 2; // let only two units run
    const { state, stopped } = await driveRun(initialState(), plan, fakeEffects(sink), {
      shouldContinue: () => allowed-- > 0,
      checkpoint: () => Promise.resolve(true),
    });
    assertEquals(stopped, "budget");
    assertEquals(sink.extracts.length, 2); // exactly two units did work
    assertEquals(state.cursor.stage, "extract"); // still mid-extract, ready to resume
  }
);

Deno.test(
  "driveRun stops immediately when the lease is lost (checkpoint returns false)",
  async () => {
    const sink = {
      extracts: [] as string[],
      finals: [] as Array<{ audience: string; count: number }>,
    };
    const plan = buildRunPlan(COMPONENTS, []);
    const { stopped } = await driveRun(initialState(), plan, fakeEffects(sink), {
      shouldContinue: () => true,
      checkpoint: () => Promise.resolve(false), // another worker took over
    });
    assertEquals(stopped, "lost-lease");
    assertEquals(sink.extracts.length, 1); // did one unit, checkpoint said "not yours", bailed
  }
);

Deno.test("runGaps: a fully written run reports zero gaps", async () => {
  const sink = {
    extracts: [] as string[],
    finals: [] as Array<{ audience: string; count: number }>,
  };
  const plan = buildRunPlan(COMPONENTS, []);
  const { state } = await driveRun(initialState(), plan, fakeEffects(sink), always);
  const gaps = runGaps(plan, state);
  assertEquals(gaps.total, 0);
  assertEquals(gaps.byAudience, {});
});

Deno.test(
  "runGaps: a degraded arc (writer returned nothing) counts each placeholder component, per audience",
  async () => {
    const plan = buildRunPlan(COMPONENTS, []);
    // Simulate the pipeline's own graceful degradation: the Part-1 arc fails and writeArc returns []
    // (as it does on a terminal LLM error). Its one component ('problems') then ships as
    // "_Awaiting content._" — exactly one visible gap in the teammate version.
    const degrading: StepEffects = {
      ...fakeEffects({ extracts: [], finals: [] }),
      writeArc: (unit) =>
        Promise.resolve(
          unit.outline.sections[unit.arcIndex].arc === "Part 1: Empathy Building"
            ? []
            : unit.outline.sections[unit.arcIndex].components.map((cc) => ({
                slug: cc.slug,
                markdown: `w-${cc.slug}`,
              }))
        ),
    };
    const { state } = await driveRun(initialState(), plan, degrading, always);
    const gaps = runGaps(plan, state);
    assertEquals(gaps.total, 1);
    assertEquals(gaps.byAudience, { teammate: 1 });
  }
);

Deno.test(
  "runGaps: empty-string prose is a gap too (mirrors the renderer's placeholder rule)",
  () => {
    const plan = buildRunPlan(COMPONENTS, []);
    // All three components 'written' but one is blank -> the renderer would show a placeholder for it.
    const state: PipelineState = {
      cursor: { stage: "done" },
      factBase: [],
      written: {
        teammate: [
          { slug: "goals", markdown: "real" },
          { slug: "client", markdown: "   " }, // whitespace only -> placeholder
          { slug: "problems", markdown: "real" },
        ],
      },
    };
    assertEquals(runGaps(plan, state).total, 1);
  }
);

Deno.test("driveRun drops a foreign slug a writer echoes from outside the arc", async () => {
  const sink = {
    extracts: [] as string[],
    finals: [] as Array<{ audience: string; count: number }>,
  };
  const plan = buildRunPlan(COMPONENTS, []);
  const leaky: StepEffects = {
    ...fakeEffects(sink),
    writeArc: (unit) =>
      Promise.resolve([
        ...unit.outline.sections[unit.arcIndex].components.map((cc) => ({
          slug: cc.slug,
          markdown: `w-${cc.slug}`,
        })),
        { slug: "ghost", markdown: "not in this arc" },
      ]),
  };
  const { state } = await driveRun(initialState(), plan, leaky, always);
  assert(!state.written.teammate.some((w) => w.slug === "ghost"), "foreign slug must be dropped");
});
