import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALLOWED_LINK_ORIGINS,
  buildAuthorizeUrl,
  buildTokenExchangeBody,
  DISCORD_LINK_REDIRECT_PATH,
  isUsableDiscordUsername,
  isValidSnowflake,
  pickDisplayName,
  resolveLinkRedirectUri,
} from "./discord-oauth.ts";

Deno.test("resolveLinkRedirectUri accepts only allow-listed origins", () => {
  assertEquals(
    resolveLinkRedirectUri("https://techfleet.network"),
    "https://techfleet.network/courses/connect-discord/callback"
  );
  // trailing slash tolerated
  assertEquals(
    resolveLinkRedirectUri("https://www.techfleet.network/"),
    "https://www.techfleet.network/courses/connect-discord/callback"
  );
  assertEquals(
    resolveLinkRedirectUri("http://localhost:8080"),
    "http://localhost:8080/courses/connect-discord/callback"
  );
});

Deno.test("resolveLinkRedirectUri rejects everything else (no open redirect)", () => {
  for (const bad of [
    null,
    undefined,
    "",
    "https://evil.example.com",
    "https://techfleet.network.evil.com",
    "http://techfleet.network", // wrong scheme
    "https://techfleet.network/../foo",
    "javascript:alert(1)",
  ]) {
    assertEquals(resolveLinkRedirectUri(bad as string), null, `should reject: ${String(bad)}`);
  }
});

Deno.test("every allow-listed origin resolves to the fixed callback path", () => {
  for (const origin of ALLOWED_LINK_ORIGINS) {
    assertEquals(resolveLinkRedirectUri(origin), `${origin}${DISCORD_LINK_REDIRECT_PATH}`);
  }
});

Deno.test("buildAuthorizeUrl encodes params and requests identify + consent", () => {
  const url = new URL(
    buildAuthorizeUrl({
      clientId: "cid",
      redirectUri: "https://techfleet.network/courses/connect-discord/callback",
      state: "abc123",
    })
  );
  assertEquals(url.origin + url.pathname, "https://discord.com/api/oauth2/authorize");
  assertEquals(url.searchParams.get("response_type"), "code");
  assertEquals(url.searchParams.get("client_id"), "cid");
  assertEquals(url.searchParams.get("scope"), "identify");
  assertEquals(url.searchParams.get("state"), "abc123");
  assertEquals(url.searchParams.get("prompt"), "consent");
  assertEquals(
    url.searchParams.get("redirect_uri"),
    "https://techfleet.network/courses/connect-discord/callback"
  );
});

Deno.test("buildTokenExchangeBody is urlencoded with grant_type=authorization_code", () => {
  const body = new URLSearchParams(
    buildTokenExchangeBody({
      clientId: "cid",
      clientSecret: "secret",
      code: "the code",
      redirectUri: "https://techfleet.network/courses/connect-discord/callback",
    })
  );
  assertEquals(body.get("grant_type"), "authorization_code");
  assertEquals(body.get("code"), "the code");
  assertEquals(body.get("client_secret"), "secret");
});

Deno.test("isUsableDiscordUsername mirrors the resolve-discord-id guard", () => {
  assertEquals(isUsableDiscordUsername("realuser"), true);
  assertEquals(isUsableDiscordUsername(".leadingdot"), true);
  for (const bad of ["", ".", "..", "   ", null, undefined]) {
    assertEquals(isUsableDiscordUsername(bad as string), false, `bad: ${String(bad)}`);
  }
});

Deno.test("isValidSnowflake requires a 15-25 digit string", () => {
  assertEquals(isValidSnowflake("123456789012345678"), true);
  assertEquals(isValidSnowflake("12345"), false);
  assertEquals(isValidSnowflake("12345678901234567890123456"), false);
  assertEquals(isValidSnowflake("12345abc9012345678"), false);
});

Deno.test("pickDisplayName prefers nick, then global_name, then username", () => {
  assertEquals(pickDisplayName({ username: "u", global_name: "Global" }, { nick: "Nick" }), "Nick");
  assertEquals(pickDisplayName({ username: "u", global_name: "Global" }, { nick: null }), "Global");
  assertEquals(pickDisplayName({ username: "u", global_name: null }, null), "u");
});
