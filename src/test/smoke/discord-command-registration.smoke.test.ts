// Hermetic wiring coverage for the deploy-time Discord command registrar.
// Backs BDD DISCORD-CMD-005 (secret safety / fail-closed) + DISCORD-CMD-006
// (guild vs global) + the CI-workflow wiring.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = process.cwd();
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

const script = read("scripts/register-discord-commands.ts");
const workflow = read(".github/workflows/register-discord-commands.yml");

describe("Discord command registration wiring (smoke)", () => {
  it("DISCORD-CMD-005: secrets come from env, never logged; missing secrets fail closed (skip)", () => {
    expect(script).toMatch(/process\.env\.DISCORD_BOT_TOKEN/);
    expect(script).toMatch(/if \(!token \|\| !appId\)[\s\S]{0,300}return;/); // skip when unset
    // The token is only ever used in the Authorization header, never console-logged.
    expect(script).toMatch(/Authorization: `Bot \$\{token\}`/);
    expect(script).not.toMatch(/console\.(log|error)\([^)]*\btoken\b/);
  });

  it("DISCORD-CMD-005: the deletion guard blocks + exits non-zero without an override", () => {
    expect(script).toMatch(/planCommandChanges\(/);
    expect(script).toMatch(/if \(blocked\)[\s\S]{0,400}process\.exit\(1\)/);
    expect(script).toMatch(/--allow-delete/);
  });

  it("DISCORD-CMD-006: target is guild-scoped when DISCORD_GUILD_ID is set, else global", () => {
    expect(script).toMatch(/DISCORD_GUILD_ID/);
    expect(script).toMatch(/guilds\/\$\{appId\}\/commands|applications\/\$\{appId\}\/guilds\/\$\{guildId\}\/commands/);
    expect(script).toMatch(/method: "PUT"/); // idempotent bulk overwrite
  });

  it("DISCORD-CMD wiring: CI workflow runs the registrar via tsx with secrets from CI env", () => {
    expect(workflow).toMatch(/npx tsx scripts\/register-discord-commands\.ts/);
    expect(workflow).toMatch(/DISCORD_BOT_TOKEN: \$\{\{ secrets\.DISCORD_BOT_TOKEN \}\}/);
    expect(workflow).toMatch(/command-plan\.ts/); // path-triggered on manifest change
    expect(workflow).toMatch(/allow_delete/);
  });
});
