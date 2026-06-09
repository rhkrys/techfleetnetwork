// Use-case: DispatchDue — claims a fair batch, sends via ProviderPort, records results.
import type {
  Clock, EmailProviderPort, EventSink, Logger, OutboxRepo, PolicyRepo,
} from '../ports.ts';
import type { EmailEnvelope, ProviderOutcome } from '../domain/types.ts';

export interface DispatchDueResult { claimed: number; sent: number; failed: number; rateLimited: number; }

export function makeDispatchDue(deps: {
  outbox: OutboxRepo; provider: EmailProviderPort; policy: PolicyRepo;
  events: EventSink; logger: Logger; clock: Clock;
}) {
  return async function dispatchDue(maxOverride?: number): Promise<DispatchDueResult> {
    const cfg = await deps.policy.load();
    const max = Math.max(1, Math.min(maxOverride ?? cfg.maxBatchSize, cfg.maxBatchSize));
    const rows = await deps.outbox.claimDue(max);
    const result: DispatchDueResult = { claimed: rows.length, sent: 0, failed: 0, rateLimited: 0 };

    for (const row of rows) {
      const env: EmailEnvelope = {
        lane: row.lane, template: row.template, recipient: row.recipient, subject: row.subject,
        payload: row.payload, idempotencyKey: row.idempotencyKey, messageId: row.messageId,
        traceId: row.traceId,
      };
      let outcome: ProviderOutcome;
      try {
        outcome = await deps.provider.send(env);
      } catch (e) {
        outcome = { kind: 'error', statusCode: 0, message: (e as Error).message, retryable: true };
      }
      await deps.outbox.recordResult(row.id, outcome);

      const tag = outcome.kind;
      if (tag === 'sent') result.sent++;
      else if (tag === 'rate_limited') { result.rateLimited++; result.failed++; }
      else if (tag !== 'suppressed') result.failed++;

      await deps.events.emit(`email.attempt.${tag}`, {
        outbox_id: row.id, lane: row.lane, template: row.template,
        attempt: row.attempts + 1, code: 'statusCode' in outcome ? outcome.statusCode : null,
      }, tag === 'sent' || tag === 'suppressed' ? 'info' : (row.lane === 'bulk' ? 'warn' : 'error'));

      // Workspace-friendly pacing handled at provider/RPC layer; if a 429 lands,
      // breaker will short-circuit subsequent claims on this lane.
      if (outcome.kind === 'rate_limited') break;
      if (cfg.minSendGapMs > 0) await sleep(cfg.minSendGapMs);
    }

    return result;
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
