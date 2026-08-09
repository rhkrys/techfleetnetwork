// @edge-auth required
// Scheduled job: find users in auth.users who registered shortly ago and never confirmed,
// generate a fresh signup confirmation link, and email it to them as a reminder.
// Safeguards: capped reminders, minimum spacing between reminders, hard cutoff at 14 days.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { SignupEmail } from "../_shared/email-templates/signup.tsx";

import { withAuditWrapper } from "../_shared/audit.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REMINDER_AFTER_MINUTES = 10;
const MIN_MINUTES_BETWEEN_REMINDERS = 30;
const MAX_REMINDERS_PER_USER = 4;
const HARD_CUTOFF_DAYS = 14;
// Burst control: enqueue at most N safety-net signup reminders per cron tick
// so we never flood the workspace per-second email quota. The cron runs every
// 6h; with MAX_PER_CYCLE=1 an unconfirmed user still gets a reminder within
// the next cycle, but the burst that previously starved the transactional
// lane (5 simultaneous sends triggering shared-quota 429s) is gone.
const MAX_PER_CYCLE = 1;
const APP_URL = "https://techfleet.network";
const SITE_NAME = "Tech Fleet Network";
const SENDER_DOMAIN = "notify.techfleet.org";
const FROM_DOMAIN = "techfleet.org";

Deno.serve(
  withAuditWrapper("resend-signup-confirmations", async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Service-role only (cron / admin invocation). Compare the bearer token
    // directly against the env-injected service-role key. Do NOT fall back to
    // decoding the JWT payload and trusting an unsigned `role` claim — anyone
    // could forge `header.{"role":"service_role"}.sig` and bypass auth.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!serviceRoleKey || !token || token !== serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient<any>(supabaseUrl, serviceKey);

    const now = new Date();
    const reminderThreshold = new Date(now.getTime() - REMINDER_AFTER_MINUTES * 60 * 1000);
    const hardCutoff = new Date(now.getTime() - HARD_CUTOFF_DAYS * 24 * 3600 * 1000);
    const minGapThreshold = new Date(now.getTime() - MIN_MINUTES_BETWEEN_REMINDERS * 60 * 1000);

    let processed = 0;
    let sent = 0;
    let skipped = 0;
    const errors: Array<{ email: string; error: string }> = [];

    try {
      // Page through auth.users via admin API (paginate up to ~10 pages = 10,000 users)
      const candidates: Array<{ id: string; email: string; created_at: string }> = [];
      for (let page = 1; page <= 10; page++) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        const users = data?.users ?? [];
        if (users.length === 0) break;

        for (const u of users) {
          if (!u.email) continue;
          if (u.email_confirmed_at) continue;
          const createdAt = new Date(u.created_at);
          if (createdAt > reminderThreshold) continue; // too new
          if (createdAt < hardCutoff) continue; // too old, give up
          candidates.push({ id: u.id, email: u.email, created_at: u.created_at });
        }

        if (users.length < 1000) break;
      }

      console.log(`[resend-signup-confirmations] ${candidates.length} unconfirmed candidates`);

      for (const c of candidates) {
        processed++;
        try {
          // Check existing reminder history
          const { data: existing } = await supabase
            .from("signup_confirmation_reminders")
            .select("attempt_number, sent_at")
            .eq("user_id", c.id)
            .order("sent_at", { ascending: false });

          const reminderCount = existing?.length ?? 0;
          if (reminderCount >= MAX_REMINDERS_PER_USER) {
            skipped++;
            continue;
          }

          if (existing && existing.length > 0) {
            const lastSent = new Date(existing[0].sent_at);
            if (lastSent > minGapThreshold) {
              skipped++;
              continue;
            }
          }

          // Generate a fresh signup confirmation link.
          // supabase-js types `type: "signup"` as requiring `password` (it models
          // NEW-user creation). Here we re-issue a confirmation link for an
          // ALREADY-registered but unconfirmed user — GoTrue accepts no password,
          // and passing one would be wrong. Cast to the param type; the runtime
          // call is unchanged.
          const linkParams = {
            type: "signup",
            email: c.email,
            options: { redirectTo: `${APP_URL}/` },
          } as Parameters<typeof supabase.auth.admin.generateLink>[0];
          const { data: linkData, error: linkErr } =
            await supabase.auth.admin.generateLink(linkParams);

          if (linkErr || !linkData?.properties?.action_link) {
            errors.push({ email: c.email, error: linkErr?.message ?? "no link returned" });
            continue;
          }

          const confirmationUrl = linkData.properties.action_link;
          const hoursAgo = Math.max(
            1,
            Math.round((now.getTime() - new Date(c.created_at).getTime()) / 3600000)
          );
          const attemptNumber = reminderCount + 1;
          const messageId = `signup-fallback-${c.id}-${attemptNumber}-${crypto.randomUUID()}`;

          // Mint or look up an unsubscribe token. Lovable's transactional email
          // gateway 400s with `missing_unsubscribe` and dead-letters the message
          // if this is absent — same logic as auth-email-hook.
          const normalizedEmail = c.email.trim().toLowerCase();
          let unsubscribeToken: string | null = null;
          try {
            const { data: existingTok } = await supabase
              .from("email_unsubscribe_tokens")
              .select("token")
              .eq("email", normalizedEmail)
              .order("used_at", { ascending: true })
              .order("created_at", { ascending: true })
              .limit(1);
            if (existingTok && existingTok.length > 0) {
              unsubscribeToken = existingTok[0].token as string;
            } else {
              const fresh = crypto.getRandomValues(new Uint8Array(32));
              unsubscribeToken = Array.from(fresh)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
              const { error: upsertErr } = await supabase
                .from("email_unsubscribe_tokens")
                .upsert(
                  { email: normalizedEmail, token: unsubscribeToken },
                  { onConflict: "email", ignoreDuplicates: true }
                );
              if (upsertErr) {
                const { data: raceRow } = await supabase
                  .from("email_unsubscribe_tokens")
                  .select("token")
                  .eq("email", normalizedEmail)
                  .limit(1);
                if (raceRow && raceRow.length > 0) unsubscribeToken = raceRow[0].token as string;
              }
            }
          } catch (tokenErr) {
            console.error("[resend-signup-confirmations] failed to mint unsubscribe token", {
              email: c.email,
              err: String(tokenErr),
            });
          }
          if (!unsubscribeToken) {
            errors.push({ email: c.email, error: "failed to mint unsubscribe token" });
            continue;
          }

          const templateProps = {
            siteName: SITE_NAME,
            siteUrl: APP_URL,
            recipient: c.email,
            confirmationUrl,
          };
          const html = await renderAsync(React.createElement(SignupEmail, templateProps));
          const text = await renderAsync(React.createElement(SignupEmail, templateProps), {
            plainText: true,
          });

          await supabase.from("email_send_log").insert({
            message_id: messageId,
            template_name: "signup",
            recipient_email: c.email,
            status: "pending",
          });

          // Route through the v2 pipeline (email_outbox -> email-dispatcher-v2 ->
          // Resend). The legacy `enqueue_email` RPC only does `pgmq.send` into the
          // `auth_emails` queue, whose consumer (process-email-queue) was retired
          // at the July v2 cutover, so these safety-net signup reminders were
          // silently stranded and never delivered. The Resend provider reads
          // payload.html / payload.text + subject; message_id matches the
          // email_send_log 'pending' row for the terminal write-back trigger.
          const { error: sendErr } = await supabase.rpc("enqueue_email_v2", {
            p_lane: "auth",
            p_template: "signup",
            p_recipient: c.email,
            p_subject: "Confirm your email",
            p_payload: {
              message_id: messageId,
              to: c.email,
              from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
              sender_domain: SENDER_DOMAIN,
              subject: "Confirm your email",
              html,
              text,
              purpose: "transactional",
              label: "signup",
              unsubscribe_token: unsubscribeToken,
              idempotency_key: `signup-fallback-${c.id}-${attemptNumber}`,
              queued_at: new Date().toISOString(),
              recovery_reason: "unconfirmed_signup_safety_net",
              hours_since_signup: hoursAgo,
            },
            p_idempotency_key: `signup-fallback-${c.id}-${attemptNumber}`,
            p_message_id: messageId,
          });

          if (sendErr) {
            await supabase.from("email_send_log").insert({
              message_id: messageId,
              template_name: "signup",
              recipient_email: c.email,
              status: "failed",
              error_message: "Failed to enqueue signup confirmation fallback",
            });
            errors.push({ email: c.email, error: "send failed" });
            continue;
          }

          // Log the reminder
          await supabase.from("signup_confirmation_reminders").insert({
            user_id: c.id,
            email: c.email,
            attempt_number: attemptNumber,
          });

          sent++;
          if (sent >= MAX_PER_CYCLE) {
            console.log(
              `[resend-signup-confirmations] reached MAX_PER_CYCLE=${MAX_PER_CYCLE}, deferring remaining ${candidates.length - processed} to next tick`
            );
            break;
          }
        } catch (err) {
          console.error("[resend-signup-confirmations] per-candidate error:", err);
          errors.push({ email: c.email, error: "processing failed" });
        }
      }

      // Count *truly* stuck pending signup emails. The queue pipeline writes a
      // 'pending' row first and then a separate 'sent'/'failed'/'dlq' row keyed
      // by the same message_id (rows are append-only, never updated). A naive
      // COUNT(status='pending') therefore inflates forever as successful sends
      // accumulate. Dedupe by message_id and inspect the LATEST status only.
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: stuckRows } = await supabase.rpc("email_send_log_latest_stuck", {
        p_template_name: "signup",
        p_older_than: fifteenMinAgo,
      });
      const stuckPending: number = Array.isArray(stuckRows) ? stuckRows.length : (stuckRows ?? 0);

      const { data: failedRows } = await supabase.rpc("email_send_log_latest_failed", {
        p_template_name: "signup",
        p_since: oneDayAgo,
      });
      const failedSignupEmails: number = Array.isArray(failedRows)
        ? failedRows.length
        : (failedRows ?? 0);

      if ((stuckPending ?? 0) > 0 || (failedSignupEmails ?? 0) > 0 || errors.length > 0) {
        // Always include a non-null error_message so this fingerprint surfaces
        // in System Health → Top Errors (which filters error_message IS NOT NULL).
        const summary = errors.length
          ? errors
              .slice(0, 3)
              .map((e) => e.error)
              .join("; ")
          : `Signup email pipeline degraded — stuck_pending:${stuckPending ?? 0} · failed_last_24h:${failedSignupEmails ?? 0} · fallback_errors:${errors.length}`;
        await supabase.rpc("write_audit_log", {
          p_event_type: "email_signup_confirmation_pipeline_unhealthy",
          p_table_name: "email_send_log",
          p_record_id: null,
          p_user_id: null,
          p_changed_fields: [
            `stuck_pending:${stuckPending ?? 0}`,
            `failed_last_24h:${failedSignupEmails ?? 0}`,
            `fallback_errors:${errors.length}`,
          ],
          p_error_message: summary,
        });
      }

      return new Response(
        JSON.stringify({
          processed,
          sent,
          skipped,
          errors: errors.slice(0, 20),
          candidates: candidates.length,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      console.error("[resend-signup-confirmations] fatal:", err);
      return new Response(JSON.stringify({ error: "Internal error", processed, sent, skipped }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  })
);
