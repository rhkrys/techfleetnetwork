// @edge-auth required
// discord-oauth-callback — audit H11 follow-up (real Discord ownership proof).
//
// Completes the Discord OAuth2 authorization_code flow and is the ONLY path
// that writes discord_user_id/discord_username/has_discord_account. It binds a
// snowflake to the caller's profile ONLY after:
//   1. consuming a single-use `state` nonce bound to the caller's own JWT
//      (CSRF + cross-user-theft defense, atomic single-use),
//   2. exchanging the authorization code with Discord, and
//   3. reading /users/@me — the snowflake we bind is the one Discord itself
//      returns for the account that just authorized. The caller cannot supply
//      an arbitrary snowflake; that was the H11 hole.
//
// The pre-existing guards are preserved: guild membership, the one-account-
// per-profile check, the empty-username guard, and the unique index (23505).
//
// verify_jwt = false in config.toml; the JWT is enforced in-code.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createEdgeLogger } from "../_shared/logger.ts";
import { auditEdgeEvent, withAuditWrapper } from "../_shared/audit.ts";
import { requireAuthenticatedRequest } from "../_shared/request-auth.ts";
import { getAdminClient } from "../_shared/admin-client.ts";
import { handleCors, jsonResponse, methodNotAllowed, parseJsonBody } from "../_shared/http.ts";
import { discordFetch } from "../_shared/discord-fetch.ts";
import {
  avatarUrl,
  buildTokenExchangeBody,
  DISCORD_TOKEN_REVOKE_URL,
  DISCORD_TOKEN_URL,
  DISCORD_USERS_ME_URL,
  type DiscordGuildMember,
  type DiscordIdentity,
  pickDisplayName,
} from "../_shared/discord-oauth.ts";
import { decideBind } from "./decide.ts";

const log = createEdgeLogger("discord-oauth-callback");

const MAX_CODE_LENGTH = 512;
const MIN_STATE_LENGTH = 16;
const MAX_STATE_LENGTH = 128;

serve(
  withAuditWrapper("discord-oauth-callback", async (req, ctx) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return methodNotAllowed();

    const auth = await requireAuthenticatedRequest(req, "discord-oauth-callback");
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const CLIENT_ID = Deno.env.get("DISCORD_CLIENT_ID");
    const CLIENT_SECRET = Deno.env.get("DISCORD_CLIENT_SECRET");
    if (!CLIENT_ID || !CLIENT_SECRET) {
      log.error("config", "DISCORD_CLIENT_ID/SECRET not configured");
      return jsonResponse(
        {
          error: "Discord linking isn't configured yet. Please contact an admin.",
          code: "oauth_not_configured",
        },
        503
      );
    }

    const BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN");
    const GUILD_ID = Deno.env.get("DISCORD_GUILD_ID");
    if (!BOT_TOKEN || !GUILD_ID) {
      log.error("config", "Discord bot not configured");
      return jsonResponse({ error: "Discord bot not configured" }, 500);
    }

    // ── Validate body ────────────────────────────────────────────────────────
    let code: string;
    let state: string;
    try {
      const body = (await parseJsonBody(req, 4 * 1024)) as { code?: unknown; state?: unknown };
      if (
        typeof body?.code !== "string" ||
        body.code.length === 0 ||
        body.code.length > MAX_CODE_LENGTH ||
        typeof body?.state !== "string" ||
        body.state.length < MIN_STATE_LENGTH ||
        body.state.length > MAX_STATE_LENGTH
      ) {
        return jsonResponse({ error: "Invalid request." }, 400);
      }
      code = body.code;
      state = body.state;
    } catch (bodyErr) {
      if (bodyErr instanceof Response) return bodyErr;
      return jsonResponse({ error: "Invalid request." }, 400);
    }

    const admin = getAdminClient();

    // ── 1. Consume the single-use state (atomic, bound to THIS user) ──────────
    const { data: redirectUri, error: stateError } = await admin.rpc(
      "consume_discord_oauth_state",
      { p_user_id: userId, p_state: state }
    );
    if (stateError) {
      log.error("state", `Failed to consume OAuth state: ${stateError.message}`, {}, stateError);
      return jsonResponse({ error: "Could not verify your Discord link session." }, 500);
    }
    if (!redirectUri || typeof redirectUri !== "string") {
      log.warn("state", "Rejected invalid/expired/replayed OAuth state", { userId });
      void auditEdgeEvent(admin, {
        fn: "discord-oauth-callback",
        event: "discord_link_state_rejected",
        table: "discord_oauth_states",
        userId,
        traceId: ctx.traceId,
        severity: "warn",
        fields: ["reason:invalid_or_used"],
      });
      return jsonResponse(
        {
          error: "Your Discord link session expired or was already used. Please start again.",
          code: "invalid_state",
        },
        400
      );
    }

    // ── 2. Exchange the authorization code for an access token ────────────────
    const { response: tokenRes } = await discordFetch(DISCORD_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: buildTokenExchangeBody({
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        code,
        redirectUri,
      }),
      maxRetries: 2,
    });
    if (!tokenRes.ok) {
      log.warn("exchange", `Discord token exchange failed: HTTP ${tokenRes.status}`, { userId });
      await tokenRes.text().catch(() => {});
      return jsonResponse(
        {
          error: "Discord authorization failed. Please try linking again.",
          code: "exchange_failed",
        },
        502
      );
    }
    const tokenJson = (await tokenRes.json().catch(() => null)) as {
      access_token?: string;
      token_type?: string;
    } | null;
    const accessToken = tokenJson?.access_token;
    if (!accessToken) {
      return jsonResponse(
        {
          error: "Discord authorization failed. Please try linking again.",
          code: "exchange_failed",
        },
        502
      );
    }

    // ── 3. Read the authenticated identity (the ownership proof) ──────────────
    const { response: meRes } = await discordFetch(DISCORD_USERS_ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      maxRetries: 2,
    });
    const identity = meRes.ok
      ? ((await meRes.json().catch(() => null)) as DiscordIdentity | null)
      : null;
    if (!meRes.ok || !identity?.id) {
      if (!meRes.ok) await meRes.text().catch(() => {});
      // Access token is single-use for us — revoke best-effort before bailing.
      void revokeToken(CLIENT_ID, CLIENT_SECRET, accessToken);
      return jsonResponse(
        { error: "Couldn't read your Discord account. Please try again.", code: "identity_failed" },
        502
      );
    }
    const snowflake = identity.id;

    // ── 4. Verify guild membership (needed for the Community role) ────────────
    const { response: memberRes } = await discordFetch(
      `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${snowflake}`,
      { headers: { Authorization: `Bot ${BOT_TOKEN}` }, maxRetries: 2 }
    );
    const isMember = memberRes.ok;
    let member: DiscordGuildMember | null = null;
    if (memberRes.ok) {
      member = (await memberRes.json().catch(() => null)) as DiscordGuildMember | null;
    } else {
      await memberRes.text().catch(() => {}); // drain body
    }

    // We're done with the OAuth token; we only needed the identity. Revoke it.
    void revokeToken(CLIENT_ID, CLIENT_SECRET, accessToken);

    // ── 5. One-account-per-profile guard (unchanged behavior) ─────────────────
    let alreadyLinkedElsewhere = false;
    if (isMember && identity.username) {
      const { data: claimed, error: claimedError } = await admin
        .from("profiles")
        .select("user_id")
        .neq("user_id", userId)
        .or(`discord_user_id.eq.${snowflake},discord_username.ilike.${identity.username}`)
        .limit(1);
      if (claimedError) {
        log.error("claimed", `Claimed-lookup failed: ${claimedError.message}`, {}, claimedError);
        return jsonResponse(
          { error: "Could not safely verify Discord ownership. Please try again." },
          500
        );
      }
      alreadyLinkedElsewhere = Boolean(claimed && claimed.length > 0);
    }

    // ── 6. Decide + bind ──────────────────────────────────────────────────────
    const decision = decideBind({
      snowflake,
      username: identity.username,
      isMember,
      alreadyLinkedElsewhere,
    });
    if (!decision.ok) {
      log.warn("decide", `Bind rejected (${decision.code})`, { userId });
      return jsonResponse({ error: decision.error, code: decision.code }, decision.status);
    }

    const { error: linkError } = await admin
      .from("profiles")
      .update({
        discord_username: decision.username,
        discord_user_id: decision.snowflake,
        has_discord_account: true,
      })
      .eq("user_id", userId);

    if (linkError) {
      const isUniqueConflict =
        linkError.message?.toLowerCase().includes("unique") || linkError.code === "23505";
      log.error(
        "bind",
        `Failed to persist Discord link: ${linkError.message}`,
        { userId },
        linkError
      );
      return jsonResponse(
        {
          error: isUniqueConflict
            ? "This Discord account is already linked to another Tech Fleet profile. Each Discord account can only be connected to one profile."
            : "Could not save the verified Discord account. Please try again.",
          code: isUniqueConflict ? "already_linked" : "bind_failed",
        },
        isUniqueConflict ? 409 : 500
      );
    }

    void auditEdgeEvent(admin, {
      fn: "discord-oauth-callback",
      event: "discord_link_verified_oauth",
      table: "profiles",
      recordId: userId,
      userId,
      traceId: ctx.traceId,
      severity: "info",
      fields: ["method:oauth", "proof:users_me_match"],
    });

    const avatar = avatarUrl(snowflake, identity.avatar ?? member?.user?.avatar ?? null);
    log.info("bind", "Discord account linked via OAuth", { userId });
    return jsonResponse(
      {
        discord_user_id: snowflake,
        discord_username: decision.username,
        discord_display_name: pickDisplayName(identity, member),
        global_name: identity.global_name ?? null,
        nick: member?.nick ?? null,
        avatar,
      },
      200
    );
  })
);

/** Best-effort revoke of the short-lived access token — never throws. */
async function revokeToken(clientId: string, clientSecret: string, token: string): Promise<void> {
  try {
    await discordFetch(DISCORD_TOKEN_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token,
        token_type_hint: "access_token",
      }).toString(),
      maxRetries: 1,
    });
  } catch {
    /* revocation is best-effort */
  }
}
