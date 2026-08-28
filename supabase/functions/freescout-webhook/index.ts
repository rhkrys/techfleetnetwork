// @edge-public
// freescout-webhook — receives Freescout HMAC-signed events.
// Hot path: HMAC verify → dedupe → enqueue → 200 (target <100ms).
// All heavy work (pointer upsert, notifications, fan-out) runs in the
// process-freescout-events worker, drained by cron. This is the same lane
// pattern as the email queue.
import { getAdminClient } from "../_shared/admin-client.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { verifyFreescoutWebhook } from "../_shared/freescout.ts";

function safeEventId(payload: Record<string, unknown>): string {
  if (typeof payload?.event_id === "string") return payload.event_id;
  if (typeof payload?.id === "string") return payload.id as string;
  const conv = (payload?.conversation as { id?: unknown })?.id ?? payload?.conversation_id ?? "";
  const thread = (payload?.thread as { id?: unknown })?.id ?? "";
  const type = payload?.event ?? payload?.event_type ?? "";
  const ts = payload?.timestamp ?? "";
  return `${type}:${conv}:${thread}:${ts}`;
}

Deno.serve(
  withAuditWrapper("freescout-webhook", async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    const len = Number.parseInt(req.headers.get("content-length") ?? "0", 10);
    if (Number.isFinite(len) && len > 256 * 1024) {
      return jsonResponse({ error: "Body too large" }, 413);
    }

    const raw = await req.text();
    const verified = await verifyFreescoutWebhook(req, raw);
    if (!verified) return jsonResponse({ error: "Unauthorized" }, 401);

    // Replay model: FreeScout's HMAC signs the request BODY only — its scheme has
    // no timestamp, so we cannot bind freshness into the verified material. The
    // durable replay guard is therefore the support_webhook_events dedupe below
    // (unique event_id): a replayed request is recorded once and every repeat
    // returns {deduped:true} without re-processing. The `date` check here is NOT a
    // security control (the header is unsigned and attacker-mutable) — it only
    // drops accidental/late redeliveries early. Do not rely on it for anti-replay.
    const dateHdr = req.headers.get("date");
    if (dateHdr) {
      const t = Date.parse(dateHdr);
      if (Number.isFinite(t) && Math.abs(Date.now() - t) > 5 * 60 * 1000) {
        return jsonResponse({ error: "Stale request" }, 401);
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw);
    } catch {
      return jsonResponse({ error: "Bad payload" }, 400);
    }

    const admin = getAdminClient();
    const eventId = safeEventId(payload);
    const eventType = String(payload?.event ?? payload?.event_type ?? "unknown");

    // Idempotency tripwire on the receive side. The processor also handles
    // double-processing via its own ON CONFLICT path, but blocking at the gate
    // saves an enqueue + a wakeup.
    const { error: dupErr } = await admin.from("support_webhook_events").insert({
      event_id: eventId,
      event_type: eventType,
    });
    if (dupErr && (dupErr as { code?: string }).code === "23505") {
      return jsonResponse({ ok: true, deduped: true });
    }

    // Enqueue for async processing — returns immediately.
    const { error: enqErr } = await admin.rpc("freescout_enqueue_event", {
      p_event_id: eventId,
      p_event_type: eventType,
      p_payload: payload,
    });
    if (enqErr) {
      console.error(
        JSON.stringify({
          level: "error",
          fn: "freescout-webhook",
          code: "enqueue_failed",
          eventId,
          eventType,
          msg: enqErr.message,
        })
      );
      return jsonResponse({ ok: false, error: "enqueue_failed" }, 500);
    }

    return jsonResponse({ ok: true, queued: true });
  })
);
