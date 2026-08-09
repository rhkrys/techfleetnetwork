// @edge-auth required
// discord-oauth-start — audit H11 follow-up (real Discord ownership proof).
//
// Kicks off the Discord OAuth2 authorization_code flow for a signed-in Tech
// Fleet user. Mints a single-use, short-lived `state` nonce bound to the
// caller's user id, then returns the Discord authorize URL the browser is
// redirected to. NOTHING is bound to the profile here — the actual identity
// write happens in discord-oauth-callback only after the code is exchanged and
// /users/@me confirms the snowflake.
//
// verify_jwt = false in config.toml; the JWT is enforced in-code via
// requireAuthenticatedRequest (matches every other client-invoked function).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createEdgeLogger } from "../_shared/logger.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
import { requireAuthenticatedRequest } from "../_shared/request-auth.ts";
import { getAdminClient } from "../_shared/admin-client.ts";
import { handleCors, jsonResponse, methodNotAllowed, parseJsonBody } from "../_shared/http.ts";
import { buildAuthorizeUrl, resolveLinkRedirectUri } from "../_shared/discord-oauth.ts";

const log = createEdgeLogger("discord-oauth-start");
const STATE_TTL_SECONDS = 600; // 10 minutes

serve(
  withAuditWrapper("discord-oauth-start", async (req) => {
    const cors = handleCors(req);
    if (cors) return cors;
    if (req.method !== "POST") return methodNotAllowed();

    const auth = await requireAuthenticatedRequest(req, "discord-oauth-start");
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const CLIENT_ID = Deno.env.get("DISCORD_CLIENT_ID");
    if (!CLIENT_ID) {
      // Fail closed with a clear, distinct signal. This project has a history of
      // un-migrated secrets silently breaking features (mem://incidents/
      // discord-secrets-not-migrated); surface it instead of half-working.
      log.error("config", "DISCORD_CLIENT_ID is not configured");
      return jsonResponse(
        {
          error: "Discord linking isn't configured yet. Please contact an admin.",
          code: "oauth_not_configured",
        },
        503
      );
    }

    let origin: string | null = null;
    try {
      const body = (await parseJsonBody(req, 2 * 1024)) as { origin?: unknown };
      if (typeof body?.origin === "string") origin = body.origin;
    } catch {
      /* body is optional; fall back to the Origin header below */
    }
    if (!origin) origin = req.headers.get("Origin");

    const redirectUri = resolveLinkRedirectUri(origin);
    if (!redirectUri) {
      log.warn("validate", `Rejected disallowed origin: ${String(origin)}`);
      return jsonResponse({ error: "This site isn't allowed to link Discord." }, 400);
    }

    const state = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
    const admin = getAdminClient();

    const { error: mintError } = await admin.rpc("create_discord_oauth_state", {
      p_user_id: userId,
      p_state: state,
      p_redirect_uri: redirectUri,
      p_ttl_seconds: STATE_TTL_SECONDS,
    });
    if (mintError) {
      log.error("mint", `Failed to mint OAuth state: ${mintError.message}`, {}, mintError);
      return jsonResponse({ error: "Could not start Discord linking. Please try again." }, 500);
    }

    // Best-effort table hygiene — no cron dependency.
    void admin.rpc("reap_expired_discord_oauth_states").then(
      () => {},
      () => {}
    );

    const url = buildAuthorizeUrl({ clientId: CLIENT_ID, redirectUri, state });
    log.info("start", "Issued Discord OAuth authorize URL", { userId });
    return jsonResponse({ url }, 200);
  })
);
