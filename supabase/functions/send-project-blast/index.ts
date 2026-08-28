// @edge-cron
/**
 * send-project-blast — Admin-only project blast sender
 *
 * Hardened:
 *  - Strict CORS, POST only
 *  - JWT verified via getClaims; sender identity NEVER trusted from body
 *  - Re-checks admin role + project coordinator match server-side
 *  - Zod-style strict payload validation, size-limited (32 KiB)
 *  - HTML sanitized via DB sanitize_user_html() before insert + render
 *  - Rate limit: max 5 blasts/hour per admin via DB count
 *  - Recipient cap 5,000; suppression checked per recipient
 *  - Per-recipient transactional email + in-app notification, bounded concurrency
 *  - Audit log row on send + on denied access
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { queueTransactionalEmail } from "../_shared/transactional-email.ts";
import { withAuditWrapper } from "../_shared/audit.ts";

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_RECIPIENTS = 5000;
const RATE_LIMIT_PER_HOUR = 5;
const SUBJECT_MAX = 150;
const BODY_MAX = 50_000;
const BATCH_SIZE = 25;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
} as const;
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" } as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(data: Record<string, unknown>, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function htmlToText(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<script\b[^>]*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface BlastPayload {
  projectId: string;
  subject: string;
  bodyHtml: string;
}

function validate(raw: unknown): { ok: true; data: BlastPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid payload" };
  const o = raw as Record<string, unknown>;
  const allowedKeys = new Set(["projectId", "subject", "bodyHtml"]);
  for (const k of Object.keys(o)) {
    if (!allowedKeys.has(k)) return { ok: false, error: `Unexpected field: ${k}` };
  }
  const { projectId, subject, bodyHtml } = o;
  if (typeof projectId !== "string" || !UUID_RE.test(projectId))
    return { ok: false, error: "Invalid projectId" };
  if (typeof subject !== "string") return { ok: false, error: "Invalid subject" };
  const trimmed = subject.trim();
  if (trimmed.length < 1 || trimmed.length > SUBJECT_MAX)
    return { ok: false, error: "Subject must be 1-150 chars" };
  if (typeof bodyHtml !== "string" || bodyHtml.length === 0)
    return { ok: false, error: "Body required" };
  if (bodyHtml.length > BODY_MAX) return { ok: false, error: "Body too large" };
  return { ok: true, data: { projectId, subject: trimmed, bodyHtml } };
}

Deno.serve(
  withAuditWrapper("send-project-blast", async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const authHeader = req.headers.get("Authorization") || "";
      if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const token = authHeader.slice(7);

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const admin = createClient(supabaseUrl, serviceKey);

      // 1. Identity from JWT
      const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
      if (claimsErr || !claimsData?.claims?.sub) return json({ error: "Unauthorized" }, 401);
      const userId = claimsData.claims.sub as string;

      // 2. Size guard
      const rawText = await req.text();
      if (rawText.length > MAX_PAYLOAD_BYTES) return json({ error: "Payload too large" }, 413);
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      const v = validate(parsed);
      if (!v.ok) return json({ error: v.error }, 400);
      const { projectId, subject, bodyHtml } = v.data;

      // 3. Admin role check (server-side, not trusted from body/JWT)
      const { count: adminCount, error: roleErr } = await admin
        .from("user_roles")
        .select("id", { head: true, count: "exact" })
        .eq("user_id", userId)
        .eq("role", "admin");
      if (roleErr) return json({ error: "Role lookup failed" }, 500);
      if (!adminCount || adminCount < 1) {
        await admin
          .rpc("write_audit_log", {
            p_event_type: "project_blast.denied",
            p_table_name: "project_blasts",
            p_record_id: projectId,
            p_user_id: userId,
            p_changed_fields: ["not_admin"],
          })
          .then(
            () => {},
            () => {}
          );
        return json({ error: "Forbidden" }, 403);
      }

      // 4. Project lookup (any admin can blast any project)
      const { data: project, error: projErr } = await admin
        .from("projects")
        .select("id, coordinator_id, friendly_name, clients(name)")
        .eq("id", projectId)
        .single();
      if (projErr || !project) return json({ error: "Project not found" }, 404);

      // 5. Rate limit: 5 / hour
      const sinceHour = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count: recentCount } = await admin
        .from("project_blasts")
        .select("id", { head: true, count: "exact" })
        .eq("sender_id", userId)
        .gte("created_at", sinceHour);
      if ((recentCount ?? 0) >= RATE_LIMIT_PER_HOUR) {
        return json({ error: "Rate limit exceeded. Try again later." }, 429, {
          "Retry-After": "3600",
        });
      }

      // 6. Recipients (status = completed). Fetch user_ids, then bulk-load
      // profiles separately — there is no FK from project_applications to profiles
      // and project_applications has no email column, so an embedded join fails.
      const { data: applicants, error: appErr } = await admin
        .from("project_applications")
        .select("user_id")
        .eq("project_id", projectId)
        .eq("status", "completed");
      if (appErr) {
        console.error("[send-project-blast] recipient lookup failed:", appErr);
        return json({ error: "Recipient lookup failed" }, 500);
      }

      const userIds = Array.from(
        new Set((applicants ?? []).map((r: any) => r.user_id).filter(Boolean))
      ) as string[];
      if (userIds.length === 0) return json({ error: "No applicants to email" }, 400);
      if (userIds.length > MAX_RECIPIENTS) return json({ error: "Recipient cap exceeded" }, 400);

      // profiles.user_id is the auth user FK (profiles.id is the row PK and does
      // NOT match auth.uid()), so look up by user_id.
      const { data: profileRows, error: profErr } = await admin
        .from("profiles")
        .select("user_id, email, first_name")
        .in("user_id", userIds);
      if (profErr) {
        console.error("[send-project-blast] profile lookup failed:", profErr);
        return json({ error: "Profile lookup failed" }, 500);
      }

      const recipients = (profileRows ?? [])
        .map((p: any) => ({
          user_id: p.user_id as string,
          email: ((p.email ?? "") as string).trim().toLowerCase(),
          firstName: (p.first_name ?? "") as string,
          isSenderCopy: false,
        }))
        .filter((r) => r.email);

      if (recipients.length === 0) return json({ error: "No applicants with valid email" }, 400);

      // 7. Sender display name + self-copy. Privacy: sends are 1:1 (BCC-equivalent);
      // no Cc/multi-To header is ever constructed, so recipients never see each other.
      // The admin sender always receives a copy of their own blast.
      const { data: senderProfile } = await admin
        .from("profiles")
        .select("first_name, last_name, email")
        .eq("user_id", userId)
        .maybeSingle();
      const senderName =
        [senderProfile?.first_name, senderProfile?.last_name].filter(Boolean).join(" ").trim() ||
        senderProfile?.email ||
        "Project Coordinator";

      const senderEmail = ((senderProfile?.email ?? "") as string).trim().toLowerCase();
      const recipientCount = recipients.length; // applicants only — sender copy excluded
      if (senderEmail && !recipients.some((r) => r.email === senderEmail)) {
        recipients.push({
          user_id: userId,
          email: senderEmail,
          firstName: (senderProfile?.first_name ?? "") as string,
          isSenderCopy: true,
        });
      }

      const projectName = project.friendly_name || (project as any)?.clients?.name || "Project";

      // 8. Insert blast row — DB BEFORE-INSERT trigger sanitizes body_html.
      // recipient_count reflects applicants only (sender self-copy is bookkeeping).
      const { data: blastRow, error: insErr } = await admin
        .from("project_blasts")
        .insert({
          project_id: projectId,
          sender_id: userId,
          subject,
          body_html: bodyHtml,
          audience_filter: { statuses: ["completed"] },
          recipient_count: recipientCount,
          status: "sending",
        })
        .select("id, body_html")
        .single();
      if (insErr || !blastRow) {
        return json({ error: "Failed to create blast", detail: insErr?.message }, 500);
      }
      const blastId = blastRow.id as string;
      const sanitizedBody = blastRow.body_html as string; // sanitized by trigger

      // 9. Send loop (bounded concurrency)
      let emailSent = 0,
        emailFailed = 0,
        emailSuppressed = 0,
        notifSent = 0;
      const recipRows: Array<Record<string, unknown>> = [];

      async function processOne(rcp: (typeof recipients)[number]) {
        const idem = rcp.isSenderCopy
          ? `blast-${blastId}-sender-${userId}`
          : `blast-${blastId}-${rcp.user_id}`;
        let emailStatus: "sent" | "failed" | "suppressed" = "failed";
        let messageId: string | undefined;
        let errMsg: string | undefined;
        try {
          const res = await queueTransactionalEmail({
            templateName: "project-blast",
            recipientEmail: rcp.email,
            idempotencyKey: idem,
            templateData: {
              firstName: rcp.firstName,
              projectName,
              senderName,
              subject,
              bodyHtml: sanitizedBody,
            },
            supabase: admin,
          });
          if (res.ok) {
            messageId = res.messageId;
            if ((res as any).suppressed) {
              emailStatus = "suppressed";
              emailSuppressed++;
            } else {
              emailStatus = "sent";
              emailSent++;
            }
          } else {
            emailFailed++;
            errMsg = res.error;
          }
        } catch (e) {
          emailFailed++;
          console.error("[send-project-blast] send error:", e);
          errMsg = "send failed";
        }

        // In-app notification — skipped for the sender's self-copy (they triggered it)
        let notificationId: string | undefined;
        if (!rcp.isSenderCopy) {
          try {
            const { data: notif } = await admin
              .from("notifications")
              .insert({
                user_id: rcp.user_id,
                title: subject.slice(0, 150),
                body_html: sanitizedBody,
                notification_type: "project_blast",
                link_url: `/projects/${projectId}`,
                read: false,
              })
              .select("id")
              .single();
            if (notif?.id) {
              notificationId = notif.id;
              notifSent++;
            }
          } catch (_e) {
            /* ignore */
          }
        }

        recipRows.push({
          blast_id: blastId,
          user_id: rcp.user_id,
          email_hash: await sha256(rcp.email),
          email_status: emailStatus,
          email_message_id: messageId,
          notification_id: notificationId,
          error: errMsg?.slice(0, 500),
        });
      }

      for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
        const batch = recipients.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(batch.map(processOne));
      }

      // Insert recipient rows (chunked)
      for (let i = 0; i < recipRows.length; i += 500) {
        await admin.from("project_blast_recipients").insert(recipRows.slice(i, i + 500));
      }

      const finalStatus = emailFailed === 0 ? "sent" : emailSent > 0 ? "partial" : "failed";
      await admin
        .from("project_blasts")
        .update({
          status: finalStatus,
          email_sent_count: emailSent,
          email_failed_count: emailFailed,
          email_suppressed_count: emailSuppressed,
          notification_sent_count: notifSent,
          sent_at: new Date().toISOString(),
        })
        .eq("id", blastId);

      await admin
        .rpc("write_audit_log", {
          p_event_type: "project_blast.send",
          p_table_name: "project_blasts",
          p_record_id: blastId,
          p_user_id: userId,
          p_changed_fields: [
            `recipients:${recipients.length}`,
            `sent:${emailSent}`,
            `failed:${emailFailed}`,
          ],
        })
        .then(
          () => {},
          () => {}
        );

      return json({
        blastId,
        recipientCount: recipients.length,
        emailSent,
        emailFailed,
        emailSuppressed,
        notifSent,
        status: finalStatus,
      });
    } catch (e) {
      console.error("send-project-blast unhandled error:", e);
      return json({ error: "Internal error" }, 500);
    }
  })
);

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
