// @edge-cron
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

// --- linkify helpers (kept in-sync with src/lib/linkify.ts) ---
import { withAuditWrapper } from "../_shared/audit.ts";
import { announcementMessageId } from "./message-id.ts";

const BodySchema = z.object({ announcement_id: z.string().optional() }).passthrough();
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(
  withAuditWrapper("send-announcement-email", async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      // Verify the caller is admin
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
        error: userError,
      } = await userClient.auth.getUser();
      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adminClient = createClient(supabaseUrl, serviceRoleKey);
      const { data: roleData } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();

      if (!roleData) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const _raw = await req.json().catch(() => ({}));
      const _parsed = BodySchema.safeParse(_raw);
      if (!_parsed.success) {
        return new Response(JSON.stringify({ error: "Invalid request body" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { announcement_id } = _parsed.data as { announcement_id?: string };
      if (!announcement_id) {
        return new Response(JSON.stringify({ error: "announcement_id is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch the announcement
      const { data: announcement, error: annError } = await adminClient
        .from("announcements")
        .select("title, body_html")
        .eq("id", announcement_id)
        .single();

      if (annError || !announcement) {
        return new Response(JSON.stringify({ error: "Announcement not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch opted-in profiles
      const { data: profiles, error: profError } = await adminClient
        .from("profiles")
        .select("email")
        .eq("notify_announcements", true)
        .neq("email", "");

      if (profError) {
        console.error("Failed to fetch profiles:", profError);
        return new Response(JSON.stringify({ error: "Failed to fetch recipients" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const recipients = (profiles ?? []).filter((p: any) => p.email);

      if (recipients.length === 0) {
        return new Response(JSON.stringify({ sent: 0, message: "No opted-in recipients" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Enqueue emails for each recipient
      let enqueued = 0;
      const now = new Date().toISOString();

      for (const recipient of recipients) {
        const normalizedEmail = String(recipient.email ?? "")
          .trim()
          .toLowerCase();
        if (!normalizedEmail) continue;

        // Audit H8: DETERMINISTIC per (announcement, recipient). A random UUID
        // here made every re-run/retry a fresh idempotency key, so the pipeline's
        // dedup (idempotencyKey / email_send_log.message_id) never matched and a
        // timeout+retry re-blasted all opted-in members. A stable id makes a
        // retry a no-op at the dedup layer. (Helper is unit-tested in message-id.test.ts.)
        const messageId = announcementMessageId(announcement_id, normalizedEmail);
        const unsubscribeToken = crypto.randomUUID();

        const announcementUrl = `https://techfleet.network/updates?highlight=${announcement_id}`;

        // Inline styles into common block tags so email clients render formatting.
        // Many clients (Gmail, Outlook) strip <style> blocks or default browser
        // styles for <p>, <ul>, <ol>, <h2>, <h3>, <blockquote>, etc.
        const inlineFormattedBody = linkifyHtml(announcement.body_html || "")
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

        const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: #ffffff; border-radius: 8px; padding: 32px; border: 1px solid #e4e4e7;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="font-size: 14px; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; margin: 0;">Tech Fleet Announcement</h1>
      </div>
      <h2 style="font-size: 22px; font-weight: 700; color: #18181b; margin: 0 0 16px 0;">${announcement.title}</h2>
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
        const emailText = [
          `Tech Fleet Announcement`,
          "",
          announcement.title,
          "",
          "A new announcement is available in Tech Fleet Network.",
          `View it here: ${announcementUrl}`,
          "",
          "You received this because you opted in to announcements.",
          "To unsubscribe, update your notification preferences in your profile settings.",
        ].join("\n");

        try {
          await adminClient.from("email_unsubscribe_tokens").insert({
            email: normalizedEmail,
            token: unsubscribeToken,
          });

          // ── Email subsystem v2 strangler fig (bulk lane) ──────────────────
          let routedV2 = false;
          try {
            const { buildEmailContainer, isV2Enabled } =
              await import("../_shared/email/composition.ts");
            if (await isV2Enabled(adminClient, "bulk")) {
              const { enqueueEmail } = buildEmailContainer(adminClient);
              const out = await enqueueEmail({
                template: "announcement",
                recipient: normalizedEmail,
                subject: `[Tech Fleet] ${announcement.title}`,
                payload: {
                  html: emailHtml,
                  text: emailText,
                  from: `Tech Fleet <onboarding@techfleet.org>`,
                  sender_domain: "notify.techfleet.org",
                  label: "announcement",
                  unsubscribe_token: unsubscribeToken,
                  purpose: "transactional",
                  announcement_id,
                },
                idempotencyKey: messageId,
                messageId,
                laneOverride: "bulk",
              });
              await adminClient.from("email_send_log").insert({
                message_id: out.messageId,
                recipient_email: normalizedEmail,
                template_name: "announcement",
                status: out.suppressed ? "suppressed" : "pending",
                metadata: { announcement_id, title: announcement.title, v2: true },
              });
              routedV2 = true;
              enqueued++;
            }
          } catch (e) {
            console.warn("email v2 bulk path errored — falling back to legacy", { err: String(e) });
          }
          if (routedV2) continue;
          // ── End v2 strangler fig ──────────────────────────────────────────

          await adminClient.from("email_send_log").insert({
            message_id: messageId,
            recipient_email: normalizedEmail,
            template_name: "announcement",
            status: "pending",
            metadata: { announcement_id, title: announcement.title },
          });

          await adminClient.rpc("enqueue_email", {
            queue_name: "bulk_emails",
            payload: {
              to: normalizedEmail,
              subject: `[Tech Fleet] ${announcement.title}`,
              html: emailHtml,
              text: emailText,
              from: `Tech Fleet <onboarding@techfleet.org>`,
              sender_domain: "notify.techfleet.org",
              label: "announcement",
              message_id: messageId,
              idempotency_key: messageId,
              unsubscribe_token: unsubscribeToken,
              queued_at: now,
              purpose: "transactional",
            },
          });
          enqueued++;
        } catch (e) {
          console.error(`Failed to enqueue email to ${normalizedEmail}:`, e);
        }
      }

      // --- Cross-post to Discord #platform-updates channel ---
      let discordPosted = false;
      const platformWebhook = Deno.env.get("DISCORD_PLATFORM_UPDATES_WEBHOOK");
      if (platformWebhook) {
        try {
          const announcementUrl = `https://techfleet.network/updates?highlight=${announcement_id}`;
          // Strip HTML tags and decode entities for Discord plain-text
          const plainBody = announcement.body_html
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n\n")
            .replace(/<\/li>/gi, "\n")
            .replace(/<li[^>]*>/gi, "• ")
            .replace(/<\/h[1-6]>/gi, "\n\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#(\d+);/g, (_m: string, code: string) => String.fromCharCode(Number(code)))
            .replace(/[ \t]+/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

          const discordContent = [
            `<@&1083439364975112293>`,
            "",
            `📢 **${announcement.title}**`,
            "",
            plainBody.length > 1500 ? plainBody.substring(0, 1500) + "…" : plainBody,
            "",
            `🔗 [View on Tech Fleet Network](${announcementUrl})`,
          ].join("\n");

          const discordRes = await fetch(platformWebhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: discordContent,
              allowed_mentions: { roles: ["1083439364975112293"] },
            }),
          });

          if (discordRes.ok) {
            discordPosted = true;
          } else {
            const errText = await discordRes.text();
            console.warn(
              `Discord webhook failed [${discordRes.status}]: ${errText.substring(0, 300)}`
            );
          }
          // Consume body if not already
          if (!discordPosted) await discordRes.text().catch(() => {});
        } catch (discordErr) {
          console.warn("Discord cross-post failed (non-critical):", discordErr);
        }
      } else {
        console.warn(
          "DISCORD_PLATFORM_UPDATES_WEBHOOK not configured; skipping Discord cross-post"
        );
      }

      return new Response(
        JSON.stringify({
          sent: enqueued,
          total_recipients: recipients.length,
          discord_posted: discordPosted,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } catch (err) {
      console.error("send-announcement-email error:", err);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  })
);
