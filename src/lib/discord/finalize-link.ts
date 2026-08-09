/**
 * Post-verification finalize steps for a linked Discord account, shared by every
 * surface that completes linking (today: the OAuth callback page).
 *
 * The SECURITY-critical write — binding discord_user_id/discord_username onto the
 * profile — happens server-side in the `discord-oauth-callback` edge function
 * after real ownership proof. This module only performs the non-critical,
 * best-effort follow-ups once that bind has succeeded: Community role, avatar,
 * journey task, notification, and cache refresh. None of these gate the link.
 */
import { supabase } from "@/integrations/supabase/client";
import { invokeEdge } from "@/lib/edge/invokeEdge";
import { JourneyService } from "@/services/journey.service";
import { DiscordNotifyService } from "@/services/discord-notify.service";
import { createLogger } from "@/services/logger.service";

const log = createLogger("DiscordFinalizeLink");

const TASK_ID = "connect-discord";
const PHASE = "first_steps" as const;
const COMMUNITY_ROLE_ID = "1083439364975112293";

interface QueryInvalidator {
  invalidateQueries: (filters: { queryKey: (string | undefined)[] }) => unknown;
}

/** Assign the Discord Community role via the bot. Throws on failure. */
async function assignCommunityRole(discordUserId: string) {
  // invokeEdge auto-attaches the caller's JWT and throws on a non-2xx/failed call.
  await invokeEdge("manage-discord-roles", {
    body: { action: "assign", discord_user_id: discordUserId, role_id: COMMUNITY_ROLE_ID },
    silentReport: true, // a missed role grant is non-blocking and self-heals via the retry queue
  });
}

/** Download the Discord avatar → avatars bucket, only when the profile has none. */
async function saveDiscordAvatar(discordAvatarUrl: string, userId: string) {
  try {
    const { data: currentProfile } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("user_id", userId)
      .maybeSingle();
    if (currentProfile?.avatar_url) return;

    const response = await fetch(discordAvatarUrl);
    if (!response.ok) return;
    const blob = await response.blob();
    const path = `${userId}/avatar.png`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, blob, { upsert: true, contentType: "image/png" });
    if (uploadError) return;
    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
    await supabase
      .from("profiles")
      .update({ avatar_url: publicUrl } as never)
      .eq("user_id", userId);
  } catch {
    /* avatar save is best-effort, never blocks linking */
  }
}

export interface FinalizeDiscordLinkOptions {
  userId: string;
  displayName: string;
  discordUserId: string;
  discordUsername: string;
  avatarUrl?: string | null;
  queryClient: QueryInvalidator;
  refreshProfile: () => Promise<unknown> | unknown;
}

/**
 * Run the non-critical follow-ups after a verified Discord link. Never throws —
 * a failed role grant or avatar save must not undo a successful link.
 */
export async function finalizeDiscordLink(
  opts: FinalizeDiscordLinkOptions
): Promise<{ communityRoleAssigned: boolean }> {
  const { userId, displayName, discordUserId, discordUsername, avatarUrl, queryClient } = opts;

  // Fire-and-forget avatar save — never blocks the link.
  if (avatarUrl) void saveDiscordAvatar(avatarUrl, userId);

  try {
    await JourneyService.upsertTask(userId, PHASE, TASK_ID, true);
  } catch (err) {
    log.warn("finalize", "Journey task upsert failed (non-blocking)", { userId }, err);
  }

  let communityRoleAssigned = false;
  try {
    await assignCommunityRole(discordUserId);
    communityRoleAssigned = true;
  } catch {
    /* role sync retry queue + admin permissions are non-blocking */
  }

  DiscordNotifyService.discordVerified(displayName, discordUsername, discordUserId);

  queryClient.invalidateQueries({ queryKey: ["journey-completed", userId, PHASE] });
  queryClient.invalidateQueries({ queryKey: ["journey-progress", userId, PHASE] });

  try {
    await opts.refreshProfile();
  } catch {
    /* a stale profile refreshes on next navigation */
  }

  return { communityRoleAssigned };
}
