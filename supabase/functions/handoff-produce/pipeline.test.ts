import { assertEquals } from "jsr:@std/assert@1";
import {
  extractChunksBounded,
  fetchFigmaBounded,
  figmaMaterialBySlug,
  type FigmaSub,
  planFigmaFetch,
} from "./pipeline.ts";

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

// fetchFigmaBounded is the fix for "exceeded max recovery attempts": the pre-checkpoint Figma load
// must stay within the worker's invocation limit no matter how many boards a run has.
Deno.test("fetchFigmaBounded fetches every file when within budget", async () => {
  const byFile = new Map<string, string[]>([
    ["A", ["1:1"]],
    ["B", ["2:2"]],
    ["C", ["3:3"]],
  ]);
  const calls: string[] = [];
  const { nodeTextByFile, skipped } = await fetchFigmaBounded(
    byFile,
    (fileKey, ids) => {
      calls.push(fileKey);
      return Promise.resolve({ [ids[0]]: [`text-${fileKey}`] });
    },
    { concurrency: 2, budgetMs: 10_000, now: () => 0 }
  );
  assertEquals(skipped, 0);
  assertEquals(nodeTextByFile.size, 3);
  assertEquals(nodeTextByFile.get("A"), { "1:1": ["text-A"] });
  assertEquals(calls.sort(), ["A", "B", "C"]);
});

Deno.test(
  "fetchFigmaBounded skips every board once the budget is spent (never overruns the tick)",
  async () => {
    const byFile = new Map<string, string[]>([
      ["A", ["1:1"]],
      ["B", ["2:2"]],
    ]);
    let fetched = 0;
    const { nodeTextByFile, skipped } = await fetchFigmaBounded(
      byFile,
      () => {
        fetched++;
        return Promise.resolve({});
      },
      { concurrency: 4, budgetMs: 0, now: () => 1000 } // deadline already reached
    );
    assertEquals(fetched, 0); // nothing fetched — no overrun
    assertEquals(skipped, 2);
    assertEquals(nodeTextByFile.size, 0);
  }
);

Deno.test(
  "fetchFigmaBounded isolates a failing board via onError and returns the rest",
  async () => {
    const byFile = new Map<string, string[]>([
      ["OK", ["1:1"]],
      ["BAD", ["2:2"]],
    ]);
    const errors: string[] = [];
    const { nodeTextByFile, skipped } = await fetchFigmaBounded(
      byFile,
      (fileKey, ids) => {
        if (fileKey === "BAD") return Promise.reject(new Error("boom"));
        return Promise.resolve({ [ids[0]]: [`text-${fileKey}`] });
      },
      { concurrency: 1, budgetMs: 10_000, now: () => 0, onError: (fk) => errors.push(fk) }
    );
    assertEquals(skipped, 0);
    assertEquals(errors, ["BAD"]);
    assertEquals(nodeTextByFile.size, 1);
    assertEquals(nodeTextByFile.get("OK"), { "1:1": ["text-OK"] });
  }
);

// extractChunksBounded is the fix for the EXTRACT-stage "exceeded max recovery attempts": a component
// with many chunks (a ~200 KB board is ~17) must extract within the worker's invocation budget instead
// of running unbounded sequential LLM calls that kill the worker mid-step every tick (cursor=extract,
// facts pinned) until the recovery cap fails the run.
Deno.test(
  "extractChunksBounded extracts every chunk within budget, preserving chunk order",
  async () => {
    const { perChunk, skipped } = await extractChunksBounded(
      ["c0", "c1", "c2"],
      (chunk, i) => Promise.resolve([`fact-${i}-${chunk}`]),
      { concurrency: 2, budgetMs: 10_000, now: () => 0 }
    );
    assertEquals(skipped, 0);
    // Index-preserved regardless of the pool's completion order (keeps merge deterministic).
    assertEquals(perChunk, [["fact-0-c0"], ["fact-1-c1"], ["fact-2-c2"]]);
  }
);

Deno.test(
  "extractChunksBounded skips remaining chunks once the budget is spent (never overruns the tick)",
  async () => {
    let ran = 0;
    const { perChunk, skipped } = await extractChunksBounded(
      ["c0", "c1", "c2"],
      () => {
        ran++;
        return Promise.resolve(["x"]);
      },
      { concurrency: 4, budgetMs: 0, now: () => 1000 } // deadline already reached
    );
    assertEquals(ran, 0); // nothing started — no overrun
    assertEquals(skipped, 3);
    assertEquals(perChunk, [[], [], []]); // the component keeps whatever facts it already had (none here)
  }
);

Deno.test(
  "extractChunksBounded isolates a failing chunk via onError and keeps the rest",
  async () => {
    const errors: number[] = [];
    const { perChunk, skipped } = await extractChunksBounded(
      ["c0", "c1", "c2"],
      (_chunk, i) => (i === 1 ? Promise.reject(new Error("boom")) : Promise.resolve([`ok-${i}`])),
      { concurrency: 1, budgetMs: 10_000, now: () => 0, onError: (i) => errors.push(i) }
    );
    assertEquals(skipped, 0);
    assertEquals(errors, [1]); // the failed chunk is isolated
    assertEquals(perChunk, [["ok-0"], [], ["ok-2"]]); // its neighbors still contribute
  }
);
