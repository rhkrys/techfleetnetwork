// @edge-cron
import { withAuditWrapper } from "../_shared/audit.ts";
/**
 * send-push-notification Edge Function
 *
 * Receives a push subscription + notification payload and sends a
 * Web Push message using VAPID authentication (RFC 8292).
 *
 * Uses the web-push npm package for VAPID signing and payload encryption.
 */

import webpush from "npm:web-push@3.6.7";
import { z } from "npm:zod@4.3.6";

// M-01: Lenient shape guard. Existing endpoint/keys checks below stay authoritative.
const BodySchema = z.object({
  endpoint: z.string().optional(),
  keys: z.object({
    p256dh: z.string().optional(),
    auth: z.string().optional(),
  }).passthrough().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  url: z.string().optional(),
  notification_type: z.string().optional(),
}).passthrough();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(withAuditWrapper("send-push-notification", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // --- Service role key validation (called from DB trigger) ---
  const authHeader = req.headers.get("Authorization");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authHeader || !serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  // --- End auth ---

  try {
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");

    if (!vapidPublic || !vapidPrivate) {
      console.error("VAPID keys not configured");
      return new Response(
        JSON.stringify({ error: "VAPID keys not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    webpush.setVapidDetails(
      "mailto:notifications@techfleet.org",
      vapidPublic,
      vapidPrivate,
    );

    const rawBody = await req.json();
    const parsedBody = BodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return new Response(
        JSON.stringify({ error: "Invalid body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const body = parsedBody.data as Record<string, any>;
    const { endpoint, keys, title, body: notifBody, url, notification_type } = body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return new Response(
        JSON.stringify({ error: "Invalid push subscription" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Validate endpoint URL to prevent SSRF
    try {
      const parsedUrl = new URL(endpoint);
      if (!["https:"].includes(parsedUrl.protocol)) {
        throw new Error("Invalid protocol");
      }
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid endpoint URL" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const pushSubscription = {
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    };

    const payload = JSON.stringify({
      title: typeof title === "string" ? title.slice(0, 100) : "Tech Fleet Notification",
      body: typeof notifBody === "string" ? notifBody.slice(0, 200) : "",
      url: typeof url === "string" ? url : "/dashboard",
      notification_type: notification_type || "general",
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
    });

    await webpush.sendNotification(pushSubscription, payload, {
      TTL: 86400, // 24 hours
      urgency: "normal",
    });

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string };
    console.error("Push send error:", error.message || err);

    // If subscription is expired/invalid (410 Gone), return 410 so caller can clean up
    if (error.statusCode === 410 || error.statusCode === 404) {
      return new Response(
        JSON.stringify({ error: "subscription_expired", endpoint: "" }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: "Push delivery failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}));
