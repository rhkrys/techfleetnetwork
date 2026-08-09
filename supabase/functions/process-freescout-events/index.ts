// @edge-auth
// process-freescout-events — drains q_freescout_events, applies the same
// downstream writes the webhook used to do inline. Cron-poked every 15s.
// Auth: shared service-role validator (accepts BOTH legacy JWT and opaque
// sb_secret_* tokens — see _shared/service-role-auth.ts). verify_jwt=false.
import { getAdminClient } from "../_shared/admin-client.ts";
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";

const BATCH = 25;
const VT_SECONDS = 60;
const MAX_ATTEMPTS = 3;

/** Escape text before it lands in an HTML column (notifications.body_html).
 *  A ticket subject is attacker/customer-influenced; the notification render
 *  path trusts stored HTML, so an unescaped subject would be stored XSS. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface FreescoutEvent {
  msg_id: number;
  read_ct: number;
  message: {
    event_id: string;
    event_type: string;
    payload: Record<string, unknown>;
  };
}

async function processOne(admin: ReturnType<typeof getAdminClient>, ev: FreescoutEvent) {
  const { payload, event_type: eventType } = ev.message;

  const conv = (payload?.conversation as Record<string, unknown>) ?? payload;
  const conversationId = Number(
    (conv as { id?: unknown })?.id ?? (payload as { conversation_id?: unknown }).conversation_id
  );
  const customerEmail =
    (conv as { customer?: { email?: string } })?.customer?.email ??
    (payload as { customer?: { email?: string } })?.customer?.email;

  let customerUserId: string | null = null;
  const freescoutCustomerId = (conv as { customer?: { id?: number | string } })?.customer?.id
    ? String((conv as { customer: { id: number | string } }).customer.id)
    : null;

  if (customerEmail) {
    const { data: prof } = await admin
      .from("profiles")
      .select("id, user_id, freescout_customer_id")
      .eq("email", customerEmail)
      .maybeSingle();
    if (prof?.user_id) {
      // customer_user_id must be the AUTH uid (profiles.user_id) to match RLS
      // (`customer_user_id = auth.uid()`) and the FK to profiles(user_id).
      // Writing profiles.id (the random PK) here made drain-created tickets
      // invisible to the owner (audit C3). Profile row updates below still key
      // on the PK (prof.id).
      customerUserId = prof.user_id;
      if (freescoutCustomerId && !prof.freescout_customer_id) {
        await admin
          .from("profiles")
          .update({ freescout_customer_id: freescoutCustomerId })
          .eq("id", prof.id);
      }
    }
  }

  if (Number.isFinite(conversationId) && conversationId > 0) {
    await admin.from("support_ticket_pointers").upsert({
      conversation_id: conversationId,
      customer_user_id: customerUserId,
      freescout_customer_id: freescoutCustomerId,
      subject: (conv as { subject?: string })?.subject ?? null,
      last_status: (conv as { status?: string })?.status ?? null,
      mailbox_id:
        (conv as { mailboxId?: number; mailbox_id?: number })?.mailboxId ??
        (conv as { mailbox_id?: number })?.mailbox_id ??
        null,
      last_synced_at: new Date().toISOString(),
    });

    await admin.from("support_ticket_events").insert({
      conversation_id: conversationId,
      customer_user_id: customerUserId,
      event_type: eventType,
      actor_email:
        (payload as { user?: { email?: string }; actor?: { email?: string } })?.user?.email ??
        (payload as { actor?: { email?: string } })?.actor?.email ??
        null,
      actor_kind: (payload as { user?: unknown }).user
        ? "user"
        : (payload as { customer?: unknown }).customer
          ? "customer"
          : null,
      payload,
    });

    const isUserReply = eventType.includes("user.replied") || eventType === "convo.user.replied";
    const isStatusChange = eventType.includes("status_changed");
    const isAssigned = eventType === "convo.assigned";

    if (customerUserId && (isUserReply || isStatusChange || isAssigned)) {
      // audit FS2/T-B: the previous raw insert used columns that do not exist
      // (body/link/category vs the real body_html/link_url/notification_type),
      // so PostgREST 400'd and the error was SWALLOWED — members never received
      // the "new reply"/"status updated" notification (HELP-DESK-028 dead in
      // prod). Route through safe_create_notification (correct columns + its own
      // outbox/retry/DLQ). The subject is HTML-escaped before it lands in
      // body_html to prevent stored XSS via a crafted ticket subject (audit T-D).
      const rawSubject = (conv as { subject?: string })?.subject ?? "";
      const bodyHtml = rawSubject
        ? `Re: ${escapeHtml(rawSubject)}`
        : "View your support ticket for details.";
      const { error: notifErr } = await admin.rpc("safe_create_notification", {
        p_user_id: customerUserId,
        p_title: isStatusChange ? "Ticket status updated" : "New reply on your ticket",
        p_body_html: bodyHtml,
        p_notification_type: "support",
        p_link_url: `/community/get-help?ticket=${conversationId}`,
        p_source: "process-freescout-events",
      });
      if (notifErr) {
        console.error(
          JSON.stringify({
            level: "warn",
            fn: "process-freescout-events",
            code: "notification_failed",
            conversationId,
            msg: notifErr.message,
          })
        );
      }
    }

    // Email the customer when an admin replies (in-app notification above + email).
    if (customerUserId && customerEmail && isUserReply) {
      try {
        const thread =
          (payload as { thread?: Record<string, unknown> })?.thread ??
          (Array.isArray((conv as { threads?: unknown[] })?.threads)
            ? ((conv as { threads: Record<string, unknown>[] }).threads[0] ?? null)
            : null);
        const threadId = thread ? Number((thread as { id?: unknown })?.id ?? 0) : 0;
        const rawBody = String(
          (thread as { body?: unknown })?.body ?? (thread as { text?: unknown })?.text ?? ""
        );
        // Strip HTML for the preview snippet (remove script/style blocks first, then all tags).
        const previewText = rawBody
          .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
          .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
          .replace(/<[^>]*>/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 280);
        const subject = (conv as { subject?: string })?.subject ?? "your support ticket";
        // Members see staff generically as "Support Agent" — admins ARE the
        // support agents; this is member-facing language only, and it avoids
        // exposing individual admin names in reply notifications.
        const replierName = "Support Agent";

        // customerUserId is the AUTH uid (profiles.user_id), set above — look up
        // the profile by user_id, NOT the random PK `id`. Keying on `id` here
        // matched no row, so the reply-notification email silently lost its
        // first-name personalization (audit T-A, sibling of C3).
        const { data: prof } = await admin
          .from("profiles")
          .select("first_name")
          .eq("user_id", customerUserId)
          .maybeSingle();

        await admin.functions.invoke("send-transactional-email", {
          body: {
            templateName: "support-ticket-reply",
            recipientEmail: customerEmail,
            idempotencyKey: `support-reply-${conversationId}-${threadId || ev.message.event_id}`,
            templateData: {
              firstName: prof?.first_name ?? undefined,
              subject,
              preview: previewText || undefined,
              replierName,
              ticketUrl: `https://techfleet.network/community/get-help?ticket=${conversationId}`,
            },
          },
        });
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "warn",
            fn: "process-freescout-events",
            code: "support_reply_email_failed",
            conversationId,
            msg: err instanceof Error ? err.message : String(err),
          })
        );
      }
    }
  }
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const auth = authorizeServiceRoleRequest(req);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

  const admin = getAdminClient();
  let processed = 0;
  let failed = 0;
  let dlq = 0;

  for (let i = 0; i < BATCH; i++) {
    const { data, error } = await admin.rpc("freescout_dequeue_events", {
      p_batch: 1,
      p_vt: VT_SECONDS,
    });
    if (error) {
      console.error(
        JSON.stringify({
          level: "error",
          fn: "process-freescout-events",
          code: "dequeue_failed",
          msg: error.message,
        })
      );
      break;
    }
    const rows = (data ?? []) as FreescoutEvent[];
    if (rows.length === 0) break;
    const ev = rows[0];

    try {
      await processOne(admin, ev);
      await admin.rpc("freescout_delete_event", { p_msg_id: ev.msg_id });
      processed++;
    } catch (e) {
      failed++;
      console.error(
        JSON.stringify({
          level: "error",
          fn: "process-freescout-events",
          code: "processing_failed",
          msgId: ev.msg_id,
          readCt: ev.read_ct,
          msg: e instanceof Error ? e.message : String(e),
        })
      );
      if (ev.read_ct >= MAX_ATTEMPTS) {
        await admin.rpc("freescout_send_to_dlq", {
          p_msg_id: ev.msg_id,
          p_message: ev.message,
          p_error: e instanceof Error ? e.message : String(e),
        });
        dlq++;
      }
      // else: leave it; pgmq visibility timeout will re-deliver
    }
  }

  return jsonResponse({ ok: true, processed, failed, dlq });
});
