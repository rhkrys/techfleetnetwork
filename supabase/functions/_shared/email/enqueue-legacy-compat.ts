// Compat helper (PR 2): forward a LEGACY raw-queue email payload to the v2 outbox.
//
// A few edge callers historically wrote to the retired raw pgmq path via
// `enqueue_email(queue_name, payload)` (replay-email-dlq, replay-dlq-emails, and the
// send-announcement-email legacy fallback). That path's consumer was retired at the July v2
// cutover, so anything enqueued there is stranded. This maps the legacy payload shape
// ({to, subject, html, text, label, message_id, idempotency_key, ...}) onto `enqueue_email_v2`
// (email_outbox -> email-dispatcher -> Resend), so those callers deliver through the live pipeline.
//
// No `_shared/email/domain` layering concern: this file lives outside domain/ and application/.

/** Minimal structural client — loose on purpose so any supabase-js version's client
 *  (whose rpc() returns a PostgrestFilterBuilder, not a plain Promise) is assignable. */
type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => unknown;
};

export type EmailLane = "auth" | "bulk" | "transactional";

/** Map a legacy pgmq queue name (or an already-resolved lane) to a v2 lane. */
export function laneFromQueue(queueOrLane: string): EmailLane {
  if (queueOrLane === "bulk" || queueOrLane === "auth" || queueOrLane === "transactional") {
    return queueOrLane;
  }
  if (queueOrLane === "bulk_emails") return "bulk";
  if (queueOrLane === "auth_emails") return "auth";
  return "transactional";
}

/**
 * Enqueue a legacy-shaped email payload through the v2 outbox RPC.
 * Throws if the RPC returns an error (callers already handle/throw).
 */
export async function enqueueLegacyPayloadV2(
  client: RpcClient,
  queueOrLane: string,
  payload: Record<string, unknown>
): Promise<void> {
  const p = payload ?? {};
  const messageId = (p.message_id as string) || "";
  const idempotencyKey = (p.idempotency_key as string) || messageId || crypto.randomUUID();

  const result = (await client.rpc("enqueue_email_v2", {
    p_lane: laneFromQueue(queueOrLane),
    p_template: (p.label as string) || (p.template as string) || "legacy",
    p_recipient: p.to as string,
    p_subject: (p.subject as string) ?? "",
    p_payload: p,
    p_idempotency_key: idempotencyKey,
    p_message_id: messageId || idempotencyKey,
  })) as { error?: unknown };
  if (result?.error) throw result.error;
}
