// @edge-auth
// Returns the cached Discord guild member count. Refreshes from Discord at most once every 24h.
// Public (no auth required) — the value is shown on the logged-out landing page.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withAuditWrapper } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DISCORD_TIMEOUT_MS = 8_000;

interface CacheRow {
  guild_id: string;
  member_count: number;
  presence_count: number;
  fetched_at: string;
}

async function fetchFromDiscord(
  guildId: string,
  botToken: string
): Promise<{ member_count: number; presence_count: number } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DISCORD_TIMEOUT_MS);
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}?with_counts=true`, {
      headers: { Authorization: `Bot ${botToken}` },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn("[get-discord-member-count] Discord API non-ok:", res.status);
      return null;
    }
    const json = await res.json();
    return {
      member_count: Number(json.approximate_member_count ?? 0),
      presence_count: Number(json.approximate_presence_count ?? 0),
    };
  } catch (err) {
    console.warn("[get-discord-member-count] Discord fetch failed:", (err as Error).message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(
  withAuditWrapper("get-discord-member-count", async (req) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const guildId = Deno.env.get("DISCORD_GUILD_ID");
      const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      if (!guildId) {
        return new Response(JSON.stringify({ error: "Discord not configured" }), {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = createClient(supabaseUrl, serviceKey);

      const { data: existing } = await supabase
        .from("discord_guild_stats")
        .select("guild_id, member_count, presence_count, fetched_at")
        .eq("guild_id", guildId)
        .maybeSingle<CacheRow>();

      const now = Date.now();
      const isStale =
        !existing || now - new Date(existing.fetched_at).getTime() >= REFRESH_INTERVAL_MS;

      let payload = existing;

      if (isStale && botToken) {
        const fresh = await fetchFromDiscord(guildId, botToken);
        if (fresh) {
          const { data: upserted } = await supabase
            .from("discord_guild_stats")
            .upsert(
              {
                guild_id: guildId,
                member_count: fresh.member_count,
                presence_count: fresh.presence_count,
                fetched_at: new Date().toISOString(),
              },
              { onConflict: "guild_id" }
            )
            .select("guild_id, member_count, presence_count, fetched_at")
            .single<CacheRow>();
          if (upserted) payload = upserted;
        }
      }

      return new Response(
        JSON.stringify({
          member_count: payload?.member_count ?? 0,
          presence_count: payload?.presence_count ?? 0,
          fetched_at: payload?.fetched_at ?? null,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300",
          },
        }
      );
    } catch (err) {
      console.error("[get-discord-member-count] error:", err);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  })
);
