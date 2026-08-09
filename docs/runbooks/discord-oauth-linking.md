# Discord account linking — OAuth ownership proof (audit H11 follow-up)

## Why this exists

`resolve-discord-id`'s old self-service "confirm" path let any signed-in user bind
an arbitrary guild-member snowflake (e.g. a mentor/admin's) to their own profile
with **no proof they controlled that Discord account**. That was disabled in an
interim lockdown (migration `20260809130000`). This is the permanent fix: linking
now requires a real **Discord OAuth2 `authorization_code`** flow — we only bind the
snowflake that Discord itself returns from `/users/@me` for the account that just
authorized.

## Moving parts

- Edge fn **`discord-oauth-start`** — mints a single-use `state` (row in
  `discord_oauth_states`, bound to the caller's user id, 10-min TTL) and returns
  the Discord authorize URL.
- Edge fn **`discord-oauth-callback`** — the **only** path that writes
  `discord_user_id` / `discord_username` / `has_discord_account`. It consumes the
  state (atomic, single-use, must match the caller's JWT), exchanges the code,
  reads `/users/@me`, verifies guild membership, then binds — keeping the existing
  one-account-per-profile, empty-username, and unique-index guards.
- Table **`discord_oauth_states`** + RPCs `create_/consume_/reap_expired_
discord_oauth_state(s)` (migration `20260809161000`). Edge-only: RLS deny-all.
- Frontend route **`/courses/connect-discord/callback`** →
  `DiscordOAuthCallbackPage`, which runs the existing finalize steps (Community
  role, avatar, journey task, notify).

## One-time setup (Discord Developer Portal + Supabase secrets)

1. In the [Discord Developer Portal](https://discord.com/developers/applications),
   open the Tech Fleet application (the same app whose bot token is
   `DISCORD_BOT_TOKEN`) → **OAuth2**.
2. Copy **Client ID** and reset/copy **Client Secret**.
3. Under **OAuth2 → Redirects**, add EXACTLY these redirect URIs (must match the
   `ALLOWED_LINK_ORIGINS` allow-list in
   `supabase/functions/_shared/discord-oauth.ts`):
   - `https://techfleet.network/courses/connect-discord/callback`
   - `https://www.techfleet.network/courses/connect-discord/callback`
   - `http://localhost:8080/courses/connect-discord/callback` (local dev)
   - `http://127.0.0.1:8080/courses/connect-discord/callback` (local dev)
4. In Supabase → Project Settings → Edge Functions → Secrets, set:
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
     (`DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID` are already required for the bot.)
5. Redeploy edge functions (push to `main` triggers
   `deploy-edge-functions.yml` on `supabase/functions/**` changes).

Scope requested is `identify` only. The short-lived access token is revoked
immediately after we read the identity — we never store a Discord token.

## Failure modes

- Secrets unset → both functions return HTTP 503 `{ code: "oauth_not_configured" }`
  and the UI shows a "not configured yet — contact an admin" message. **Fail
  closed**, never a half-working bind.
- Redirect URI not registered → Discord rejects the authorize/token call; the
  callback returns `code: "exchange_failed"`. Double-check step 3 matches origin+path.
- User not in the guild → `code: "not_in_guild"`; UI routes them to the invite step.
- Expired / reused / stolen `state` → `code: "invalid_state"`.

## Verifying

- `deno test supabase/functions/discord-oauth-callback/decide.test.ts
supabase/functions/_shared/discord-oauth.test.ts`
- `supabase db test` (runs `supabase/tests/discord_oauth_states_test.sql`)
- `npm run test -- discord-link-ownership` (smoke: proof-gated binding invariant)
