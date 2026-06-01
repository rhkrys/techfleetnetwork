// freescout-webhook — receives Freescout HMAC-signed events
// A02 HMAC verify, A08 idempotency, A09 audited
import { getAdminClient } from "../_shared/admin-client.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { verifyFreescoutWebhook } from "../_shared/freescout.ts";

function safeEventId(payload: any): string {
  // Prefer explicit event id; fall back to hash of conv+thread+type
  if (typeof payload?.event_id === "string") return payload.event_id;
  if (typeof payload?.id === "string") return payload.id;
  const conv = payload?.conversation?.id ?? payload?.conversation_id ?? "";
  const thread = payload?.thread?.id ?? "";
  const type = payload?.event ?? payload?.event_type ?? "";
  const ts = payload?.timestamp ?? "";
  return `${type}:${conv}:${thread}:${ts}`;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  // Bound body size
  const len = Number.parseInt(req.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(len) && len > 256 * 1024) {
    return jsonResponse({ error: "Body too large" }, 413);
  }

  const raw = await req.text();
  const verified = await verifyFreescoutWebhook(req, raw);
  if (!verified) return jsonResponse({ error: "Unauthorized" }, 401);

  // Optional replay window
  const dateHdr = req.headers.get("date");
  if (dateHdr) {
    const t = Date.parse(dateHdr);
    if (Number.isFinite(t) && Math.abs(Date.now() - t) > 5 * 60 * 1000) {
      return jsonResponse({ error: "Stale request" }, 401);
    }
  }

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return jsonResponse({ error: "Bad payload" }, 400); }

  const admin = getAdminClient();
  const eventId = safeEventId(payload);
  const eventType = String(payload?.event ?? payload?.event_type ?? "unknown");

  // Idempotency
  const { error: dupErr } = await admin.from("support_webhook_events").insert({
    event_id: eventId, event_type: eventType,
  });
  if (dupErr && (dupErr as any).code === "23505") {
    return jsonResponse({ ok: true, deduped: true });
  }

  const conv = payload?.conversation ?? payload;
  const conversationId = Number(conv?.id ?? payload?.conversation_id);
  const customerEmail: string | undefined = conv?.customer?.email ?? payload?.customer?.email;

  let customerUserId: string | null = null;
  let freescoutCustomerId: string | null = conv?.customer?.id ? String(conv.customer.id) : null;

  if (customerEmail) {
    const { data: prof } = await admin
      .from("profiles")
      .select("id, freescout_customer_id")
      .eq("email", customerEmail)
      .maybeSingle();
    if (prof?.id) {
      customerUserId = prof.id;
      if (freescoutCustomerId && !prof.freescout_customer_id) {
        await admin.from("profiles").update({ freescout_customer_id: freescoutCustomerId }).eq("id", prof.id);
      }
    }
  }

  if (Number.isFinite(conversationId) && conversationId > 0) {
    await admin.from("support_ticket_pointers").upsert({
      conversation_id: conversationId,
      customer_user_id: customerUserId,
      freescout_customer_id: freescoutCustomerId,
      subject: conv?.subject ?? null,
      last_status: conv?.status ?? null,
      mailbox_id: conv?.mailboxId ?? conv?.mailbox_id ?? null,
      last_synced_at: new Date().toISOString(),
    });

    await admin.from("support_ticket_events").insert({
      conversation_id: conversationId,
      customer_user_id: customerUserId,
      event_type: eventType,
      actor_email: payload?.user?.email ?? payload?.actor?.email ?? null,
      actor_kind: payload?.user ? "user" : payload?.customer ? "customer" : null,
      payload,
    });

    // Member notification on admin reply or status change
    if (customerUserId && (eventType.includes("user.replied") || eventType.includes("status_changed") || eventType === "convo.assigned")) {
      try {
        await admin.from("notifications").insert({
          user_id: customerUserId,
          title: eventType.includes("status") ? "Ticket status updated" : "New reply on your ticket",
          body: conv?.subject ? `Re: ${conv.subject}` : "View your support ticket for details.",
          link: `/community/get-help?ticket=${conversationId}`,
          category: "support",
        });
      } catch { /* notifications table may not require — best effort */ }
    }
  }

  return jsonResponse({ ok: true });
});
