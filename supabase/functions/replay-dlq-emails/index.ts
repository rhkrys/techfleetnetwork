// @edge-cron
/**
 * replay-dlq-emails — Admin-only re-enqueue of dead-lettered transactional emails.
 *
 * Why this exists
 * ----------------
 * Once an email is moved to DLQ (TTL expired, 5 retry failures), the original
 * pgmq message containing the rendered HTML/subject is gone — `email_send_log`
 * only stores metadata. Re-rendering requires the original SOURCE row, which
 * we look up via the structured `message_id` convention:
 *
 *   announcement-<announcement_id>-<recipient_uuid>
 *   blast-<blast_id>-<recipient_uuid>          (project-blast)
 *   blast-<blast_id>-sender-<admin_uuid>       (project-blast sender copy)
 *
 * Currently supported re-renderers: announcement.
 * project-blast and fleety-coach-digest fall through to the
 * "not_replayable" reason so the admin sees a clear message in the UI.
 *
 * Security
 * --------
 * - JWT validated server-side (never trusted from body)
 * - Caller must have `admin` role in `user_roles`
 * - Suppression list always honored
 * - Recipients that already received the email later (latest status='sent')
 *   are skipped
 * - Every replay batch writes an audit_log row with admin_id + counts
 *
 * Input
 * -----
 *   { template_name: 'announcement' | 'project-blast' | 'fleety-coach-digest',
 *     since_iso?: string,        // ISO timestamp; defaults to 7 days ago
 *     message_ids?: string[],    // explicit list overrides since_iso
 *     dry_run?: boolean }        // returns candidates without sending
 *
 * Response
 * --------
 *   { requested, replayed, skipped,
 *     reasons: { suppressed, already_delivered, not_replayable, source_missing, error },
 *     candidates?: [{ message_id, recipient_email }],  // dry_run only
 *     batch_id: string }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { enqueueLegacyPayloadV2 } from "../_shared/email/enqueue-legacy-compat.ts";
import { withAuditWrapper } from "../_shared/audit.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

const BodySchema = z.object({
  template_name: z.enum(["announcement", "project-blast", "fleety-coach-digest"]),
  since_iso: z.string().datetime().optional(),
  message_ids: z.array(z.string().min(1).max(200)).max(2000).optional(),
  dry_run: z.boolean().optional(),
});

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

// --- Announcement re-renderer (kept in sync with send-announcement-email) ---
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"'()]+[^\s<>"'(),.;:!?])/gi;
const EMAIL_RE = /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const escHtml = (s: string) =>
  s
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

function linkifyTextNode(text: string): string {
  type M = { start: number; end: number; html: string };
  const ms: M[] = [];
  const collect = (re: RegExp, build: (m: string) => string) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null)
      ms.push({ start: m.index, end: m.index + m[0].length, html: build(m[0]) });
  };
  collect(URL_RE, (raw) => {
    const href = raw.startsWith("www.") ? `https://${raw}` : raw;
    return `<a href="${escAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">${escHtml(raw)}</a>`;
  });
  collect(EMAIL_RE, (raw) => `<a href="mailto:${escAttr(raw)}">${escHtml(raw)}</a>`);
  if (ms.length === 0) return escHtml(text);
  ms.sort((a, b) => a.start - b.start || a.end - b.end);
  const filtered: M[] = [];
  let lastEnd = -1;
  for (const m of ms) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }
  let out = "";
  let cursor = 0;
  for (const m of filtered) {
    out += escHtml(text.slice(cursor, m.start));
    out += m.html;
    cursor = m.end;
  }
  return out + escHtml(text.slice(cursor));
}

function linkifyHtml(html: string): string {
  if (typeof html !== "string" || !html) return "";
  let i = 0,
    out = "",
    inAnchor = 0;
  const len = html.length;
  while (i < len) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      const rest = html.slice(i);
      out += inAnchor > 0 ? rest : linkifyTextNode(rest);
      break;
    }
    if (lt > i) {
      const t = html.slice(i, lt);
      out += inAnchor > 0 ? t : linkifyTextNode(t);
    }
    const gt = html.indexOf(">", lt + 1);
    if (gt === -1) {
      out += html.slice(lt);
      break;
    }
    const tag = html.slice(lt, gt + 1);
    out += tag;
    if (/^<a\b/i.test(tag)) inAnchor++;
    else if (/^<\/a\s*>/i.test(tag) && inAnchor > 0) inAnchor--;
    i = gt + 1;
  }
  return out;
}

function renderAnnouncementEmail(
  title: string,
  bodyHtml: string,
  announcementId: string
): { html: string; text: string; subject: string; url: string } {
  const announcementUrl = `https://techfleet.network/updates?highlight=${announcementId}`;
  const inlineFormattedBody = linkifyHtml(bodyHtml || "")
    .replace(
      /<p(\s[^>]*)?>/gi,
      '<p style="margin:0 0 12px 0; font-size:15px; line-height:1.6; color:#3f3f46;">'
    )
    .replace(
      /<h2(\s[^>]*)?>/gi,
      '<h2 style="font-size:18px; font-weight:700; color:#18181b; margin:20px 0 10px 0; line-height:1.3;">'
    )
    .replace(
      /<h3(\s[^>]*)?>/gi,
      '<h3 style="font-size:16px; font-weight:600; color:#18181b; margin:18px 0 8px 0; line-height:1.3;">'
    )
    .replace(
      /<ul(\s[^>]*)?>/gi,
      '<ul style="margin:0 0 12px 0; padding-left:24px; font-size:15px; line-height:1.6; color:#3f3f46;">'
    )
    .replace(
      /<ol(\s[^>]*)?>/gi,
      '<ol style="margin:0 0 12px 0; padding-left:24px; font-size:15px; line-height:1.6; color:#3f3f46;">'
    )
    .replace(/<li(\s[^>]*)?>/gi, '<li style="margin:0 0 4px 0;">')
    .replace(
      /<blockquote(\s[^>]*)?>/gi,
      '<blockquote style="margin:0 0 12px 0; padding:8px 16px; border-left:4px solid #e4e4e7; color:#52525b; font-style:italic;">'
    )
    .replace(/<a(\s[^>]*)?>/gi, (m: string) =>
      m.replace(/<a/i, '<a style="color:#2563eb; text-decoration:underline;"')
    )
    .replace(/<strong(\s[^>]*)?>/gi, '<strong style="font-weight:700; color:#18181b;">')
    .replace(/<b(\s[^>]*)?>/gi, '<b style="font-weight:700; color:#18181b;">')
    .replace(/<em(\s[^>]*)?>/gi, '<em style="font-style:italic;">')
    .replace(/<u(\s[^>]*)?>/gi, '<u style="text-decoration:underline;">');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: #ffffff; border-radius: 8px; padding: 32px; border: 1px solid #e4e4e7;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="font-size: 14px; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; margin: 0;">Tech Fleet Announcement</h1>
      </div>
      <h2 style="font-size: 22px; font-weight: 700; color: #18181b; margin: 0 0 16px 0;">${escHtml(title)}</h2>
      <div style="font-size: 15px; line-height: 1.6; color: #3f3f46;">
        ${inlineFormattedBody}
      </div>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${announcementUrl}" style="display: inline-block; background-color: #18181b; color: #ffffff; font-size: 14px; font-weight: 600; padding: 12px 24px; border-radius: 6px; text-decoration: none;">View Announcement</a>
      </div>
      <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;" />
      <p style="font-size: 12px; color: #a1a1aa; text-align: center; margin: 0;">
        You received this because you opted in to announcements on Tech Fleet Network.<br/>
        To unsubscribe, update your notification preferences in your profile settings.
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = [
    `Tech Fleet Announcement`,
    "",
    title,
    "",
    "A new announcement is available in Tech Fleet Network.",
    `View it here: ${announcementUrl}`,
    "",
    "You received this because you opted in to announcements.",
    "To unsubscribe, update your notification preferences in your profile settings.",
  ].join("\n");

  return { html, text, subject: `[Tech Fleet] ${title}`, url: announcementUrl };
}

// Parse "<template>-<source_id>-<recipient_uuid>" — source_id may itself
// contain dashes (UUID), so split from the right.
function parseMessageId(template: string, messageId: string): { sourceId: string } | null {
  if (template === "announcement") {
    const prefix = "announcement-";
    if (!messageId.startsWith(prefix)) return null;
    const rest = messageId.slice(prefix.length);
    // rest = "<announcement_uuid>-<recipient_uuid>", split off last UUID (36 chars + dash before it)
    if (rest.length < 36 + 1 + 36) return null;
    const sourceId = rest.slice(0, -37); // strip "-<recipient_uuid>"
    return { sourceId };
  }
  // project-blast and fleety-coach-digest: parse but not currently replayable
  return null;
}

Deno.serve(
  withAuditWrapper("replay-dlq-emails", async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const authHeader = req.headers.get("Authorization") || "";
      if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const admin = createClient(supabaseUrl, serviceKey);

      const {
        data: { user },
        error: userErr,
      } = await userClient.auth.getUser();
      if (userErr || !user) return json({ error: "Unauthorized" }, 401);

      const { count: adminCount } = await admin
        .from("user_roles")
        .select("id", { head: true, count: "exact" })
        .eq("user_id", user.id)
        .eq("role", "admin");
      if (!adminCount || adminCount < 1) return json({ error: "Forbidden" }, 403);

      const raw = await req.json().catch(() => ({}));
      const parsed = BodySchema.safeParse(raw);
      if (!parsed.success)
        return json({ error: "Invalid request body", detail: parsed.error.flatten() }, 400);
      const { template_name, since_iso, message_ids, dry_run } = parsed.data;

      const sinceIso = since_iso ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const batchId = crypto.randomUUID();

      // --- Fetch DLQ candidates ---
      let dlqQuery = admin
        .from("email_send_log")
        .select("message_id, recipient_email, metadata, created_at")
        .eq("template_name", template_name)
        .eq("status", "dlq")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(2000);

      if (message_ids && message_ids.length > 0) {
        dlqQuery = admin
          .from("email_send_log")
          .select("message_id, recipient_email, metadata, created_at")
          .eq("template_name", template_name)
          .eq("status", "dlq")
          .in("message_id", message_ids);
      }

      const { data: dlqRows, error: dlqErr } = await dlqQuery;
      if (dlqErr) {
        console.error("[replay-dlq-emails] DLQ query failed:", dlqErr);
        return json({ error: "DLQ query failed" }, 500);
      }

      // Dedupe by recipient_email (keep most recent DLQ row per recipient)
      const byRecipient = new Map<
        string,
        { message_id: string; recipient_email: string; metadata: any; created_at: string }
      >();
      for (const r of dlqRows ?? []) {
        const email = String(r.recipient_email ?? "")
          .trim()
          .toLowerCase();
        if (!email) continue;
        if (!byRecipient.has(email)) byRecipient.set(email, r as any);
      }
      const candidates = Array.from(byRecipient.values());

      // --- Filter out suppressed + already-delivered recipients ---
      const recipientEmails = candidates.map((c) => c.recipient_email.toLowerCase());
      const reasons = {
        suppressed: 0,
        already_delivered: 0,
        not_replayable: 0,
        source_missing: 0,
        error: 0,
      };

      const { data: suppRows } = await admin
        .from("suppressed_emails")
        .select("email")
        .in("email", recipientEmails);
      const suppressed = new Set((suppRows ?? []).map((r: any) => String(r.email).toLowerCase()));

      // Already-delivered = at least one 'sent' row for the same template
      // at or after the DLQ row's created_at for the same recipient.
      const { data: sentRows } = await admin
        .from("email_send_log")
        .select("recipient_email, created_at")
        .eq("template_name", template_name)
        .eq("status", "sent")
        .in("recipient_email", recipientEmails);
      const sentByEmail = new Map<string, string>();
      for (const r of sentRows ?? []) {
        const email = String(r.recipient_email).toLowerCase();
        const existing = sentByEmail.get(email);
        if (!existing || r.created_at > existing) sentByEmail.set(email, r.created_at as string);
      }

      if (dry_run) {
        return json({
          requested: candidates.length,
          candidates: candidates.map((c) => ({
            message_id: c.message_id,
            recipient_email: c.recipient_email,
          })),
          batch_id: batchId,
        });
      }

      // --- Replay loop ---
      let replayed = 0;
      const now = new Date().toISOString();
      const replayedMessageIds: string[] = [];

      for (const cand of candidates) {
        const email = cand.recipient_email.toLowerCase();

        if (suppressed.has(email)) {
          reasons.suppressed++;
          continue;
        }
        const sentAt = sentByEmail.get(email);
        if (sentAt && sentAt >= cand.created_at) {
          reasons.already_delivered++;
          continue;
        }

        if (template_name !== "announcement") {
          reasons.not_replayable++;
          continue;
        }

        const parsedId = parseMessageId(template_name, cand.message_id);
        if (!parsedId) {
          reasons.source_missing++;
          continue;
        }

        // Load source announcement
        const { data: announcement, error: annErr } = await admin
          .from("announcements")
          .select("title, body_html")
          .eq("id", parsedId.sourceId)
          .maybeSingle();
        if (annErr || !announcement) {
          reasons.source_missing++;
          continue;
        }

        const { html, text, subject } = renderAnnouncementEmail(
          announcement.title as string,
          (announcement.body_html as string) ?? "",
          parsedId.sourceId
        );

        const newMessageId = `replay-${cand.message_id}`;
        const unsubscribeToken = crypto.randomUUID();

        try {
          // Unsubscribe token (one per email; ignore unique-violation if it already exists)
          await admin
            .from("email_unsubscribe_tokens")
            .insert({
              email,
              token: unsubscribeToken,
            })
            .then(
              () => {},
              () => {}
            );

          await admin.from("email_send_log").insert({
            message_id: newMessageId,
            recipient_email: email,
            template_name: "announcement",
            status: "pending",
            metadata: {
              announcement_id: parsedId.sourceId,
              title: announcement.title,
              replay_of: cand.message_id,
              replay_batch_id: batchId,
              replayed_by: user.id,
            },
          });

          await enqueueLegacyPayloadV2(admin, "transactional_emails", {
            to: email,
            subject,
            html,
            text,
            from: `Tech Fleet <onboarding@techfleet.org>`,
            sender_domain: "notify.techfleet.org",
            label: "announcement",
            message_id: newMessageId,
            idempotency_key: newMessageId,
            unsubscribe_token: unsubscribeToken,
            queued_at: now,
            purpose: "transactional",
            bypass_frequency_cap: true,
          });

          replayed++;
          replayedMessageIds.push(cand.message_id);
        } catch (e) {
          console.error(`replay enqueue failed for ${email}:`, e);
          reasons.error++;
        }
      }

      // Audit log (best-effort; never block replay on audit failure)
      await admin
        .rpc("write_audit_log", {
          p_event_type: "email.dlq.replay",
          p_table_name: "email_send_log",
          p_record_id: batchId,
          p_user_id: user.id,
          p_changed_fields: [
            `template:${template_name}`,
            `replayed:${replayed}`,
            `skipped:${reasons.suppressed + reasons.already_delivered + reasons.not_replayable + reasons.source_missing + reasons.error}`,
            `batch:${batchId}`,
          ],
        })
        .then(
          () => {},
          (e: unknown) => console.warn("audit_log write failed:", e)
        );

      return json({
        requested: candidates.length,
        replayed,
        skipped: candidates.length - replayed,
        reasons,
        batch_id: batchId,
        replayed_message_ids: replayedMessageIds.slice(0, 50), // truncate large lists
      });
    } catch (e) {
      console.error("replay-dlq-emails unhandled error:", e);
      return json({ error: "Internal error" }, 500);
    }
  })
);
