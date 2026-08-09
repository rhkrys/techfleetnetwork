// Smoke coverage for audit H11 — a Discord identity may be bound to a profile
// ONLY after real ownership proof (OAuth authorization_code -> /users/@me match).
// Hermetic file-content invariants; if one fails, the proof gate has regressed —
// restore it, don't relax the test.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const resolveSrc = read("supabase/functions/resolve-discord-id/index.ts");
const callbackSrc = read("supabase/functions/discord-oauth-callback/index.ts");
const decideSrc = read("supabase/functions/discord-oauth-callback/decide.ts");
const startSrc = read("supabase/functions/discord-oauth-start/index.ts");
const sharedSrc = read("supabase/functions/_shared/discord-oauth.ts");

describe("Discord-link ownership proof (smoke)", () => {
  it("H11-001: resolve-discord-id never binds a caller-supplied snowflake", () => {
    // The original vulnerable write bound discord_user_id: confirm_user_id.
    expect(resolveSrc).not.toMatch(/discord_user_id:\s*confirm_user_id/);
    expect(resolveSrc).not.toMatch(/has_discord_account:\s*true/);
    // Its confirm branch stays locked down as defense in depth.
    expect(resolveSrc).toMatch(/ownership_proof_required/);
  });

  it("H11-002: the ONLY binding path is discord-oauth-callback, gated on OAuth proof", () => {
    // Gate 1: a single-use state nonce is consumed (CSRF + cross-user defense).
    expect(callbackSrc).toMatch(/consume_discord_oauth_state/);
    // Gate 2: the snowflake comes from Discord's /users/@me, not the caller.
    expect(callbackSrc).toMatch(/DISCORD_USERS_ME_URL|users\/@me/);
    // Gate 3: the shared guard decides bindability.
    expect(callbackSrc).toMatch(/decideBind/);
    // The bound snowflake is the OAuth-verified one (decision.snowflake), never
    // a value read off the request body.
    expect(callbackSrc).toMatch(/discord_user_id:\s*decision\.snowflake/);
    expect(callbackSrc).toMatch(/has_discord_account:\s*true/);
  });

  it("H11-002: the callback never binds a snowflake taken from the request body", () => {
    // The request body carries only { code, state }. Nothing that could name a
    // snowflake may be read from it and written to a profile.
    expect(callbackSrc).not.toMatch(/body\.(discord_user_id|confirm_user_id|snowflake)/);
    expect(callbackSrc).not.toMatch(/discord_user_id:\s*(body|code|state)\b/);
  });

  it("H11-002: the bind decision validates the snowflake and username shape", () => {
    expect(decideSrc).toMatch(/isValidSnowflake/);
    expect(decideSrc).toMatch(/isUsableDiscordUsername/);
  });

  it("H11-003: start mints server-side state and requires client configuration", () => {
    expect(startSrc).toMatch(/create_discord_oauth_state/);
    expect(startSrc).toMatch(/DISCORD_CLIENT_ID/);
    expect(startSrc).toMatch(/oauth_not_configured/);
  });

  it("H11: the shared OAuth helper pins the redirect URI to an exact allow-list", () => {
    // Guards against an open-redirect: only known origins + the fixed callback path.
    expect(sharedSrc).toMatch(/ALLOWED_LINK_ORIGINS/);
    expect(sharedSrc).toMatch(/resolveLinkRedirectUri/);
    expect(sharedSrc).toMatch(/courses\/connect-discord\/callback/);
  });
});
