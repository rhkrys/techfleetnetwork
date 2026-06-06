// @edge-cron
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getAdminClient } from "../_shared/admin-client.ts";
import { handleCors, jsonResponse, parseJsonBody } from "../_shared/http.ts";
import { createEdgeLogger } from "../_shared/logger.ts";
import { requireAuthenticatedRequest } from "../_shared/request-auth.ts";
import { buildMessage, validateNotifyPayload, type NotifyPayload } from "./notify-utils.ts";

import { withAuditWrapper } from "../_shared/audit.ts";
const log = createEdgeLogger("discord-notify");

/**
 * SECURITY: Originally callable without auth, which made the Discord webhook
 * a spam vector for any anonymous client. Fixed 2026-04-18 audit:
 *  • Requires a valid Supabase JWT
 *  • Server-side rate limit (5 req / 1 min per user) via check_rate_limit
 *  • Duplicate payload suppression to stop authenticated session replay/bots
 *  • Strict allow-list of event types (existing) and bounded body
 */

const MAX_BODY_BYTES = 8 * 1024;
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/techfleet\.network$/,
  /^https:\/\/www\.techfleet\.network$/,
  /^https:\/\/techfleetnetwork\.lovable\.app$/,
  /^https:\/\/id-preview--3ae718a9-cd87-4a00-991b-209d8baa78ad\.lovable\.app$/,
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
];

function isAllowedUiOrigin(req: Request) {
  const origin = req.headers.get("Origin") || req.headers.get("Referer")?.replace(/\/[^/]*$/, "") || "";
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

async function requestFingerprint(userId: string, payload: NotifyPayload) {
  const stable = JSON.stringify({
    userId,
    event: payload.event,
    display_name: payload.display_name ?? "",
    discord_user_id: payload.discord_user_id ?? "",
    task_name: payload.task_name ?? "",
    phase_name: payload.phase_name ?? "",
    class_name: payload.class_name ?? "",
    project_name: payload.project_name ?? "",
    application_type: payload.application_type ?? "",
    feedback_area: payload.feedback_area ?? "",
    search_query: payload.search_query ?? "",
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

serve(withAuditWrapper("discord-notify", async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const requestId = crypto.randomUUID().substring(0, 8);
  log.info("handler", `Request received [${requestId}]`, { requestId });

  if (!isAllowedUiOrigin(req)) {
    log.warn("handler", `Blocked non-UI origin [${requestId}]`, { requestId });
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  const auth = await requireAuthenticatedRequest(req);
  if (auth instanceof Response) return auth;
  const userId = auth.userId;

  // ── Server-side rate limit (5 events / 1 min per user, 60 min block) ─
  const adminClient = getAdminClient();
  const { data: rl } = await adminClient.rpc("check_rate_limit", {
    p_identifier: userId,
    p_action: "discord_notify",
    p_max_attempts: 5,
    p_window_minutes: 1,
    p_block_minutes: 60,
  });
  if (rl && !rl.allowed) {
    return jsonResponse({ error: "Too many notifications", retry_after: rl.retry_after ?? 3600 }, 429);
  }

  try {
    const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_BODY_BYTES) {
      log.warn("handler", `Request body too large [${requestId}]: ${contentLength} bytes`, { requestId, contentLength });
      return jsonResponse({ error: "Request body too large" }, 413);
    }

    const validation = validateNotifyPayload(await parseJsonBody(req, MAX_BODY_BYTES));
    if (!validation.ok) {
      log.warn("handler", `Missing/invalid event [${requestId}]`, { requestId });
      return jsonResponse({ error: validation.error }, 400);
    }
    const payload = validation.payload;

    const fingerprint = await requestFingerprint(userId, payload);
    const { data: duplicateRl } = await adminClient.rpc("check_rate_limit", {
      p_identifier: `${userId}:${fingerprint}`,
      p_action: "discord_notify_duplicate",
      p_max_attempts: 1,
      p_window_minutes: 10,
      p_block_minutes: 60,
    });
    if (duplicateRl && !duplicateRl.allowed) {
      log.warn("handler", `Blocked duplicate Discord notification payload [${requestId}]`, { requestId, event: payload.event });
      return jsonResponse({ error: "Duplicate notification blocked", retry_after: duplicateRl.retry_after ?? 3600 }, 429);
    }

    const DISCORD_WEBHOOK_URL = Deno.env.get("DISCORD_WEBHOOK_URL");
    if (!DISCORD_WEBHOOK_URL) {
      log.warn("config", `DISCORD_WEBHOOK_URL is not configured; skipping notification [${requestId}]`, { requestId, event: payload.event });
      return jsonResponse({ success: false, skipped: true, reason: "webhook_not_configured" });
    }

    log.info("notify", `Processing event "${payload.event}" for "${payload.display_name || "unknown"}" [${requestId}]`, {
      requestId,
      event: payload.event,
      displayName: payload.display_name,
      discordUsername: payload.discord_username,
      discordUserId: payload.discord_user_id,
    });

    const discordBody = {
      content: buildMessage(payload),
      allowed_mentions: { users: payload.discord_user_id ? [payload.discord_user_id] : [] },
    };

    try {
      log.info("notify", `Sending webhook to Discord [${requestId}]`, { requestId, event: payload.event });
      const discordRes = await fetch(DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(discordBody),
      });

      if (!discordRes.ok) {
        const errorText = await discordRes.text();
        log.warn("notify", `Discord API rejected webhook [${requestId}]: HTTP ${discordRes.status} — ${errorText}`, {
          requestId,
          httpStatus: discordRes.status,
          responseBody: errorText.substring(0, 500),
          event: payload.event,
        });
        return jsonResponse({ success: false, skipped: true, reason: "discord_api_error", status: discordRes.status });
      }

      await discordRes.text();
      log.info("notify", `Discord notification sent successfully [${requestId}]`, { requestId, event: payload.event });
      return jsonResponse({ success: true });
    } catch (err) {
      log.warn("notify", `Discord request failed; skipping notification [${requestId}]`, { requestId, event: payload.event }, err);
      return jsonResponse({ success: false, skipped: true, reason: "discord_request_failed" });
    }
  } catch (err) {
    log.error("handler", `Unhandled exception [${requestId}]`, { requestId }, err);
    // OWASP A09: Generic error message
    return jsonResponse({ error: "An unexpected error occurred" }, 500);
  }
}));
