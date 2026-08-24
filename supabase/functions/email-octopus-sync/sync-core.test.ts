// Unit tests for the EO worker drain loop (PR 6c). All I/O faked. Run via ci.yml Edge unit gates.
//
// bdd-gate coverage (email-rearchitecture edge functions whose behavior is validated by CI guards +
// pgTAP rather than a co-located *.test.ts):
//   supabase/functions/email-octopus-sync             — this file (drain loop).
//   supabase/functions/handle-email-unsubscribe       — scope_aware_unsubscribe_test.sql (pgTAP).
//   supabase/functions/replay-email-dlq               — check-no-raw-email-enqueue.mjs (routes to v2).
//   supabase/functions/send-community-agreement-trigger — check-no-tier0-preference-gate.mjs.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runSyncCycle, type ClaimRow } from "./sync-core.ts";
import type { EoResult } from "../_shared/email-octopus/client.ts";

function row(email: string, over: Partial<ClaimRow> = {}): ClaimRow {
  return {
    email,
    user_id: "u",
    desired_status: "subscribed",
    fields: null,
    version: 1,
    attempts: 0,
    ...over,
  };
}
const ok: EoResult = { outcome: "synced", statusCode: 200, error: null };
const retry: EoResult = { outcome: "retry", statusCode: 429, error: "rate" };
const dead: EoResult = { outcome: "permanent_fail", statusCode: 422, error: "bad" };

/** A fake claim that hands out `rows` in batches, then empties. */
function dispenser(rows: ClaimRow[]) {
  let i = 0;
  return (batch: number) => {
    const slice = rows.slice(i, i + batch);
    i += slice.length;
    return Promise.resolve(slice);
  };
}

Deno.test("drains across batches until the queue is empty", async () => {
  const rows = Array.from({ length: 45 }, (_, n) => row(`u${n}@x.com`));
  const settled: string[] = [];
  const stats = await runSyncCycle({
    claim: dispenser(rows),
    push: () => Promise.resolve(ok),
    settle: (r) => {
      settled.push(r.email);
      return Promise.resolve();
    },
    claimBatch: 20,
    pauseMs: 0,
  });
  assertEquals(stats.processed, 45);
  assertEquals(stats.synced, 45);
  assertEquals(stats.batches, 3); // 20 + 20 + 5
  assertEquals(settled.length, 45);
});

Deno.test("respects maxPerRun and leaves the rest for the next cron tick", async () => {
  const rows = Array.from({ length: 100 }, (_, n) => row(`u${n}@x.com`));
  const stats = await runSyncCycle({
    claim: dispenser(rows),
    push: () => Promise.resolve(ok),
    settle: () => Promise.resolve(),
    claimBatch: 20,
    maxPerRun: 40,
    pauseMs: 0,
  });
  assertEquals(stats.processed, 40);
});

Deno.test("chaos: EO down (every push retries) still completes and reclaims first", async () => {
  const rows = [row("a@x.com"), row("b@x.com", { desired_status: "unsubscribed" })];
  let reclaimed = false;
  const settledWith: EoResult[] = [];
  const stats = await runSyncCycle({
    reclaim: () => {
      reclaimed = true;
      return Promise.resolve();
    },
    claim: dispenser(rows),
    push: () => Promise.resolve(retry),
    settle: (_r, res) => {
      settledWith.push(res);
      return Promise.resolve();
    },
    pauseMs: 0,
  });
  assert(reclaimed, "reclaim runs before draining");
  assertEquals(stats.processed, 2);
  assertEquals(stats.retried, 2);
  assertEquals(stats.synced, 0);
  assertEquals(
    settledWith.every((r) => r.outcome === "retry"),
    true
  );
});

Deno.test("a poison row (settle throws) is isolated; the rest still drain", async () => {
  const rows = [row("good1@x.com"), row("poison@x.com"), row("good2@x.com")];
  const settled: string[] = [];
  const errored: string[] = [];
  const stats = await runSyncCycle({
    claim: dispenser(rows),
    push: () => Promise.resolve(ok),
    settle: (r) => {
      if (r.email === "poison@x.com") return Promise.reject(new Error("db down"));
      settled.push(r.email);
      return Promise.resolve();
    },
    onError: (r) => errored.push(r.email),
    pauseMs: 0,
  });
  assertEquals(stats.processed, 2);
  assertEquals(stats.errors, 1);
  assertEquals(settled, ["good1@x.com", "good2@x.com"]);
  assertEquals(errored, ["poison@x.com"]);
});

Deno.test("mixed outcomes are counted and settle sees the row version", async () => {
  const rows = [
    row("s@x.com", { version: 7 }),
    row("r@x.com", { version: 8 }),
    row("d@x.com", { version: 9 }),
  ];
  const versions: number[] = [];
  const stats = await runSyncCycle({
    claim: dispenser(rows),
    push: (r) => Promise.resolve(r.email === "s@x.com" ? ok : r.email === "r@x.com" ? retry : dead),
    settle: (r) => {
      versions.push(r.version);
      return Promise.resolve();
    },
    pauseMs: 0,
  });
  assertEquals([stats.synced, stats.retried, stats.dlq], [1, 1, 1]);
  assertEquals(versions, [7, 8, 9]);
});
