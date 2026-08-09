// Pure, dependency-free helpers for the Discord account-linking OAuth flow
// (audit H11 follow-up). No Deno/env/fetch here so this is unit-testable as a
// regression guard for discord-oauth-start / discord-oauth-callback. See
// decide.test.ts.

/**
 * The single frontend route Discord redirects back to. The path is fixed
 * server-side (never taken from the caller) so a compromised/injected origin
 * can't turn this into an open redirect — only the origin is validated.
 */
export const DISCORD_LINK_REDIRECT_PATH = "/courses/connect-discord/callback";

/**
 * Exact origins allowed as OAuth redirect targets. Each MUST also be registered
 * verbatim (origin + DISCORD_LINK_REDIRECT_PATH) in the Discord application's
 * OAuth2 "Redirects" list, or Discord rejects the authorize/token calls.
 */
export const ALLOWED_LINK_ORIGINS: readonly string[] = [
  "https://techfleet.network",
  "https://www.techfleet.network",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

/** Discord OAuth2 endpoints. */
export const DISCORD_AUTHORIZE_URL = "https://discord.com/api/oauth2/authorize";
export const DISCORD_TOKEN_URL = "https://discord.com/api/v10/oauth2/token";
export const DISCORD_TOKEN_REVOKE_URL = "https://discord.com/api/v10/oauth2/token/revoke";
export const DISCORD_USERS_ME_URL = "https://discord.com/api/v10/users/@me";

/**
 * Validate a caller-supplied origin against the allow-list and return the full
 * redirect URI, or null if the origin isn't allowed. Trailing slashes are
 * tolerated on input; output never has one before the fixed path.
 */
export function resolveLinkRedirectUri(origin: string | null | undefined): string | null {
  if (!origin || typeof origin !== "string") return null;
  const normalized = origin.trim().replace(/\/+$/, "");
  if (!ALLOWED_LINK_ORIGINS.includes(normalized)) return null;
  return `${normalized}${DISCORD_LINK_REDIRECT_PATH}`;
}

/** Build the Discord authorize URL the browser is redirected to. */
export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: params.clientId,
    scope: params.scope ?? "identify",
    state: params.state,
    redirect_uri: params.redirectUri,
    // Force the account chooser so a member on a shared device can't silently
    // (re)link whichever Discord session happens to be active in the browser.
    prompt: "consent",
  });
  return `${DISCORD_AUTHORIZE_URL}?${query.toString()}`;
}

/** Body for the authorization_code → token exchange (application/x-www-form-urlencoded). */
export function buildTokenExchangeBody(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): string {
  return new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
  }).toString();
}

export interface DiscordIdentity {
  id?: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
}

export interface DiscordGuildMember {
  user?: { id?: string; username?: string; global_name?: string | null; avatar?: string | null };
  nick?: string | null;
}

/**
 * A username is usable only if, after stripping leading dots and whitespace,
 * something remains. Mirrors the guard in resolve-discord-id so a profile never
 * renders as "@" or "@." across the app.
 */
export function isUsableDiscordUsername(username: string | null | undefined): boolean {
  if (!username || typeof username !== "string") return false;
  const core = username.trim().replace(/^\.+/, "").trim();
  return core.length > 0 && username !== ".";
}

/** Discord snowflakes are 15–25 digit strings. */
export function isValidSnowflake(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{15,25}$/.test(value);
}

/** Prefer the guild nickname, then the account's global name, then the handle. */
export function pickDisplayName(
  identity: DiscordIdentity,
  member: DiscordGuildMember | null
): string | null {
  return (
    member?.nick || identity.global_name || member?.user?.global_name || identity.username || null
  );
}

/** CDN avatar URL for a snowflake+hash, or null. */
export function avatarUrl(snowflake: string, avatarHash: string | null | undefined): string | null {
  return avatarHash
    ? `https://cdn.discordapp.com/avatars/${snowflake}/${avatarHash}.png?size=64`
    : null;
}
