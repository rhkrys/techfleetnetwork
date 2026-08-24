// Pure sync-cycle core for the Email Octopus worker (PR 6c). All I/O (claim / push / settle /
// reclaim / sleep) is injected, so the drain loop is fully unit-testable offline. The edge handler
// (index.ts) wires the real Supabase RPCs and the EO client; tests wire fakes.
import type { EoDesiredStatus, EoResult } from "../_shared/email-octopus/client.ts";

export interface ClaimRow {
  email: string;
  user_id: string | null;
  desired_status: EoDesiredStatus;
  fields: Record<string, unknown> | null;
  version: number;
  attempts: number;
}

export interface SyncStats {
  processed: number;
  synced: number;
  retried: number;
  dlq: number;
  errors: number;
  batches: number;
}

export interface SyncDeps {
  claim: (batch: number) => Promise<ClaimRow[]>;
  push: (row: ClaimRow) => Promise<EoResult>;
  settle: (row: ClaimRow, res: EoResult) => Promise<void>;
  reclaim?: () => Promise<void>; // reset rows stuck in 'syncing' before draining
  sleep?: (ms: number) => Promise<void>;
  onError?: (row: ClaimRow, err: unknown) => void;
  maxPerRun?: number; // hard cap on rows per invocation (default 200); cron re-runs to drain the rest
  claimBatch?: number; // rows claimed per round (default 20)
  pauseMs?: number; // spacing between EO calls to stay under the rate limit (default 50ms)
}

const DEFAULTS = { maxPerRun: 200, claimBatch: 20, pauseMs: 50 };

/**
 * Drain the EO sync queue for one invocation: reclaim stale claims, then repeatedly claim a batch and
 * push each contact's desired state to EO, settling the result. Stops when the queue is empty or the
 * per-run cap is hit. A single row that throws is isolated (left in 'syncing' for the reaper) and never
 * halts the drain — so one poison row cannot block everyone else's opt-outs.
 */
export async function runSyncCycle(deps: SyncDeps): Promise<SyncStats> {
  const maxPerRun = deps.maxPerRun ?? DEFAULTS.maxPerRun;
  const claimBatch = deps.claimBatch ?? DEFAULTS.claimBatch;
  const pauseMs = deps.pauseMs ?? DEFAULTS.pauseMs;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const stats: SyncStats = { processed: 0, synced: 0, retried: 0, dlq: 0, errors: 0, batches: 0 };

  if (deps.reclaim) await deps.reclaim();

  while (stats.processed + stats.errors < maxPerRun) {
    const want = Math.min(claimBatch, maxPerRun - (stats.processed + stats.errors));
    const rows = await deps.claim(want);
    if (rows.length === 0) break;
    stats.batches++;

    for (const row of rows) {
      try {
        const res = await deps.push(row);
        await deps.settle(row, res);
        stats.processed++;
        if (res.outcome === "synced") stats.synced++;
        else if (res.outcome === "retry") stats.retried++;
        else stats.dlq++;
      } catch (err) {
        // Isolate the row: it stays 'syncing' and the reaper returns it to 'pending' next run.
        stats.errors++;
        deps.onError?.(row, err);
      }
      if (pauseMs > 0) await sleep(pauseMs);
    }
  }

  return stats;
}
