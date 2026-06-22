import { supabase } from "@/integrations/supabase/client";
import type { ClassFormValues } from "@/lib/validators/class";
import { assertWritten } from "@/lib/db-helpers";
import { isTransientError } from "@/lib/errors/extract";
import { sendClassStatusEmails } from "./class-emails";

/**
 * Retry a Supabase mutation on transient upstream failures only.
 * Never retries RLS denials, validation errors, or unknown errors.
 * Exponential backoff with jitter: 250ms, 500ms, 1000ms.
 */
async function retryTransient<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 250;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err) || i === attempts - 1) throw err;
      const delay = baseMs * Math.pow(2, i) + Math.floor(Math.random() * baseMs);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export type ClassRow = {
  id: string;
  owner_user_id: string;
  title: string;
  slug: string;
  track: "basic_training" | "advanced_training";
  status: "draft" | "pending_review" | "published" | "archived";
  summary: string;
  description: string | null;
  hero_image_url: string | null;
  skills: string[];
  outcomes: string;
  why_take: string;
  audiences: string;
  prerequisites: string[];
  submitted_at: string | null;
  published_at: string | null;
  archived_at: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
};

export const ClassService = {
  async listPublishedByTrack(track: ClassRow["track"]): Promise<ClassRow[]> {
    const { data, error } = await supabase
      .from("classes")
      .select("*")
      .eq("status", "published")
      .eq("track", track)
      .order("published_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as ClassRow[];
  },

  async listMine(ownerId: string): Promise<ClassRow[]> {
    const { data, error } = await supabase
      .from("classes")
      .select("*")
      .eq("owner_user_id", ownerId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as ClassRow[];
  },

  async listAll(): Promise<ClassRow[]> {
    const { data, error } = await supabase
      .from("classes")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as ClassRow[];
  },

  async getById(id: string): Promise<ClassRow | null> {
    const { data, error } = await supabase.from("classes").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return (data ?? null) as ClassRow | null;
  },

  async getBySlug(slug: string): Promise<ClassRow | null> {
    const { data, error } = await supabase.from("classes").select("*").eq("slug", slug).maybeSingle();
    if (error) throw error;
    return (data ?? null) as ClassRow | null;
  },

  async create(ownerId: string, values: ClassFormValues): Promise<string> {
    const { data, error } = await supabase
      .from("classes")
      .insert({
        owner_user_id: ownerId,
        title: values.title,
        summary: values.summary,
        description: values.description ?? null,
        track: values.track,
        hero_image_url: values.hero_image_url || null,
        skills: values.skills,
        outcomes: values.outcomes,
        why_take: values.why_take,
        audiences: values.audiences,
        prerequisites: values.prerequisites,
        slug: "", // server trigger will populate
      } as never)
      .select("id")
      // single-required: insert returns exactly one row
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  },

  async update(id: string, values: Partial<ClassFormValues>): Promise<void> {
    const payload: Record<string, unknown> = { ...values };
    if (values.hero_image_url === "") payload.hero_image_url = null;
    const result = await supabase.from("classes").update(payload).eq("id", id).select("id");
    if (result.error) throw result.error;
    assertWritten(result, "class.update", { id });
  },

  async submitForReview(id: string, cohortIds: string[] = []): Promise<void> {
    const { error } = await (supabase as any).rpc("submit_class_for_review", {
      p_class_id: id,
      p_cohort_ids: cohortIds,
    });
    if (error) throw error;
    void sendClassStatusEmails(id, "submitted");
  },

  async approveAndPublish(id: string): Promise<void> {
    const { error } = await (supabase as any).rpc("approve_and_publish_class", { p_class_id: id });
    if (error) throw error;
    void sendClassStatusEmails(id, "approved");
  },

  async requestChanges(id: string, reason: string): Promise<void> {
    const { error } = await (supabase as any).rpc("request_class_changes", {
      p_class_id: id,
      p_reason: reason,
    });
    if (error) throw error;
    void sendClassStatusEmails(id, "changes_requested", reason);
  },

  async archive(id: string, reason?: string): Promise<void> {
    const { error } = await (supabase as any).rpc("archive_class", {
      p_class_id: id,
      p_reason: reason ?? null,
    });
    if (error) throw error;
    void sendClassStatusEmails(id, "archived", reason);
  },

  async listAuditHistory(classId: string): Promise<Array<{
    id: string;
    action: string;
    from_status: string | null;
    to_status: string | null;
    reason: string | null;
    actor_user_id: string | null;
    created_at: string;
  }>> {
    const { data, error } = await supabase
      .from("class_audit")
      .select("id, action, from_status, to_status, reason, actor_user_id, created_at")
      .eq("class_id", classId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as never;
  },

  async follow(classId: string, userId: string): Promise<void> {
    const { error } = await supabase.from("class_followers").insert({ class_id: classId, user_id: userId } as never);
    if (error && !String(error.message).includes("duplicate")) throw error;
  },

  async unfollow(classId: string, userId: string): Promise<void> {
    const { error } = await supabase.from("class_followers").delete().eq("class_id", classId).eq("user_id", userId);
    if (error) throw error;
  },

  async isFollowing(classId: string, userId: string): Promise<boolean> {
    const { count, error } = await supabase
      .from("class_followers")
      .select("id", { head: true, count: "exact" })
      .eq("class_id", classId)
      .eq("user_id", userId);
    if (error) throw error;
    return (count ?? 0) > 0;
  },
};
