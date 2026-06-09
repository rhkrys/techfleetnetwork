import { supabase } from "@/integrations/supabase/client";
import { ProfileService, type Profile } from "@/services/profile.service";
import { createLogger } from "@/services/logger.service";

/**
 * profile-setup.service — single source of truth for the initial
 * profile-completion flow. Dialog and standalone page share this so a fix
 * in one is a fix in both.
 *
 * Invariant: `profile_completed=true` is set EXCLUSIVELY by `complete()`.
 * `autosaveDraft` accepts a typed allowlist that excludes that field at
 * the type level, making accidental completion a compile error.
 */

const log = createLogger("profile-setup.service");

/** Fields autosave is allowed to write. Excludes `profile_completed`. */
export type ProfileDraftFields = Omit<Partial<Profile>, "profile_completed">;

export interface InitFromAuthResult {
  profile: Profile | null;
  isNewProfile: boolean;
}

export const ProfileSetupService = {
  /** Read existing profile (if any) to seed the form. */
  async initFromAuth(userId: string): Promise<InitFromAuthResult> {
    const profile = await ProfileService.fetch(userId);
    return { profile, isNewProfile: !profile };
  },

  /**
   * Persist a draft. NEVER sets `profile_completed=true` — the type
   * signature forbids it. Safe to call on every keystroke (debounced
   * by the form hook).
   */
  async autosaveDraft(userId: string, draft: ProfileDraftFields): Promise<void> {
    // Strip the forbidden field even if a caller fabricates an `any`.
    const safe = { ...draft } as Record<string, unknown>;
    delete safe.profile_completed;
    if (Object.keys(safe).length === 0) return;
    const { error } = await supabase
      .from("profiles")
      .update(safe as never)
      .eq("user_id", userId);
    if (error) {
      log.warn("autosaveDraft", "update failed", { userId, code: error.code, msg: error.message });
      throw error;
    }
  },

  /**
   * Finalize profile setup. The only writer of `profile_completed=true`.
   * Discord notify + journey upsert run via `Promise.allSettled` so a
   * partial failure cannot block UI progression.
   */
  async complete(userId: string, finalFields: ProfileDraftFields): Promise<void> {
    const safe = { ...finalFields, profile_completed: true } as Record<string, unknown>;
    const { error } = await supabase
      .from("profiles")
      .update(safe as never)
      .eq("user_id", userId);
    if (error) {
      log.warn("complete", "update failed", { userId, code: error.code, msg: error.message });
      throw error;
    }

    // Side effects: best-effort, non-blocking.
    await Promise.allSettled([
      this.syncJourneyTasks(userId),
      this.notifyDiscord(userId),
    ]);
  },

  async syncJourneyTasks(userId: string): Promise<void> {
    try {
      await supabase.rpc("sync_journey_tasks_for_user" as never, { p_user_id: userId } as never);
    } catch (e) {
      log.warn("syncJourneyTasks", "rpc threw (non-fatal)", { err: e instanceof Error ? e.message : String(e) });
    }
  },

  async notifyDiscord(userId: string): Promise<void> {
    try {
      await supabase.functions.invoke("notify-profile-completed", { body: { userId } });
    } catch (e) {
      log.warn("notifyDiscord", "invoke threw (non-fatal)", { err: e instanceof Error ? e.message : String(e) });
    }
  },
};
