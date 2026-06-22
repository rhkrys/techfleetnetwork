import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";
import { reportError } from "@/services/error-reporter.service";
import { emailInputSchema } from "@/lib/validators/auth";
import { safeLongTextSchema } from "@/lib/validators/shared-input";
import { retryPostgrest } from "@/lib/data/transient-retry";
import { retryTransientWrite } from "@/lib/db/retry";
import { z } from "zod";

const log = createLogger("FeedbackService");

export interface Feedback {
  id: string;
  user_id: string;
  user_email: string;
  system_area: string;
  message: string;
  created_at: string;
}

export const FEEDBACK_AREAS = [
  "Accessibility",
  "Activity Log",
  "Alerts",
  "Applications",
  "Courses",
  "Dashboard",
  "Events",
  "Fleety",
  "Preferences",
  "Profile",
  "Project Openings",
  "Projects and Courses",
  "Resources",
  "Surveys",
  "Community Updates",
  "User Admin",
] as const;

export type FeedbackArea = (typeof FEEDBACK_AREAS)[number];

const feedbackSchema = z.object({
  email: emailInputSchema,
  systemArea: z.enum(FEEDBACK_AREAS),
  message: safeLongTextSchema("Feedback", 5000).min(1, "Feedback is required"),
});

export const FeedbackService = {
  async submit(userId: string, email: string, systemArea: string, message: string): Promise<boolean> {
    try {
      const parsed = feedbackSchema.safeParse({ email, systemArea, message });
      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors;
        const summary = `Feedback validation failed: ${JSON.stringify(fieldErrors)}`;
        log.warn("submit.validation", summary, { userId, systemArea });
        // Surface validation rejections to triage so we can see why submissions
        // fail for specific users (e.g. URL/HTML stripped from message).
        reportError(summary, "feedback.submit.validation", {
          userId,
          severity: "warn",
          extraFields: [
            `system_area:${systemArea}`,
            `fields:${Object.keys(fieldErrors).join(",") || "unknown"}`,
          ],
        });
        return false;
      }
      const { error } = await supabase
        .from("feedback")
        .insert({
          user_id: userId,
          user_email: parsed.data.email,
          system_area: parsed.data.systemArea,
          message: parsed.data.message,
        });

      if (error) {
        log.error(
          "submit",
          `Failed to submit feedback: ${error.message} (code: ${error.code})`,
          { userId, systemArea },
          error,
        );
        // Forward to triage queue — RLS denials, network failures, etc.
        reportError(error, "feedback.submit.insert", {
          userId,
          severity: "error",
          extraFields: [
            `system_area:${systemArea}`,
            `pg_code:${error.code ?? "none"}`,
            error.hint ? `pg_hint:${error.hint}` : "pg_hint:none",
          ],
        });
        return false;
      }
      return true;
    } catch (err) {
      log.error(
        "submit",
        `Unexpected error submitting feedback: ${err instanceof Error ? err.message : String(err)}`,
        { userId, systemArea },
        err,
      );
      reportError(err, "feedback.submit", {
        userId,
        severity: "error",
        extraFields: [`system_area:${systemArea}`],
      });
      return false;
    }
  },

  async listAll(): Promise<Feedback[]> {
    const { data, error } = await supabase
      .from("feedback")
      .select("id, user_id, user_email, system_area, message, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      log.error("listAll", `Failed to list feedback: ${error.message}`, {}, error);
      reportError(error, "feedback.listAll", { severity: "error" });
      return [];
    }
    return (data as unknown as Feedback[]) || [];
  },
};
