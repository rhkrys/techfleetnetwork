// @edge-cron
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { createEdgeLogger } from "../_shared/logger.ts";
import { discordFetch } from "../_shared/discord-fetch.ts";
import { withAuditWrapper } from "../_shared/audit.ts";

const log = createEdgeLogger("repair-discord-username");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function isUsable(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed === ".") return false;
  return trimmed.replace(/^\.+/, "").trim().length > 0;
}

serve(withAuditWrapper("repair-discord-username", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const requestId = crypto.randomUUID().substring(0, 8);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN");
  const GUILD_ID = Deno.env.get("DISCORD_GUILD_ID");

  if (!BOT_TOKEN || !GUILD_ID) {
    return new Response(JSON.stringify({ error: "Discord bot not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: authErr } = await userClient.auth.getClaims(token);
  const userId = claimsData?.claims?.sub;
  if (authErr || !userId) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Load current profile
  const { data: profile, error: profileErr } = await adminClient
    .from("profiles")
    .select("user_id, discord_user_id, discord_username")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileErr || !profile) {
    return new Response(JSON.stringify({ repaired: false, reason: "profile-not-found" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const discordUserId = (profile.discord_user_id ?? "").trim();
  if (!discordUserId) {
    return new Response(JSON.stringify({ repaired: false, reason: "not-linked" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const currentUsername = profile.discord_username;
  const currentIsUsable = isUsable(currentUsername);
  // Repair when unusable, OR when leading-dot (legacy) — but only if Discord disagrees.
  const isLegacyLeadingDot = currentIsUsable && typeof currentUsername === "string" && currentUsername.startsWith(".");

  if (currentIsUsable && !isLegacyLeadingDot) {
    return new Response(JSON.stringify({ repaired: false, reason: "already-usable" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Fetch live member from Discord
  const memberUrl = `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${discordUserId}`;
  let memberRes: Response;
  try {
    const { response } = await discordFetch(memberUrl, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
      maxRetries: 2,
    });
    memberRes = response;
  } catch (err) {
    log.warn("repair", `Discord unreachable [${requestId}]`, { requestId, userId }, err as Error);
    return new Response(JSON.stringify({ repaired: false, reason: "discord-unreachable" }), {
      status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!memberRes.ok) {
    await memberRes.text().catch(() => "");
    return new Response(JSON.stringify({ repaired: false, reason: "discord-not-member", status: memberRes.status }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const member = await memberRes.json();
  const liveUsername: string = member?.user?.username ?? "";

  if (!isUsable(liveUsername)) {
    log.warn("repair", `Discord returned unusable username [${requestId}]`, { requestId, userId });
    return new Response(JSON.stringify({ repaired: false, reason: "discord-empty-username" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // For legacy leading-dot rows, only overwrite if the live username is NOT also dot-leading
  // (some Discord handles legitimately start with `.`).
  if (isLegacyLeadingDot && liveUsername.startsWith(".")) {
    return new Response(JSON.stringify({ repaired: false, reason: "discord-also-dot-leading" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (liveUsername === currentUsername) {
    return new Response(JSON.stringify({ repaired: false, reason: "unchanged" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Update ONLY discord_username — never touch discord_user_id or has_discord_account.
  const { error: updateErr } = await adminClient
    .from("profiles")
    .update({ discord_username: liveUsername })
    .eq("user_id", userId);

  if (updateErr) {
    log.error("repair", `Failed to persist repaired username [${requestId}]`, { requestId, userId }, updateErr);
    return new Response(JSON.stringify({ repaired: false, reason: "db-error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    await adminClient.rpc("write_audit_log", {
      p_event_type: "discord_username_repaired",
      p_table_name: "profiles",
      p_record_id: userId,
      p_user_id: userId,
      p_changed_fields: [`old:${currentUsername ?? "null"}`, `new:${liveUsername}`],
    });
  } catch { /* swallow */ }

  log.info("repair", `Repaired Discord username for ${userId} [${requestId}]`, { requestId, userId });
  return new Response(JSON.stringify({ repaired: true, discord_username: liveUsername }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}));
