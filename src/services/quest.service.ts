import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";

const log = createLogger("QuestService");

export interface QuestPath {
  id: string;
  slug: string;
  title: string;
  description: string;
  level: string;
  icon: string;
  sort_order: number;
  estimated_duration: string;
  duration_phases: { label: string; duration: string }[];
  prerequisites: string[];
}

export interface QuestPathStep {
  id: string;
  path_id: string;
  title: string;
  description: string;
  step_type: "course" | "self_report" | "system_verified" | "application";
  sort_order: number;
  linked_phase: string | null;
  linked_table: string | null;
  linked_filter: Record<string, unknown> | null;
}

export interface UserQuestSelection {
  id: string;
  user_id: string;
  path_id: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface SystemVerificationData {
  generalApplications: { id: string; status: string; completed_at: string | null }[];
  projectApplications: { id: string; status: string; applicant_status: string; completed_at: string | null; project_id: string }[];
  classCertifications: { id: string; user_id: string }[];
}

function toQuestPath(p: Record<string, unknown>): QuestPath {
  return {
    ...(p as unknown as QuestPath),
    duration_phases: (p.duration_phases as { label: string; duration: string }[]) ?? [],
    prerequisites: (p.prerequisites as string[]) ?? [],
  };
}

/** Pre-parsed step row to typed QuestPathStep */
function toQuestPathStep(s: Record<string, unknown>): QuestPathStep {
  return {
    ...(s as unknown as QuestPathStep),
    step_type: s.step_type as QuestPathStep["step_type"],
    linked_filter: s.linked_filter as Record<string, unknown> | null,
  };
}

export const QuestService = {
  async getPaths(): Promise<QuestPath[]> {
    return log.track("getPaths", "Loading all quest paths", {}, async () => {
      const { data, error } = await supabase
        .from("quest_paths")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) {
        log.error("getPaths", error.message, {}, error);
        throw new Error("Failed to load quest paths");
      }
      return (data ?? []).map(toQuestPath);
    });
  },

  async getSteps(pathId: string): Promise<QuestPathStep[]> {
    return log.track("getSteps", `Loading steps for path ${pathId}`, { pathId }, async () => {
      const { data, error } = await supabase
        .from("quest_path_steps")
        .select("*")
        .eq("path_id", pathId)
        .order("sort_order", { ascending: true });
      if (error) {
        log.error("getSteps", error.message, { pathId }, error);
        throw new Error("Failed to load path steps");
      }
      return (data ?? []).map(toQuestPathStep);
    });
  },

  async getAllSteps(): Promise<QuestPathStep[]> {
    return log.track("getAllSteps", "Loading all quest steps", {}, async () => {
      const { data, error } = await supabase
        .from("quest_path_steps")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) {
        log.error("getAllSteps", error.message, {}, error);
        throw new Error("Failed to load all steps");
      }
      return (data ?? []).map(toQuestPathStep);
    });
  },

  async getUserSelections(userId: string): Promise<UserQuestSelection[]> {
    return log.track("getUserSelections", "Loading user quest selections", { userId }, async () => {
      const { data, error } = await supabase
        .from("user_quest_selections")
        .select("*")
        .eq("user_id", userId);
      if (error) {
        log.error("getUserSelections", error.message, { userId }, error);
        throw new Error("Failed to load quest selections");
      }
      return data ?? [];
    });
  },

  /** Batch-add multiple paths in a single DB round-trip */
  async addPaths(userId: string, pathIds: string[]): Promise<void> {
    if (pathIds.length === 0) return;
    return log.track("addPaths", `Adding ${pathIds.length} paths`, { userId, count: pathIds.length }, async () => {
      const rows = pathIds.map((pathId) => ({
        user_id: userId,
        path_id: pathId,
        started_at: new Date().toISOString(),
      }));
      const { error } = await supabase
        .from("user_quest_selections")
        .upsert(rows, { onConflict: "user_id,path_id", ignoreDuplicates: true });
      if (error) {
        log.error("addPaths", error.message, { userId }, error);
        throw new Error("We couldn't add that path. Please try again.s");
      }
    });
  },

  async addPath(userId: string, pathId: string): Promise<void> {
    return log.track("addPath", `Adding path ${pathId}`, { userId, pathId }, async () => {
      const { error } = await supabase.from("user_quest_selections").insert({
        user_id: userId,
        path_id: pathId,
        started_at: new Date().toISOString(),
      });
      if (error) {
        log.error("addPath", error.message, { userId, pathId }, error);
        throw new Error("We couldn't add that path. Please try again.");
      }
    });
  },

  async removePath(userId: string, pathId: string): Promise<void> {
    return log.track("removePath", `Removing path ${pathId}`, { userId, pathId }, async () => {
      const { error } = await supabase
        .from("user_quest_selections")
        .delete()
        .eq("user_id", userId)
        .eq("path_id", pathId);
      if (error) {
        log.error("removePath", error.message, { userId, pathId }, error);
        throw new Error("We couldn't remove that path. Please try again.");
      }
    });
  },

  async completeSelfReportStep(userId: string, stepId: string, completed: boolean): Promise<void> {
    return log.track("completeSelfReportStep", `${completed ? "Completing" : "Uncompleting"} step ${stepId}`, { userId, stepId }, async () => {
      if (!completed) {
        // Uncomplete path must go through the SECURITY DEFINER RPC so the
        // journey_progress uncomplete-guard trigger sees app.allow_uncomplete=on.
        // QUEST-UNCOMPLETE-001.
        const { error } = await supabase.rpc("set_self_report_step_incomplete", { p_step_id: stepId });
        if (error) {
          log.error("completeSelfReportStep", error.message, { userId, stepId, completed }, error);
          throw new Error("We couldn't update that step. Please try again.");
        }
        return;
      }
      const { error } = await supabase.from("journey_progress").upsert(
        {
          user_id: userId,
          phase: "first_steps" as const,
          task_id: `quest-step-${stepId}`,
          completed: true,
          completed_at: new Date().toISOString(),
        },
        { onConflict: "user_id,phase,task_id" }
      );
      if (error) {
        log.error("completeSelfReportStep", error.message, { userId, stepId }, error);
        throw new Error("We couldn't update that step. Please try again.");
      }
    });
  },

  async getSelfReportProgress(userId: string): Promise<Map<string, boolean>> {
    return log.track("getSelfReportProgress", "Loading self-report progress", { userId }, async () => {
      const { data, error } = await supabase
        .from("journey_progress")
        .select("task_id, completed")
        .eq("user_id", userId)
        .like("task_id", "quest-step-%");
      if (error) {
        log.error("getSelfReportProgress", error.message, { userId }, error);
        throw new Error("Failed to load self-report progress");
      }
      const map = new Map<string, boolean>();
      for (const row of data ?? []) {
        const stepId = row.task_id.replace("quest-step-", "");
        map.set(stepId, row.completed);
      }
      return map;
    });
  },

  /**
   * Batch-fetch journey progress for ALL phases in a single query.
   * Replaces 7 separate phase-specific queries, reducing DB hits by ~85%.
   */
  async getAllJourneyProgress(userId: string): Promise<Map<string, { task_id: string; completed: boolean }[]>> {
    return log.track("getAllJourneyProgress", "Loading all journey progress", { userId }, async () => {
      const { data, error } = await supabase
        .from("journey_progress")
        .select("phase, task_id, completed")
        .eq("user_id", userId);
      if (error) {
        log.error("getAllJourneyProgress", error.message, { userId }, error);
        throw new Error("Failed to load journey progress");
      }
      const map = new Map<string, { task_id: string; completed: boolean }[]>();
      for (const row of data ?? []) {
        const phase = row.phase as string;
        if (!map.has(phase)) map.set(phase, []);
        map.get(phase)!.push({ task_id: row.task_id, completed: row.completed });
      }
      return map;
    });
  },

  /**
   * Fetch system verification data for quest steps that reference other tables.
   * Single batch fetch for general_applications, project_applications, and class_certifications.
   * Reduces N+1 queries to 3 parallel queries.
   */
  async getSystemVerificationData(userId: string): Promise<SystemVerificationData> {
    return log.track("getSystemVerificationData", "Loading system verification data", { userId }, async () => {
      const [gaRes, paRes, ccRes] = await Promise.all([
        supabase
          .from("general_applications")
          .select("id, status, completed_at")
          .eq("user_id", userId),
        supabase
          .from("project_applications")
          .select("id, status, applicant_status, completed_at, project_id")
          .eq("user_id", userId),
        supabase
          .from("class_certifications")
          .select("id, user_id")
          .eq("user_id", userId),
      ]);

      if (gaRes.error) log.error("getSystemVerificationData", "general_applications: " + gaRes.error.message, { userId });
      if (paRes.error) log.error("getSystemVerificationData", "project_applications: " + paRes.error.message, { userId });
      if (ccRes.error) log.error("getSystemVerificationData", "class_certifications: " + ccRes.error.message, { userId });

      return {
        generalApplications: gaRes.data ?? [],
        projectApplications: paRes.data ?? [],
        classCertifications: ccRes.data ?? [],
      };
    });
  },
};
