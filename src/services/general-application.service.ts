import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";
import { reportError } from "@/services/error-reporter.service";
import { airtableBreaker } from "@/lib/circuit-breaker";
import { sanitizeRecordFields } from "@/lib/validators/shared-input";
import { assertWritten } from "@/lib/db-helpers";

const log = createLogger("GeneralApplicationService");

/** Max length for free-text fields (OWASP A3 — injection prevention) */
const MAX_TEXT_LENGTH = 10_000;

/** Enforce max length on all string fields before persisting */
function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sanitizeRecordFields(fields))) {
    if (typeof value === "string" && value.length > MAX_TEXT_LENGTH) {
      result[key] = value.slice(0, MAX_TEXT_LENGTH);
      log.warn("sanitizeFields", `Truncated field "${key}" from ${value.length} to ${MAX_TEXT_LENGTH} chars`);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Fire-and-forget sync to Airtable via edge function (with circuit breaker) */
async function syncToAirtable(app: GeneralApplication): Promise<void> {
  try {
    const { data, error } = await airtableBreaker.executeWithFallback(
      () => supabase.functions.invoke<{
        success: boolean;
        error?: string;
        airtable_id?: string | null;
      }>("sync-airtable", {
        body: {
          application_id: app.id,
          email: app.email,
          title: app.title,
          about_yourself: app.about_yourself,
          status: app.status,
          created_at: app.created_at,
          updated_at: app.updated_at,
        },
      }),
      { data: { success: false, error: "circuit_open" }, error: null },
    );

    if (error) {
      log.warn("syncToAirtable", `Airtable sync request failed: ${error.message}`, { appId: app.id }, error);
      return;
    }

    if (!data?.success) {
      log.warn("syncToAirtable", `Airtable sync failed: ${data?.error ?? "Unknown error"}`, { appId: app.id });
      return;
    }

    log.info("syncToAirtable", `Synced app ${app.id} to Airtable`, {
      appId: app.id,
      airtableId: data.airtable_id ?? null,
    });
  } catch (err) {
    log.warn("syncToAirtable", "Airtable sync error (non-blocking)", { appId: app.id }, err);
  }
}

export interface GeneralApplication {
  id: string;
  user_id: string;
  email: string;
  status: string;
  title: string;
  about_yourself: string;
  hours_commitment: string;
  portfolio_url: string;
  linkedin_url: string;
  previous_engagement: string;
  previous_engagement_ways: string[];
  teammate_learnings: string;
  agile_vs_waterfall: string;
  psychological_safety: string;
  agile_philosophies: string;
  collaboration_challenges: string;
  service_leadership_definition: string;
  service_leadership_actions: string;
  service_leadership_challenges: string;
  service_leadership_situation: string;
  current_section: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Fetch the user's email from their profile */
async function getProfileEmail(userId: string): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("email")
    .eq("user_id", userId)
    .single();
  return data?.email ?? "";
}

/** Sync the about_yourself text to the profile's professional_background */
async function syncToProfileBackground(userId: string, aboutYourself: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("profiles")
      .update({ professional_background: aboutYourself } as any)
      .eq("user_id", userId);
    if (error) {
      log.warn("syncToProfileBackground", `Failed to sync background: ${error.message}`, { userId }, error);
    }
  } catch (err) {
    log.warn("syncToProfileBackground", "Background sync error (non-blocking)", { userId }, err);
  }
}

export const GeneralApplicationService = {
  /** Fetch all general applications for a user, newest first */
  async list(userId: string): Promise<GeneralApplication[]> {
    return log.track("list", `Listing general apps for user ${userId}`, { userId }, async () => {
      const { data, error } = await supabase
        .from("general_applications")
        .select("id, user_id, email, status, title, about_yourself, hours_commitment, portfolio_url, linkedin_url, previous_engagement, previous_engagement_ways, teammate_learnings, agile_vs_waterfall, psychological_safety, agile_philosophies, collaboration_challenges, service_leadership_definition, service_leadership_actions, service_leadership_challenges, service_leadership_situation, current_section, created_at, updated_at, completed_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });
      if (error) {
        log.error("list", `Failed to list general apps: ${error.message}`, { userId }, error);
        throw new Error("We couldn't load your application. Refresh to try again.s.");
      }
      return (data ?? []) as unknown as GeneralApplication[];
    });
  },

  /** Fetch a single application by ID */
  async fetch(id: string): Promise<GeneralApplication | null> {
    return log.track("fetch", `Fetching general app ${id}`, { id }, async () => {
      const { data, error } = await supabase
        .from("general_applications")
        .select("id, user_id, email, status, title, about_yourself, hours_commitment, portfolio_url, linkedin_url, previous_engagement, previous_engagement_ways, teammate_learnings, agile_vs_waterfall, psychological_safety, agile_philosophies, collaboration_challenges, service_leadership_definition, service_leadership_actions, service_leadership_challenges, service_leadership_situation, current_section, created_at, updated_at, completed_at")
        .eq("id", id)
        .single();
      if (error) {
        log.warn("fetch", `General app not found: ${error.message}`, { id }, error);
        return null;
      }
      return data as unknown as GeneralApplication;
    });
  },

  /** Create a new draft application */
  async create(userId: string, prefill?: Partial<Pick<GeneralApplication, "about_yourself">>): Promise<GeneralApplication> {
    return log.track("create", `Creating general app for user ${userId}`, { userId }, async () => {
      const email = await getProfileEmail(userId);
      const insertData: Record<string, unknown> = {
        user_id: userId,
        email,
        status: "draft",
        about_yourself: prefill?.about_yourself ?? "",
      };
      const { data, error } = await supabase
        .from("general_applications")
        .insert(sanitizeFields(insertData) as any)
        .select()
        .single();
      if (error) {
        log.error("create", `Failed to create general app: ${error.message}`, { userId }, error);
        throw new Error("Failed to create application.");
      }
      return data as unknown as GeneralApplication;
    });
  },

  /** Save progress (update fields), sync email/background to profile, and sync to Airtable */
  async save(id: string, fields: Partial<Omit<GeneralApplication, "id" | "user_id" | "created_at" | "updated_at">>): Promise<void> {
    return log.track("save", `Saving general app ${id}`, { id, fields: Object.keys(fields) }, async () => {
      // Defensive .select() so silent RLS-filtered 0-row updates surface as
      // a real error instead of a misleading green toast.
      const result = await supabase
        .from("general_applications")
        .update(sanitizeFields(fields as Record<string, unknown>) as any)
        .eq("id", id)
        .select("id");
      if (result.error) {
        log.error("save", `Failed to save general app: ${result.error.message}`, { id }, result.error);
        throw new Error("We couldn't save your application. Refresh and try again..");
      }
      assertWritten(result, "general-application.save", { id });
      // Fetch updated record for syncs
      const updated = await GeneralApplicationService.fetch(id);
      if (updated) {
        // Sync about_yourself → profile.professional_background (non-blocking)
        if ((fields as Record<string, unknown>).about_yourself !== undefined) {
          syncToProfileBackground(updated.user_id, updated.about_yourself).catch((e) => reportError(e, "general-application.syncToProfileBackground", { severity: "warn" }));
        }
        // Sync to Airtable (non-blocking, circuit-breaker protected)
        syncToAirtable(updated).catch((e) => reportError(e, "general-application.syncToAirtable", { severity: "warn" }));
      }
    });
  },

  /** Delete an application */
  async remove(id: string): Promise<void> {
    return log.track("remove", `Deleting general app ${id}`, { id }, async () => {
      const { error } = await supabase
        .from("general_applications")
        .delete()
        .eq("id", id);
      if (error) {
        log.error("remove", `Failed to delete general app: ${error.message}`, { id }, error);
        throw new Error("We couldn't delete that application. Please try again..");
      }
    });
  },

  /** Get the most recently completed application for prefill */
  async getLatestCompleted(userId: string): Promise<GeneralApplication | null> {
    return log.track("getLatestCompleted", `Fetching latest completed app for user ${userId}`, { userId }, async () => {
      const { data, error } = await supabase
        .from("general_applications")
        .select("id, user_id, email, status, title, about_yourself, hours_commitment, portfolio_url, linkedin_url, previous_engagement, previous_engagement_ways, teammate_learnings, agile_vs_waterfall, psychological_safety, agile_philosophies, collaboration_challenges, service_leadership_definition, service_leadership_actions, service_leadership_challenges, service_leadership_situation, current_section, created_at, updated_at, completed_at")
        .eq("user_id", userId)
        .eq("status", "completed")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        log.warn("getLatestCompleted", `Query failed: ${error.message}`, { userId }, error);
        return null;
      }
      return data as unknown as GeneralApplication | null;
    });
  },
};
