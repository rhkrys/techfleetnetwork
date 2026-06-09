// Use-case: EnqueueEmail — single entry point for every sender (shim or new caller).
import type { OutboxRepo, SuppressionRepo, EventSink } from '../ports.ts';
import { routeLane } from '../domain/policies.ts';
import type { Lane } from '../domain/types.ts';

export interface EnqueueEmailInput {
  template: string;
  recipient: string;
  subject?: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  messageId?: string;
  traceId?: string;
  laneOverride?: Lane;
}

export interface EnqueueEmailResult {
  id?: string;
  suppressed: boolean;
  lane: Lane;
  messageId: string;
}

export function makeEnqueueEmail(deps: {
  outbox: OutboxRepo; suppression: SuppressionRepo; events: EventSink;
  randomMessageId: () => string;
}) {
  return async function enqueueEmail(input: EnqueueEmailInput): Promise<EnqueueEmailResult> {
    const lane = input.laneOverride ?? routeLane(input.template);
    const messageId = input.messageId ?? input.idempotencyKey ?? deps.randomMessageId();

    if (await deps.suppression.isSuppressed(input.recipient)) {
      await deps.events.emit('email.enqueue.suppressed',
        { template: input.template, lane, recipient_hash: hash(input.recipient) }, 'info');
      return { suppressed: true, lane, messageId };
    }

    const id = await deps.outbox.enqueue({
      lane, template: input.template, recipient: input.recipient, subject: input.subject,
      payload: input.payload ?? {}, idempotencyKey: input.idempotencyKey,
      messageId, traceId: input.traceId,
    });
    await deps.events.emit('email.enqueued',
      { template: input.template, lane, message_id: messageId, outbox_id: id }, 'info');
    return { id, suppressed: false, lane, messageId };
  };
}

function hash(s: string): string {
  // non-cryptographic, just to avoid PII in events
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
