import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { createLogger } from "@/services/logger.service";
import { isTransientError } from "@/lib/transient-error";
import { retryPostgrest } from "@/lib/data/transient-retry";

const log = createLogger("JourneyService");

// Per-process dedupe cache: collapses identical task upserts fired within 2s
// (UI double-clicks, fast re-renders). Keeps the connection pool clear.
const journeyDedupe = new Map<string, number>();

type JourneyPhase = Database["public"]["Enums"]["journey_phase"];

export interface TaskProgress {
  task_id: string;
  completed: boolean;
}

// A03: Whitelist valid task IDs to prevent injection
import { ALL_AGILE_LESSON_IDS } from "@/data/agile-course";
import { ALL_TEAMWORK_LESSON_IDS } from "@/data/teamwork-course";
import { ALL_PROJECT_TRAINING_LESSON_IDS } from "@/data/project-training-course";
import { ALL_VOLUNTEER_LESSON_IDS } from "@/data/volunteer-teams-course";
import { ALL_DISCORD_LESSON_IDS } from "@/data/discord-course";

const VALID_TASK_IDS = new Set([
  "profile",
  
  "connect-discord",
  "onboarding-class",
  "service-leadership",
  "user-guide",
  "figma-account",
  "community-agreement",
  "privacy-policy",
  "terms-conditions",
  "terms-of-use",
  "cookie-policy",
  ...ALL_AGILE_LESSON_IDS,
  ...ALL_TEAMWORK_LESSON_IDS,
  ...ALL_PROJECT_TRAINING_LESSON_IDS,
  ...ALL_VOLUNTEER_LESSON_IDS,
  ...ALL_DISCORD_LESSON_IDS,
]);

const VALID_PHASES: Set<string> = new Set([
  "first_steps",
  "second_steps",
  "third_steps",
  "observer",
  "projects",
  "project_training",
  "volunteer",
  "discord_learning",
]);

export const JourneyService = {
  async getProgress(userId: string, phase: JourneyPhase): Promise<TaskProgress[]> {
    if (!VALID_PHASES.has(phase)) {
      log.error("getProgress", `Invalid phase "${phase}" requested`, { userId, phase });
      throw new Error("Invalid phase");
    }

    return log.track("getProgress", `Loading ${phase} progress for user ${userId}`, { userId, phase }, async () => {
      // Wrapped in retryPostgrest: PGRST002 schema-cache reloads and 5xx
      // blips during HEAD/GET are transparently retried before the caller
      // sees a failure. Structural errors (RLS, schema) still surface.
      const { data, error } = await retryPostgrest(() =>
        supabase
          .from("journey_progress")
          .select("task_id, completed")
          .eq("user_id", userId)
          .eq("phase", phase),
      );
      if (error) {
        log.error("getProgress", `Database query failed for ${phase} progress: ${error.message}`, {
          userId,
          phase,
          errorCode: error.code,
          errorDetails: error.details,
        }, error);
        throw new Error("Failed to load progress");
      }
      const completedCount = data?.filter((t) => t.completed).length ?? 0;
      log.info("getProgress", `Loaded ${data?.length ?? 0} tasks (${completedCount} completed) for ${phase}`, {
        userId,
        phase,
        totalTasks: data?.length ?? 0,
        completedCount,
      });
      return data ?? [];
    });
  },

  async getCompletedCount(userId: string, phase: JourneyPhase, validTaskIds?: readonly string[]): Promise<number> {
    if (!VALID_PHASES.has(phase)) {
      log.error("getCompletedCount", `Invalid phase "${phase}" requested`, { userId, phase });
      throw new Error("Invalid phase");
    }

    return log.track("getCompletedCount", `Counting completed ${phase} tasks for user ${userId}`, { userId, phase }, async () => {
      // Use DB-side count (head: true) to avoid transferring row data — critical at 10k+ users
      let query = supabase
        .from("journey_progress")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("phase", phase)
        .eq("completed", true);

      if (validTaskIds && validTaskIds.length > 0) {
        query = query.in("task_id", [...validTaskIds]);
      }

      const { count, error } = await query;
      if (error) {
        // Transient PostgREST/network/5xx blip — graceful-degrade to 0
        // rather than throwing. The user sees a momentarily-stale progress
        // count on the next refetch; the triage queue never opens a row.
        // (TRIAGE-NOISE-015)
        const wrapped = Object.assign(new Error(error.message), {
          code: (error as { code?: string }).code,
          status: (error as { status?: number }).status,
        });
        if (isTransientError(wrapped)) {
          log.warn("getCompletedCount", `Transient count blip for ${phase}; degrading to 0`, {
            userId, phase, errorCode: (error as { code?: string }).code,
          });
          return 0;
        }
        log.error("getCompletedCount", `Count query failed: ${error.message}`, { userId, phase }, error);
        // Structural error (RLS denial, schema mismatch, code bug) — surface
        // it. Preserve PostgREST classification fields so callers / React
        // Query's onError can re-check isTransientError().
        const surfaced = new Error("Failed to count progress") as Error & {
          code?: string; status?: number; cause?: unknown;
        };
        surfaced.code = (error as { code?: string }).code;
        surfaced.status = (error as { status?: number }).status;
        surfaced.cause = error;
        throw surfaced;
      }
      const result = count ?? 0;
      log.debug("getCompletedCount", `User ${userId} has ${result} completed tasks in ${phase}`, { userId, phase, count: result });
      return result;
    });
  },

  async upsertTask(userId: string, phase: JourneyPhase, taskId: string, completed: boolean) {
    // A03: Validate inputs against whitelists
    if (!VALID_PHASES.has(phase)) {
      log.error("upsertTask", `Invalid phase "${phase}" — rejecting upsert`, { userId, phase, taskId });
      throw new Error("Invalid phase");
    }
    if (!VALID_TASK_IDS.has(taskId)) {
      log.error("upsertTask", `Invalid task ID "${taskId}" — rejecting upsert (possible injection attempt)`, { userId, phase, taskId });
      throw new Error("Invalid task ID");
    }

    return log.track("upsertTask", `${completed ? "Completing" : "Uncompleting"} task "${taskId}" in ${phase}`, {
      userId,
      phase,
      taskId,
      completed,
    }, async () => {
      // Part 2 §B1: uncompletion must go through the SECURITY DEFINER RPC,
      // which sets app.allow_uncomplete=true so the BEFORE-UPDATE guard on
      // journey_progress permits clearing completed/completed_at. Callers
      // are expected to gate this behind a verb+object ConfirmDialog
      // ("Mark step incomplete").
      if (!completed) {
        const { error } = await supabase.rpc("mark_task_incomplete", {
          p_phase: phase,
          p_task_id: taskId,
        });
        if (error) {
          log.error("upsertTask", `Failed to mark task "${taskId}" incomplete for user ${userId}: ${error.message}`, {
            userId, phase, taskId, completed,
            errorCode: error.code, errorDetails: error.details,
          }, error);
          throw new Error("Failed to update progress");
        }
        log.info("upsertTask", `Task "${taskId}" uncompleted for user ${userId} in ${phase}`, {
          userId, phase, taskId, completed,
        });
        return;
      }

      // Dedupe: if an identical upsert just completed within 2s, skip the
      // round-trip. Prevents UI double-clicks and rapid re-renders from
      // saturating the connection pool with duplicate writes.
      const dedupeKey = `${userId}::${phase}::${taskId}::${completed ? 1 : 0}`;
      const now = Date.now();
      const lastAt = journeyDedupe.get(dedupeKey) ?? 0;
      if (now - lastAt < 2_000) {
        log.info("upsertTask", `Skipped duplicate upsert for "${taskId}" within 2s`, {
          userId, phase, taskId, completed,
        });
        return;
      }
      journeyDedupe.set(dedupeKey, now);

      const { error } = await supabase.from("journey_progress").upsert(
        {
          user_id: userId,
          phase,
          task_id: taskId,
          completed,
          completed_at: new Date().toISOString(),
        },
        { onConflict: "user_id,phase,task_id" }
      );
      if (error) {
        log.error("upsertTask", `Failed to upsert task "${taskId}" for user ${userId}: ${error.message}`, {
          userId,
          phase,
          taskId,
          completed,
          errorCode: error.code,
          errorDetails: error.details,
        }, error);
        throw new Error("Failed to update progress");
      }
      log.info("upsertTask", `Task "${taskId}" completed for user ${userId} in ${phase}`, {
        userId,
        phase,
        taskId,
        completed,
      });
    });
  },
};
