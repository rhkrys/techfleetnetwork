// @edge-cron
// register-support-command — registers the Discord /support slash command.
// Admin-only (hits Discord's bot API; abusable if public). One-time admin action,
// same pattern as register-fleety-command.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createEdgeLogger } from "../_shared/logger.ts";
import { discordFetch } from "../_shared/discord-fetch.ts";

import { withAuditWrapper } from "../_shared/audit.ts";
const log = createEdgeLogger("register-support-command");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(withAuditWrapper("register-support-command", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: roleRow } = await adminClient
      .from("user_roles")
      .select("id")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleRow) {
      log.warn("auth", `Non-admin user attempted command registration: ${user.id}`);
      return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
    const appId = Deno.env.get("DISCORD_APPLICATION_ID");

    if (!botToken || !appId) {
      throw new Error("Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID");
    }

    // Register the /support global slash command (with retry).
    const { response: res, retries } = await discordFetch(
      `https://discord.com/api/v10/applications/${appId}/commands`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "support",
          description: "Open a Tech Fleet support ticket",
          type: 1, // CHAT_INPUT
          options: [
            {
              name: "subject",
              description: "A short summary of your issue",
              type: 3, // STRING
              required: true,
            },
            {
              name: "details",
              description: "What do you need help with?",
              type: 3, // STRING
              required: true,
            },
          ],
        }),
      },
    );

    if (retries > 0) {
      log.info("register", `Command registration succeeded after ${retries} retries`);
    }

    const data = await res.json();

    if (!res.ok) {
      log.error("register", `Discord API error [${res.status}]: ${JSON.stringify(data)}`);
      return new Response(JSON.stringify({ error: data }), {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    log.info("register", `Slash command registered: ${data.id}`);

    return new Response(
      JSON.stringify({ success: true, command_id: data.id, name: data.name }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    log.error("register", `Error: ${msg}`);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
