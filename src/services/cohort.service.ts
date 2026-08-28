import { supabase } from "@/integrations/supabase/client";
import { getUserSafe } from "@/lib/auth/session-port";
import type { CohortFormValues } from "@/lib/validators/cohort";
import { assertWritten } from "@/lib/db-helpers";
import { retryTransientWrite } from "@/lib/db/retry";
import { retryPostgrest } from "@/lib/data/transient-retry";

export type CohortRow = {
  id: string;
  class_id: string;
  label: string;
  start_date: string;
  end_date: string;
  timezone: string;
  registration_url: string;
  discount_registration_url: string | null;
  meeting_url: string | null;
  capacity: number | null;
  status: "draft" | "pending_review" | "published" | "archived" | "cancelled";
  schedule: string;
  submitted_at: string | null;
  published_at: string | null;
  archived_at: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
};

export const CohortService = {
  async listByClass(classId: string): Promise<CohortRow[]> {
    const { data, error } = await retryPostgrest(() =>
      supabase
        .from("cohorts")
        .select("*")
        .eq("class_id", classId)
        .order("start_date", { ascending: true })
    );
    if (error) throw error;
    return (data ?? []) as CohortRow[];
  },

  async listPublishedByClass(classId: string): Promise<CohortRow[]> {
    const { data, error } = await retryPostgrest(() =>
      supabase
        .from("cohorts")
        .select("*")
        .eq("class_id", classId)
        .eq("status", "published")
        .order("start_date", { ascending: true })
    );
    if (error) throw error;
    return (data ?? []) as CohortRow[];
  },

  async getById(id: string): Promise<CohortRow | null> {
    const { data, error } = await retryPostgrest(() =>
      supabase.from("cohorts").select("*").eq("id", id).maybeSingle()
    );
    if (error) throw error;
    return (data ?? null) as CohortRow | null;
  },

  async create(classId: string, values: CohortFormValues): Promise<string> {
    return retryTransientWrite(async () => {
      const { data, error } = await supabase
        .from("cohorts")
        .insert({
          class_id: classId,
          label: values.label,
          start_date: values.start_date,
          end_date: values.end_date,
          registration_url: values.registration_url,
          discount_registration_url: values.discount_registration_url || null,
          meeting_url: values.meeting_url || null,
          timezone: values.timezone || "America/New_York",
          capacity: values.capacity ?? null,
          schedule: values.schedule ?? "",
        } as never)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        throw new Error(
          "Cohort was not created. This usually means your role can't insert this row — refresh and try again or contact an admin."
        );
      }
      return (data as { id: string }).id;
    });
  },

  async update(id: string, values: Partial<CohortFormValues>): Promise<void> {
    const payload: Record<string, unknown> = { ...values };
    if (values.meeting_url === "") payload.meeting_url = null;
    // Same reason as meeting_url: the Gumroad CHECK constraint accepts NULL
    // or an allowlisted URL, never an empty string.
    if (values.discount_registration_url === "") payload.discount_registration_url = null;
    await retryTransientWrite(async () => {
      const result = await supabase.from("cohorts").update(payload).eq("id", id).select("id");
      if (result.error) throw result.error;
      assertWritten(result, "cohort.update", { id });
    });
  },

  async submitForReview(classId: string, cohortIds: string[] = []): Promise<void> {
    // Cohorts are co-submitted alongside the class via submit_class_for_review.
    const { error } = await (supabase as any).rpc("submit_class_for_review", {
      p_class_id: classId,
      p_cohort_ids: cohortIds,
    });
    if (error) throw error;
  },

  async cancel(id: string, reason?: string): Promise<void> {
    const { error } = await (supabase as any).rpc("cancel_cohort", {
      p_cohort_id: id,
      p_reason: reason ?? null,
    });
    if (error) throw error;
  },

  async recordRegistrationClick(cohortId: string, referrer?: string): Promise<void> {
    const user = await getUserSafe();
    const userId = user?.id;
    if (!userId) return;
    const { error } = await (supabase as any).rpc("register_for_cohort_click", {
      _cohort_id: cohortId,
      _referrer: referrer ?? null,
    });
    if (error) throw error;
  },
};
