import { supabase } from "@/integrations/supabase/client";
import type { ProfileInput } from "@/lib/validators/profile";
import { createLogger } from "@/services/logger.service";
import { pickAllowedFields, deepSanitize } from "@/lib/security";
import { retryPostgrest } from "@/lib/data/transient-retry";
import { withAuthLockRetry } from "@/lib/auth/auth-lock-retry";

const log = createLogger("ProfileService");

export interface Profile {
  first_name: string;
  last_name: string;
  email: string;
  country: string;
  timezone: string;
  discord_username: string;
  discord_user_id: string;
  display_name: string;
  avatar_url: string | null;
  profile_completed: boolean;
  interests: string[];
  portfolio_url: string;
  linkedin_url: string;
  scheduling_url: string;
  experience_areas: string[];
  professional_goals: string;
  notify_training_opportunities: boolean;
  notify_announcements: boolean;
  education_background: string[];
  has_discord_account: boolean;
  discord_invite_url: string;
  membership_tier: "starter" | "community" | "professional";
  is_founding_member: boolean;
  membership_billing_period: string;
  membership_sku: string;
  membership_gumroad_sale_id: string;
  membership_updated_at: string | null;
  preferred_language: string | null;
}

export const ProfileService = {
  async fetch(userId: string): Promise<Profile | null> {
    return log.track("fetch", `Fetching profile for user ${userId}`, { userId }, async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("first_name, last_name, email, country, timezone, discord_username, discord_user_id, display_name, avatar_url, profile_completed, interests, portfolio_url, linkedin_url, scheduling_url, experience_areas, professional_goals, notify_training_opportunities, notify_announcements, education_background, has_discord_account, discord_invite_url, membership_tier, is_founding_member, membership_billing_period, membership_sku, membership_gumroad_sale_id, membership_updated_at, preferred_language")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        log.warn("fetch", `Profile not found or query failed for user ${userId}: ${error.message}`, {
          userId,
          errorCode: error.code,
          errorDetails: error.details,
          errorHint: error.hint,
        }, error);
        return null;
      }
      log.info("fetch", `Profile loaded for user ${userId}`, {
        userId,
        profileCompleted: (data as any)?.profile_completed,
        hasDiscord: !!(data as any)?.discord_username,
      });
      return data as unknown as Profile;
    });
  },

  async update(userId: string, input: ProfileInput, email?: string) {
    return log.track("update", `Updating profile for user ${userId}`, {
      userId,
      fields: Object.keys(input),
      country: input.country,
      hasDiscord: !!input.discordUsername,
      interestCount: input.interests?.length ?? 0,
      hasEmail: !!email,
    }, async () => {
      // Build update payload with only known safe fields (A04 mass assignment)
      const rawData: Record<string, unknown> = {
        first_name: input.firstName,
        last_name: input.lastName,
        country: input.country,
        timezone: input.timezone,
        display_name: `${input.firstName} ${input.lastName}`.trim(),
        interests: input.interests || [],
        profile_completed: true,
        portfolio_url: input.portfolio_url || "",
        linkedin_url: input.linkedin_url || "",
        scheduling_url: input.scheduling_url || "",
        experience_areas: input.experience_areas || [],
        professional_goals: input.professional_goals || "",
        notify_training_opportunities: input.notify_training_opportunities ?? false,
        notify_announcements: input.notify_announcements ?? false,
        education_background: input.education_background || [],
        has_discord_account: input.has_discord_account ?? true,
      };

      // A03/A08: Deep-sanitize all string values to prevent stored XSS
      const updateData = deepSanitize(rawData) as Record<string, unknown>;

      const { error } = await (supabase
        .from("profiles") as any)
        .update(updateData)
        .eq("user_id", userId);
      if (error) {
        log.error("update", `Failed to save profile for user ${userId}: ${error.message}`, {
          userId,
          errorCode: error.code,
          errorDetails: error.details,
          errorHint: error.hint,
        }, error);
        throw new Error("Failed to save profile. Please try again.");
      }
      log.info("update", `Profile saved successfully for user ${userId}`, { userId });
    });
  },

  async updateNames(userId: string, firstName: string, lastName: string, email?: string) {
    return log.track("updateNames", `Syncing OAuth names for user ${userId}`, {
      userId,
      firstName,
      lastName,
      hasEmail: !!email,
    }, async () => {
      const rawData: Record<string, string> = {
        first_name: firstName,
        last_name: lastName,
        display_name: `${firstName} ${lastName}`.trim(),
      };

      // A03: Sanitize OAuth-provided names before persisting
      const updateData = deepSanitize(rawData) as Record<string, unknown>;

      const { error } = await (supabase
        .from("profiles") as any)
        .update(updateData)
        .eq("user_id", userId);
      if (error) {
        log.error("updateNames", `Failed to sync profile names for user ${userId}: ${error.message}`, {
          userId,
          errorCode: error.code,
          errorDetails: error.details,
        }, error);
        throw new Error("Failed to sync profile names.");
      }
      log.info("updateNames", `Profile names synced for user ${userId}`, { userId, firstName, lastName });
    });
  },

  /** Update arbitrary profile fields (used by general application to sync Section 2 fields) */
  async updateFields(userId: string, fields: Record<string, unknown>) {
    // Mass assignment protection: only allow known safe fields
    const ALLOWED_PROFILE_FIELDS = [
      "first_name",
      "last_name",
      "display_name",
      "country",
      "timezone",
      "bio",
      "professional_background",
      "professional_goals",
      "education_background",
      "experience_areas",
      "interests",
      "portfolio_url",
      "linkedin_url",
      "scheduling_url",
      "notify_training_opportunities",
      "notify_announcements",
      "has_discord_account",
      "avatar_url",
    ];
    const safeFields = pickAllowedFields(fields, ALLOWED_PROFILE_FIELDS);
    // Sanitize string values to prevent stored XSS
    const sanitizedFields = deepSanitize(safeFields);

    return log.track("updateFields", `Updating profile fields for user ${userId}`, {
      userId,
      fields: Object.keys(sanitizedFields),
    }, async () => {
      if (Object.keys(sanitizedFields).length === 0) {
        log.warn("updateFields", "No allowed fields to update", { userId, requestedFields: Object.keys(fields) });
        return;
      }
      const { error } = await supabase
        .from("profiles")
        .update(sanitizedFields as any)
        .eq("user_id", userId);
      if (error) {
        log.error("updateFields", `Failed to update profile fields: ${error.message}`, { userId }, error);
        throw new Error("Failed to update profile.");
      }
      log.info("updateFields", `Profile fields updated for user ${userId}`, { userId });
    });
  },
};
