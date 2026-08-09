import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideBind } from "./decide.ts";

// Audit H11 (DISCORD-LINK-H11-002): a Discord identity may be bound to a profile
// ONLY after OAuth proof yields a valid snowflake + usable username, the account
// is in the guild, and it isn't already linked elsewhere. These tests lock the
// order and the exact rejection codes/statuses the callback returns.

const OK = {
  snowflake: "123456789012345678",
  username: "realuser",
  isMember: true,
  alreadyLinkedElsewhere: false,
};

Deno.test("H11-002: verified, in-guild, unclaimed identity binds", () => {
  const d = decideBind(OK);
  assertEquals(d.ok, true);
  if (d.ok) {
    assertEquals(d.snowflake, "123456789012345678");
    assertEquals(d.username, "realuser");
  }
});

Deno.test("rejects a non-snowflake id (never trust a bad identity payload)", () => {
  const d = decideBind({ ...OK, snowflake: "not-a-snowflake" });
  assertEquals(d.ok, false);
  if (!d.ok) {
    assertEquals(d.status, 502);
    assertEquals(d.code, "bad_identity");
  }
});

Deno.test("rejects empty / dot-only usernames", () => {
  for (const username of ["", ".", "...", "   "]) {
    const d = decideBind({ ...OK, username });
    assertEquals(d.ok, false, `username=${JSON.stringify(username)}`);
    if (!d.ok) assertEquals(d.code, "empty_username");
  }
});

Deno.test("rejects a verified account that isn't in the guild", () => {
  const d = decideBind({ ...OK, isMember: false });
  assertEquals(d.ok, false);
  if (!d.ok) {
    assertEquals(d.status, 409);
    assertEquals(d.code, "not_in_guild");
  }
});

Deno.test("rejects an account already linked to another profile", () => {
  const d = decideBind({ ...OK, alreadyLinkedElsewhere: true });
  assertEquals(d.ok, false);
  if (!d.ok) {
    assertEquals(d.status, 409);
    assertEquals(d.code, "already_linked");
  }
});

Deno.test("guard order: unusable input is reported before membership/claim", () => {
  // Not a member AND bad snowflake → the identity problem wins (more actionable).
  const d = decideBind({
    snowflake: "x",
    username: "realuser",
    isMember: false,
    alreadyLinkedElsewhere: true,
  });
  assertEquals(d.ok, false);
  if (!d.ok) assertEquals(d.code, "bad_identity");
});
