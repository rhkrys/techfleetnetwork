// Pure binding-decision logic for discord-oauth-callback (audit H11 follow-up).
// Dependency-free so it can be unit-tested (decide.test.ts) as the regression
// guard that a Discord identity is only ever bound after real ownership proof.

import { isUsableDiscordUsername, isValidSnowflake } from "../_shared/discord-oauth.ts";

export type BindDecision =
  | { ok: true; snowflake: string; username: string }
  | { ok: false; status: number; code: string; error: string };

export interface BindInputs {
  /** Snowflake from the OAuth-verified /users/@me response. */
  snowflake: string | null | undefined;
  /** Username from the OAuth-verified /users/@me response. */
  username: string | null | undefined;
  /** Whether the snowflake is currently a member of the Tech Fleet guild. */
  isMember: boolean;
  /** Whether this snowflake/username is already linked to a DIFFERENT profile. */
  alreadyLinkedElsewhere: boolean;
}

/**
 * Given the OAuth-verified identity plus the two pre-existing guards (guild
 * membership + one-account-per-profile), decide whether the caller's profile
 * may be bound to this snowflake. Order matters: we reject unusable input
 * before membership, and membership before the already-linked conflict, so the
 * user gets the most actionable message.
 */
export function decideBind(input: BindInputs): BindDecision {
  const { snowflake, username, isMember, alreadyLinkedElsewhere } = input;

  if (!isValidSnowflake(snowflake)) {
    return {
      ok: false,
      status: 502,
      code: "bad_identity",
      error: "Discord did not return a valid account id. Please try again.",
    };
  }

  if (!isUsableDiscordUsername(username)) {
    return {
      ok: false,
      status: 502,
      code: "empty_username",
      error: "Discord did not return a usable username — please retry in a moment.",
    };
  }

  if (!isMember) {
    return {
      ok: false,
      status: 409,
      code: "not_in_guild",
      error:
        "You're not in the Tech Fleet Discord server yet. Join the server first, then link your account.",
    };
  }

  if (alreadyLinkedElsewhere) {
    return {
      ok: false,
      status: 409,
      code: "already_linked",
      error:
        "This Discord account is already linked to another Tech Fleet profile. Each Discord account can only be connected to one profile.",
    };
  }

  return { ok: true, snowflake, username: username as string };
}
