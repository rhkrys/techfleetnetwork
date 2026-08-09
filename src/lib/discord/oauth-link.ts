/**
 * Client-side kickoff for the Discord account-linking OAuth flow (audit H11
 * follow-up). Keeps the sessionStorage return-path key and the redirect in one
 * place so every surface starts the flow identically.
 */
import { DiscordNotifyService } from "@/services/discord-notify.service";

/** Where to send the user back after the OAuth round-trip. */
export const DISCORD_LINK_RETURN_KEY = "discord_link_return";

/**
 * Remember the current location, ask the server for a Discord authorize URL,
 * then redirect the browser into Discord's consent screen. Throws (without
 * redirecting) if the server can't start the flow — callers surface the message.
 */
export async function beginDiscordOAuth(returnPath?: string): Promise<void> {
  try {
    sessionStorage.setItem(
      DISCORD_LINK_RETURN_KEY,
      returnPath ?? `${window.location.pathname}${window.location.search}`
    );
  } catch {
    /* sessionStorage may be unavailable; the callback falls back to a default */
  }
  const url = await DiscordNotifyService.startDiscordOAuth(window.location.origin);
  window.location.assign(url);
}
