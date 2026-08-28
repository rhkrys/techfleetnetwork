// @edge-public
// Resend delivery-event webhook receiver (replaces the dead Lovable/Mailgun
// `handle-email-suppression`). Ingests Resend's post-send events so we STOP
// sending blind: bounces/complaints suppress the address + append a terminal
// row to email_send_log, making System Health → Deliverability and the
// auto-pause (refresh-email-health) truthful.
//
// THREAT MODEL (owasp-secure-coding-bdd):
//   - Trust boundary: internet → this endpoint → suppressed_emails (which
//     RESTRICTS a recipient's ability to receive mail).
//   - Spoofing/abuse case: a forged "bounce" event could suppress an ARBITRARY
//     address = targeted deliverability lockout. MITIGATION: every request MUST
//     pass Svix signature verification (RESEND_WEBHOOK_SECRET) BEFORE any DB
//     write. Unsigned/invalid → 401, nothing written.
//   - DoS: public endpoint → reject oversized bodies; do the cheap verify first.
//   - Info disclosure: recipient emails are PII → redact in logs.
//   - Business logic: only HARD signals (bounce, complaint) suppress; transient
//     signals (delivery_delayed) and delivered never restrict sending.
//   - Recovery (lockout-prevention): a wrongly-suppressed legitimate recipient
//     is restored by an admin removing the row from suppressed_emails (admin
//     tooling / handle-email-unsubscribe) — suppression is reversible, never a
//     dead end.
import { createClient } from "npm:@supabase/supabase-js@2";
import { Webhook } from "npm:svix@1.42.0";
// Pure decision logic (unit-tested in logic.test.ts).
import { classifyResendEvent, normalizeRecipient, redactEmail } from "./logic.ts";
import { withAuditWrapper } from "../_shared/audit.ts";

const MAX_BODY_BYTES = 64 * 1024; // Resend events are small; cap to blunt DoS.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(
  withAuditWrapper("resend-webhook", async (req) => {
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

    const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!secret || !supabaseUrl || !serviceKey) {
      // Misconfiguration, not a bad request. Fail closed (no processing) and make
      // it visible rather than silently accepting unverifiable events.
      console.error("[resend-webhook] missing RESEND_WEBHOOK_SECRET / Supabase env");
      return json({ error: "server not configured" }, 500);
    }

    // Read raw body (Svix signs the exact bytes). Enforce a size cap first.
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413);

    // ── Signature verification — the security gate. Nothing is written unless
    //    this passes. Rejects forged / replayed (stale-timestamp) events. ──
    let evt: { type?: string; data?: Record<string, unknown> };
    try {
      const wh = new Webhook(secret);
      evt = wh.verify(raw, {
        "svix-id": req.headers.get("svix-id") ?? "",
        "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
        "svix-signature": req.headers.get("svix-signature") ?? "",
      }) as typeof evt;
    } catch (_err) {
      console.warn("[resend-webhook] signature verification failed — rejecting");
      return json({ error: "invalid signature" }, 401);
    }

    const type = String(evt?.type ?? "");
    const data = (evt?.data ?? {}) as Record<string, unknown>;
    const recipient = normalizeRecipient(data.to as string | string[] | undefined);
    const providerMessageId = (data.email_id ?? data.id ?? null) as string | null;

    const action = classifyResendEvent(type);

    if (action.kind === "log") {
      // Positive/transient signal — never restricts sending.
      console.log("[resend-webhook] ack", { type, to: recipient ? redactEmail(recipient) : "?" });
      return json({ ok: true, action: "logged" });
    }
    if (action.kind === "ignore") {
      console.log("[resend-webhook] ack unhandled type", { type });
      return json({ ok: true, action: "ignored", type });
    }
    if (!recipient || !recipient.includes("@")) {
      return json({ error: "missing recipient" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const reason = action.reason;
    const status = action.status;
    const metadata = {
      source: "resend-webhook",
      event_type: type,
      provider_message_id: providerMessageId,
      bounce: (data.bounce ?? null) as unknown,
    };

    // 1) Suppress (idempotent). Restricts future sends to a proven-bad address.
    const { error: supErr } = await supabase
      .from("suppressed_emails")
      .upsert({ email: recipient, reason, metadata }, { onConflict: "email" });
    if (supErr) {
      console.error("[resend-webhook] suppression upsert failed", {
        to: redactEmail(recipient),
        err: supErr.message,
      });
      return json({ error: "suppression write failed" }, 500);
    }

    // 2) Append a terminal row to the unified log (never update existing rows).
    const { error: logErr } = await supabase.from("email_send_log").insert({
      message_id: providerMessageId,
      template_name: "system",
      recipient_email: recipient,
      status,
      error_message:
        reason === "bounce"
          ? "Permanent bounce — reported by Resend"
          : "Spam complaint — reported by Resend",
      metadata,
    });
    if (logErr) {
      // Non-fatal: suppression already recorded. Log and 200 so Resend doesn't retry-storm.
      console.warn("[resend-webhook] email_send_log insert failed (non-fatal)", {
        err: logErr.message,
      });
    }

    console.log("[resend-webhook] suppressed", { type, reason, to: redactEmail(recipient) });
    return json({ ok: true, action: "suppressed", reason });
  })
);
