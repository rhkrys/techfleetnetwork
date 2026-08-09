// @edge-cron
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.99.1";
import { z } from "npm:zod@3.23.8";
import { createEdgeLogger } from "../_shared/logger.ts";
import { discordFetch } from "../_shared/discord-fetch.ts";

import { withAuditWrapper } from "../_shared/audit.ts";
import { classifyResolveResult } from "./result-classifier.ts";
const log = createEdgeLogger("resolve-discord-id");

const BodySchema = z
  .object({
    discord_username: z.string().optional(),
    confirm_user_id: z.string().optional(),
  })
  .passthrough();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Max request body size (4 KB) */
const MAX_BODY_BYTES = 4 * 1024;
/** Max username length (Discord limit is 32) */
const MAX_USERNAME_LENGTH = 80;
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/techfleet\.network$/,
  /^https:\/\/www\.techfleet\.network$/,
  /^https:\/\/techfleetnetwork\.lovable\.app$/,
  /^https:\/\/id-preview--3ae718a9-cd87-4a00-991b-209d8baa78ad\.lovable\.app$/,
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
];

type DiscordMember = {
  user?: { id?: string; username?: string; global_name?: string | null; avatar?: string | null };
  nick?: string | null;
};

function discordDisplayName(member: DiscordMember): string | null {
  return member.nick || member.user?.global_name || member.user?.username || null;
}

function normalizeLookupValue(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/#\d{4}$/, "")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ");
}

function compactLookupValue(value: string): string {
  return normalizeLookupValue(value).replace(/[._\-\s]+/g, "");
}

function digitOnly(value: string): string | null {
  const digits = value.trim().match(/^<@!?(\d{15,25})>$|^(\d{15,25})$/);
  return digits ? (digits[1] ?? digits[2]) : null;
}

function buildSearchQueries(rawInput: string): string[] {
  const raw = rawInput.normalize("NFKC").trim();
  const normalized = normalizeLookupValue(raw);
  const tokens = normalized.split(/[\s._-]+/).filter((token) => token.length >= 3);
  return [
    ...new Set([raw.toLowerCase(), normalized, `.${normalized}`, ...tokens].filter(Boolean)),
  ].slice(0, 8);
}

function memberFields(member: DiscordMember): string[] {
  return [member.user?.username, member.user?.global_name ?? undefined, member.nick ?? undefined]
    .filter((value): value is string => Boolean(value))
    .map(normalizeLookupValue);
}

function isAllowedUiOrigin(req: Request) {
  const origin =
    req.headers.get("Origin") || req.headers.get("Referer")?.replace(/\/[^/]*$/, "") || "";
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

serve(
  withAuditWrapper("resolve-discord-id", async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const requestId = crypto.randomUUID().substring(0, 8);
    log.info("handler", `Request received [${requestId}]`, { requestId });

    if (!isAllowedUiOrigin(req)) {
      log.warn("handler", `Blocked non-UI origin [${requestId}]`, { requestId });
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── JWT auth check ────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY =
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: authErr } = await userClient.auth.getClaims(token);
    const userId = claimsData?.claims?.sub;
    if (authErr || !userId) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN");
    const GUILD_ID = Deno.env.get("DISCORD_GUILD_ID");

    if (!BOT_TOKEN || !GUILD_ID) {
      log.error(
        "config",
        `Discord bot not configured [${requestId}]: BOT_TOKEN=${!!BOT_TOKEN}, GUILD_ID=${!!GUILD_ID}`,
        { requestId }
      );
      return new Response(JSON.stringify({ error: "Discord bot not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      // A3: Enforce request body size limit
      const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
      if (contentLength > MAX_BODY_BYTES) {
        return new Response(JSON.stringify({ error: "Request body too large" }), {
          status: 413,
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
      const body: any = _parsed.data;
      const discord_username = body.discord_username;
      const confirm_user_id = body.confirm_user_id; // Optional: user picked a candidate
      if (confirm_user_id !== undefined && confirm_user_id !== null && confirm_user_id !== "") {
        // AUDIT H11 (interim lockdown, 2026-08-09): this branch bound a
        // CALLER-SUPPLIED Discord snowflake to the caller's OWN profile with NO
        // proof that the caller controls that account. Any signed-in user could
        // claim — and, via idx_profiles_discord_user_id_unique, permanently lock
        // out — an unlinked mentor/admin's Discord identity. Until a real
        // ownership-proof flow ships (bot-DM one-time code, or OAuth
        // authorization_code -> /users/@me snowflake match; tracked follow-up),
        // the identity-binding write is DISABLED. The read-only username search
        // path below is unaffected.
        log.warn(
          "resolve",
          `Blocked unproven self-service Discord bind for ${confirm_user_id} [${requestId}]`,
          { requestId, confirm_user_id }
        );
        try {
          await adminClient.rpc("write_audit_log", {
            p_event_type: "discord_link_blocked_no_ownership_proof",
            p_table_name: "profiles",
            p_record_id: userId,
            p_user_id: userId,
            p_changed_fields: [`attempted_discord_user_id:${String(confirm_user_id)}`],
          });
        } catch {
          /* swallow */
        }
        return new Response(
          JSON.stringify({
            discord_user_id: null,
            error:
              "Linking a Discord account is temporarily unavailable while we add ownership verification. Please check back soon.",
            code: "ownership_proof_required",
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (
        !discord_username ||
        typeof discord_username !== "string" ||
        discord_username.length > MAX_USERNAME_LENGTH
      ) {
        log.warn("validate", `Missing discord_username in request body [${requestId}]`, {
          requestId,
        });
        return new Response(JSON.stringify({ error: "discord_username is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rawUsername = discord_username.normalize("NFKC").trim().toLowerCase();
      const cleanUsername = normalizeLookupValue(rawUsername);
      const compactUsername = compactLookupValue(rawUsername);
      const directDiscordId = digitOnly(rawUsername);
      if (directDiscordId) {
        const memberUrl = `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${directDiscordId}`;
        const { response: directRes } = await discordFetch(memberUrl, {
          headers: { Authorization: `Bot ${BOT_TOKEN}` },
          maxRetries: 2,
        });
        if (directRes.ok) {
          const member = (await directRes.json()) as DiscordMember;
          const avatarUrl = member.user?.avatar
            ? `https://cdn.discordapp.com/avatars/${directDiscordId}/${member.user.avatar}.png?size=64`
            : null;
          return new Response(
            JSON.stringify({
              discord_user_id: null,
              message: "Select your Discord account to finish linking.",
              candidates: [
                {
                  id: directDiscordId,
                  username: member.user?.username ?? cleanUsername,
                  display_name: discordDisplayName(member),
                  global_name: member.user?.global_name || null,
                  nick: member.nick || null,
                  avatar: avatarUrl,
                },
              ],
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      const searchQueries = buildSearchQueries(rawUsername);
      log.info(
        "resolve",
        `Searching Discord guild for username "${cleanUsername}" (raw: "${rawUsername}") [${requestId}]`,
        {
          requestId,
          username: cleanUsername,
          rawUsername,
          guildId: GUILD_ID,
        }
      );

      // Run searches and merge results with auto-retry
      const allMembers: DiscordMember[] = [];
      const seenIds = new Set<string>();
      for (const query of searchQueries) {
        const searchUrl = `https://discord.com/api/v10/guilds/${GUILD_ID}/members/search?query=${encodeURIComponent(query)}&limit=25`;

        try {
          const { response: res, retries } = await discordFetch(searchUrl, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
          });

          if (retries > 0) {
            log.info(
              "resolve",
              `Discord search for "${query}" succeeded after ${retries} retries [${requestId}]`,
              { requestId, retries }
            );
          }

          if (res.ok) {
            const members = await res.json();
            for (const m of members as DiscordMember[]) {
              if (m.user?.id && !seenIds.has(m.user.id)) {
                seenIds.add(m.user.id);
                allMembers.push(m);
              }
            }
          } else {
            const errorText = await res.text();
            log.error(
              "resolve",
              `Discord API error for query "${query}" [${requestId}]: HTTP ${res.status} — ${errorText}`,
              {
                requestId,
                httpStatus: res.status,
                query,
              }
            );
            if (allMembers.length === 0) {
              if (res.status === 404 || res.status === 403) {
                return new Response(
                  JSON.stringify({
                    discord_user_id: null,
                    message: "Could not verify — guild not accessible",
                  }),
                  { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
              }
              return new Response(
                JSON.stringify({
                  error: "Failed to search Discord members",
                  discord_user_id: null,
                }),
                { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          }
        } catch (fetchErr) {
          log.error(
            "resolve",
            `Network error for query "${query}" after retries [${requestId}]: ${fetchErr}`,
            { requestId, query }
          );
          if (allMembers.length === 0) {
            return new Response(
              JSON.stringify({ error: "Failed to reach Discord API", discord_user_id: null }),
              { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
      }

      const members = allMembers;
      const candidateUsernames = members.map((m: any) => m.user?.username).filter(Boolean);
      const candidateGlobalNames = members.map((m: any) => m.user?.global_name).filter(Boolean);
      const candidateNicks = members.map((m: any) => m.nick).filter(Boolean);
      log.info(
        "resolve",
        `Discord returned ${members.length} members for query "${cleanUsername}" [${requestId}]`,
        {
          requestId,
          username: cleanUsername,
          rawUsername,
          resultCount: members.length,
          candidateUsernames,
          candidateGlobalNames,
          candidateNicks,
        }
      );

      // Match on cleaned username, raw username, compact username, or dot-prefixed variant.
      const matchCandidates = new Set([
        cleanUsername,
        normalizeLookupValue(rawUsername),
        compactUsername,
        `.${cleanUsername}`,
      ]);

      // 1) Exact match on username/global_name/nick
      let match = members.find((m) =>
        memberFields(m).some(
          (f) => matchCandidates.has(f) || matchCandidates.has(compactLookupValue(f))
        )
      );

      // 2) Strong fuzzy match: a field starts with the input followed by a
      //    separator (., _, -, space) — handles cases like input "sainaz"
      //    matching Discord username "sainaz.com" or display name "Sainaz Doe".
      if (!match) {
        const needle = cleanUsername;
        const strongMatches = members.filter((m) =>
          memberFields(m).some((f) => {
            if (f === needle) return true;
            if (f.startsWith(needle)) {
              const next = f.charAt(needle.length);
              return next === "" || /[._\s-]/.test(next);
            }
            if (compactLookupValue(f) === compactUsername) return true;
            // Display name like "Sainaz" (no suffix) — exact case-insensitive
            return false;
          })
        );
        if (strongMatches.length === 1) {
          match = strongMatches[0];
          log.info(
            "resolve",
            `Strong fuzzy match for "${cleanUsername}" → "${match.user?.username}" [${requestId}]`,
            {
              requestId,
              username: cleanUsername,
              matched: match.user?.username,
            }
          );
        }
      }

      // Audit-log helper
      const auditLog = async (
        eventType: string,
        message: string,
        fields: string[],
        isError = false
      ) => {
        try {
          const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          const url = Deno.env.get("SUPABASE_URL");
          if (srk && url) {
            const ac = createClient(url, srk);
            await ac.rpc("write_audit_log", {
              p_event_type: eventType,
              p_table_name: "discord_integration",
              p_record_id: `resolve-discord-id:${requestId}`,
              p_user_id: "00000000-0000-0000-0000-000000000000",
              p_error_message: isError ? message : null,
              p_changed_fields: [...fields, ...(isError ? [] : [`info:${message}`])],
            });
          }
        } catch {
          /* swallow */
        }
      };

      // Build candidate list for the UI picker
      const orderedMembers = match
        ? [match, ...members.filter((m) => m.user?.id !== match?.user?.id)]
        : members;
      const candidates = orderedMembers.slice(0, 10).map((m: any) => ({
        id: m.user?.id,
        username: m.user?.username,
        display_name: discordDisplayName(m),
        global_name: m.user?.global_name || null,
        nick: m.nick || null,
        avatar: m.user?.avatar
          ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png?size=64`
          : null,
      }));

      log.info(
        "resolve",
        `Returning ${candidates.length} selectable Discord candidates for "${cleanUsername}" [${requestId}]`,
        {
          requestId,
          username: cleanUsername,
          candidateUsernames,
          candidateGlobalNames,
          candidateNicks,
        }
      );
      // Classification (event_type + tags + response message) is extracted to
      // result-classifier.ts so the "0 candidates = benign severity:info, not an
      // error" contract is locked in by a regression test. See
      // result-classifier.test.ts (incident:18d6186852440c10628b405e76ea6c466cee8e1c).
      const classification = classifyResolveResult(
        candidates.length,
        cleanUsername,
        candidateUsernames
      );
      if (candidates.length === 0) {
        // severity:info — this is expected UX (member typed a handle that isn't
        // in the guild yet), not a system error. Triage discovery skips non-error
        // severities (mem://features/triage-discovery-severity-gate).
        await auditLog(
          classification.eventType,
          `No match for "${cleanUsername}" — Discord returned 0 members`,
          classification.tags
        );
      } else {
        await auditLog(
          classification.eventType,
          `Returned ${candidates.length} selectable candidate(s) for "${cleanUsername}" — usernames=[${candidateUsernames.join(",")}] display_names=[${candidateGlobalNames.join(",")}] nicknames=[${candidateNicks.join(",")}]`,
          classification.tags
        );
      }
      return new Response(
        JSON.stringify({
          discord_user_id: null,
          message: classification.responseMessage,
          candidates: candidates.length > 0 ? candidates : undefined,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
            p_record_id: "resolve-discord-id",
            p_user_id: "00000000-0000-0000-0000-000000000000",
            p_error_message: message.substring(0, 4000),
          });
        }
      } catch {
        /* swallow */
      }

      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  })
);
