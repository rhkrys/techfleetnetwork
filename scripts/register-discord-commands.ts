/**
 * Deploy-time Discord slash-command registration (run via `npx tsx`).
 *
 * Idempotently reconciles Discord's registered commands to the declarative
 * manifest in src/lib/discord/command-plan.ts — replacing the flaky
 * "paste functions.invoke() in a browser console" step with a versioned,
 * auditable, repeatable CI action.
 *
 * SAFETY (OWASP Step-0, accidental deletion): Discord's bulk overwrite replaces
 * the ENTIRE command set. This first reads the currently-registered commands and
 * REFUSES to proceed if that would delete a command missing from the manifest,
 * unless `--allow-delete` is passed. Guards against silently wiping /fleety.
 *
 * Secrets (DISCORD_BOT_TOKEN) come from CI env and are never logged. Missing
 * secrets => skip (exit 0) so a deploy is never blocked by unconfigured envs.
 */
import { pathToFileURL } from "node:url";
import { COMMANDS, planCommandChanges } from "../src/lib/discord/command-plan";

const API = "https://discord.com/api/v10";

async function bodyPreview(res: { text(): Promise<string> }): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}

export async function main(): Promise<void> {
  const allowDelete = process.argv.includes("--allow-delete");
  const token = process.env.DISCORD_BOT_TOKEN;
  const appId = process.env.DISCORD_APPLICATION_ID;
  const guildId = process.env.DISCORD_GUILD_ID; // optional; instant propagation if set

  // Fail closed, but don't break the deploy in environments without the secrets.
  if (!token || !appId) {
    console.log(
      "register-discord-commands: DISCORD_BOT_TOKEN/DISCORD_APPLICATION_ID not set — skipping (nothing registered).",
    );
    return;
  }

  const base = guildId
    ? `${API}/applications/${appId}/guilds/${guildId}/commands`
    : `${API}/applications/${appId}/commands`;
  const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };

  // 1. Read the currently-registered commands.
  const curRes = await fetch(base, { headers });
  if (!curRes.ok) {
    throw new Error(`Discord GET commands failed: ${curRes.status} ${await bodyPreview(curRes)}`);
  }
  const current = (await curRes.json()) as Array<{ name: string }>;

  // 2. Accidental-deletion guard.
  const { deletions, blocked } = planCommandChanges(
    current.map((c) => c.name),
    COMMANDS.map((c) => c.name),
    allowDelete,
  );
  if (blocked) {
    console.error(
      `::error::Refusing to register: this would DELETE command(s) not in the manifest: ${deletions.join(", ")}. ` +
        "Add them to src/lib/discord/command-plan.ts, or re-run with --allow-delete if removal is intended.",
    );
    process.exit(1);
  }
  if (deletions.length > 0) {
    console.log(`--allow-delete set — removing: ${deletions.join(", ")}`);
  }

  // 3. Idempotent bulk overwrite to exactly the manifest.
  const putRes = await fetch(base, { method: "PUT", headers, body: JSON.stringify(COMMANDS) });
  if (!putRes.ok) {
    throw new Error(`Discord PUT commands failed: ${putRes.status} ${await bodyPreview(putRes)}`);
  }
  const result = (await putRes.json()) as Array<{ name: string }>;
  console.log(
    `Registered ${result.length} command(s) ${guildId ? `to guild ${guildId}` : "globally"}: ` +
      result.map((c) => c.name).join(", "),
  );
}

// Run only as a CLI (not when imported by a test).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
