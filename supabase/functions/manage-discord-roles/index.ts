// @edge-cron
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { z } from "npm:zod@4.3.6";
import { createEdgeLogger } from "../_shared/logger.ts";
import { discordFetch } from "../_shared/discord-fetch.ts";

// M-01: Lenient shape guard. Existing isValidAction discriminator below stays authoritative.
const BodySchema = z.object({ action: z.string().optional() }).passthrough();

import { withAuditWrapper } from "../_shared/audit.ts";
const log = createEdgeLogger("manage-discord-roles");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_BODY_BYTES = 4 * 1024;
const MAX_ROLE_NAME_LENGTH = 100;

interface ListAction {
  action: "list";
  search?: string;
}

interface CreateAction {
  action: "create";
  name: string;
}

interface AssignAction {
  action: "assign";
  discord_user_id: string;
  role_id: string;
}

interface RemoveAction {
  action: "remove";
  discord_user_id: string;
  role_id: string;
}

type RequestBody = ListAction | CreateAction | AssignAction | RemoveAction;

function isValidAction(body: unknown): body is RequestBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (b.action === "list") return true;
  if (b.action === "create" && typeof b.name === "string" && b.name.trim().length > 0) return true;
  if (b.action === "assign" && typeof b.discord_user_id === "string" && typeof b.role_id === "string" &&
      b.discord_user_id.trim().length > 0 && b.role_id.trim().length > 0) return true;
  if (b.action === "remove" && typeof b.discord_user_id === "string" && typeof b.role_id === "string" &&
      b.discord_user_id.trim().length > 0 && b.role_id.trim().length > 0) return true;
  return false;
}

async function logDiscordError(action: string, status: number, errorText: string, requestId: string) {
  try {
    const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const url = Deno.env.get("SUPABASE_URL");
    if (srk && url) {
      const ac = createClient(url, srk);
      await ac.rpc("write_audit_log", {
        p_event_type: "discord_bot_error",
        p_table_name: "discord_integration",
        p_record_id: `manage-discord-roles:${action}`,
        p_user_id: "00000000-0000-0000-0000-000000000000",
        p_error_message: `[${action}] HTTP ${status} — ${errorText}`.substring(0, 4000),
        p_changed_fields: [`request_id:${requestId}`, `http_status:${status}`],
      });
    }
  } catch { /* swallow */ }
}

serve(withAuditWrapper("manage-discord-roles", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().substring(0, 8);
  log.info("handler", `Request received [${requestId}]`);

  // ── Auth: require valid JWT ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN");
  const GUILD_ID = Deno.env.get("DISCORD_GUILD_ID");

  if (!BOT_TOKEN || !GUILD_ID) {
    log.error("config", `Discord bot not configured [${requestId}]`);
    return new Response(
      JSON.stringify({ error: "Discord bot not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_BODY_BYTES) {
      return new Response(
        JSON.stringify({ error: "Request body too large" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rawBody = await req.json();
    const parsedBody = BodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return new Response(
        JSON.stringify({ error: "Invalid body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const body = parsedBody.data as Record<string, unknown>;
    if (!isValidAction(body)) {
      return new Response(
        JSON.stringify({ error: "Invalid request. Provide { action: 'list' | 'create' | 'assign' | 'remove', ... }" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Admin check for mutating actions ──
    if (body.action !== "list") {
      const adminClient = createClient(supabaseUrl, serviceRoleKey);
      const { data: adminRole } = await adminClient
        .from("user_roles")
        .select("id")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .single();

      if (!adminRole) {
        return new Response(
          JSON.stringify({ error: "Forbidden: admin role required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const discordHeaders = { Authorization: `Bot ${BOT_TOKEN}` };

    // ---------- LIST ----------
    if (body.action === "list") {
      log.info("list", `Fetching guild roles [${requestId}]`);
      const { response: res, retries } = await discordFetch(
        `https://discord.com/api/v10/guilds/${GUILD_ID}/roles`,
        { headers: discordHeaders },
      );

      if (retries > 0) {
        log.info("list", `Guild roles fetch succeeded after ${retries} retries [${requestId}]`);
      }

      if (!res.ok) {
        const errorText = await res.text();
        log.error("list", `Discord API error [${requestId}]: ${res.status} — ${errorText.substring(0, 500)}`);
        await logDiscordError("list", res.status, errorText.substring(0, 500), requestId);
        return new Response(
          JSON.stringify({ error: "Failed to fetch Discord roles" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const roles = await res.json() as Array<{ id: string; name: string; color: number; position: number; managed: boolean }>;

      let filtered = roles
        .filter((r) => r.name !== "@everyone" && !r.managed)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (body.search && typeof body.search === "string" && body.search.trim()) {
        const q = body.search.trim().toLowerCase();
        filtered = filtered.filter((r) => r.name.toLowerCase().includes(q));
      }

      const result = filtered.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        position: r.position,
      }));

      log.info("list", `Returning ${result.length} roles [${requestId}]`);
      return new Response(
        JSON.stringify({ roles: result }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---------- CREATE ----------
    if (body.action === "create") {
      const roleName = body.name.trim();
      if (roleName.length > MAX_ROLE_NAME_LENGTH) {
        return new Response(
          JSON.stringify({ error: `Role name must be ${MAX_ROLE_NAME_LENGTH} characters or fewer` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      log.info("create", `Creating Discord role "${roleName}" [${requestId}]`);

      const { response: res, retries } = await discordFetch(
        `https://discord.com/api/v10/guilds/${GUILD_ID}/roles`,
        {
          method: "POST",
          headers: { ...discordHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: roleName,
            mentionable: true,
            permissions: "0",
          }),
        },
      );

      if (retries > 0) {
        log.info("create", `Role creation succeeded after ${retries} retries [${requestId}]`);
      }

      if (!res.ok) {
        const errorText = await res.text();
        log.error("create", `Discord API error creating role [${requestId}]: ${res.status} — ${errorText.substring(0, 500)}`);
        await logDiscordError("create", res.status, errorText.substring(0, 500), requestId);
        return new Response(
          JSON.stringify({ error: "Failed to create Discord role" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const role = await res.json() as { id: string; name: string; color: number; position: number };
      log.info("create", `Created role "${role.name}" (${role.id}) [${requestId}]`);

      return new Response(
        JSON.stringify({ role: { id: role.id, name: role.name, color: role.color, position: role.position } }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---------- ASSIGN ----------
    if (body.action === "assign") {
      const { discord_user_id, role_id } = body;
      log.info("assign", `Assigning role ${role_id} to user ${discord_user_id} [${requestId}]`);

      const { response: res, retries } = await discordFetch(
        `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${discord_user_id}/roles/${role_id}`,
        {
          method: "PUT",
          headers: discordHeaders,
        },
      );

      if (retries > 0) {
        log.info("assign", `Role assignment succeeded after ${retries} retries [${requestId}]`);
      }

      if (!res.ok) {
        const errorText = await res.text();
        log.error("assign", `Discord API error assigning role [${requestId}]: ${res.status} — ${errorText.substring(0, 500)}`);
        await logDiscordError("assign", res.status, errorText.substring(0, 500), requestId);

        const status = res.status;
        let userMessage = "Failed to assign Discord role";
        if (status === 403) userMessage = "Bot lacks permission to assign this role. Ensure the bot's role is higher than the target role in Discord server settings.";
        if (status === 404) userMessage = "Discord user or role not found in this server.";
        if (status === 429) userMessage = "Rate limited by Discord. Please try again shortly.";

        // Self-healing: queue the grant for automatic retry (skip non-recoverable 404s)
        if (status !== 404) {
          try {
            const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
            const url = Deno.env.get("SUPABASE_URL");
            if (srk && url) {
              const ac = createClient(url, srk);
              await ac.rpc("queue_discord_role_grant", {
                p_user_id: user.id,
                p_discord_user_id: discord_user_id,
                p_role_id: role_id,
                p_reason: "manage-discord-roles assign failed",
                p_error: `HTTP ${status}: ${errorText.substring(0, 300)}`,
              });
            }
          } catch { /* swallow */ }
        }

        return new Response(
          JSON.stringify({ error: userMessage, queued_for_retry: status !== 404 }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Discord returns 204 No Content on success
      await res.text();
      log.info("assign", `Role ${role_id} assigned to user ${discord_user_id} [${requestId}]`);

      // Mark any queued retries for this (discord_user_id, role_id) as granted
      try {
        const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        const url = Deno.env.get("SUPABASE_URL");
        if (srk && url) {
          const ac = createClient(url, srk);
          await ac
            .from("discord_role_grant_queue")
            .update({ granted_at: new Date().toISOString(), last_error: null })
            .eq("discord_user_id", discord_user_id)
            .eq("role_id", role_id)
            .is("granted_at", null);
        }
      } catch { /* swallow */ }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---------- REMOVE ----------
    if (body.action === "remove") {
      const { discord_user_id, role_id } = body;
      log.info("remove", `Removing role ${role_id} from user ${discord_user_id} [${requestId}]`);

      const { response: res, retries } = await discordFetch(
        `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${discord_user_id}/roles/${role_id}`,
        {
          method: "DELETE",
          headers: discordHeaders,
        },
      );

      if (retries > 0) {
        log.info("remove", `Role removal succeeded after ${retries} retries [${requestId}]`);
      }

      if (!res.ok) {
        const errorText = await res.text();
        log.error("remove", `Discord API error removing role [${requestId}]: ${res.status} — ${errorText.substring(0, 500)}`);
        await logDiscordError("remove", res.status, errorText.substring(0, 500), requestId);

        const status = res.status;
        let userMessage = "Failed to remove Discord role";
        if (status === 403) userMessage = "Bot lacks permission to remove this role.";
        if (status === 404) userMessage = "Discord user or role not found in this server.";

        return new Response(
          JSON.stringify({ error: userMessage }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      await res.text(); // consume body
      log.info("remove", `Role ${role_id} removed from user ${discord_user_id} [${requestId}]`);

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    log.error("handler", `Unhandled exception [${requestId}]`, { requestId }, err);
    const message = err instanceof Error ? err.message : "Unknown error";

    try {
      const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const url = Deno.env.get("SUPABASE_URL");
      if (srk && url) {
        const ac = createClient(url, srk);
        await ac.rpc("write_audit_log", {
          p_event_type: "discord_bot_error",
          p_table_name: "discord_integration",
          p_record_id: "manage-discord-roles",
          p_user_id: "00000000-0000-0000-0000-000000000000",
          p_error_message: message.substring(0, 4000),
        });
      }
    } catch { /* swallow */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}));
