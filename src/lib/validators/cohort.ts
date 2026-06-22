import { z } from "zod";
import {
  safeHtmlSchema,
  safeRequiredTextSchema,
  safeShortTextSchema,
  safeUrlSchema,
} from "@/lib/validators/shared-input";

export const COHORT_STATUSES = ["draft", "pending_review", "published", "archived", "cancelled"] as const;
export type CohortStatus = (typeof COHORT_STATUSES)[number];

const dateSchema = z
  .string()
  .min(1, "Date is required")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

export const cohortFormSchema = z
  .object({
    label: safeRequiredTextSchema("Cohort label", 80),
    start_date: dateSchema,
    end_date: dateSchema,
    registration_url: z
      .string()
      .trim()
      .min(1, "Registration URL is required")
      .max(500, "Registration URL must be under 500 characters")
      .refine((v) => /^https:\/\/.+/i.test(v), "Registration URL must start with https://"),
    meeting_url: safeUrlSchema("Meeting URL", 500).optional().default(""),
    timezone: safeShortTextSchema("Timezone", 80).default("America/New_York"),
    capacity: z
      .union([z.coerce.number().int().min(1).max(10_000), z.literal("").transform(() => null), z.null()])
      .optional()
      .nullable(),
    // New optional rich-text section (CLASS-EDIT-EXT-004).
    // Sanitized again at the DB layer by sanitize_cohorts_html trigger.
    schedule: safeHtmlSchema("Schedule of Classes", 50_000).default(""),
  })
  .refine((d) => Date.parse(d.end_date) >= Date.parse(d.start_date), {
    message: "End date must be on or after start date",
    path: ["end_date"],
  });

export type CohortFormValues = z.infer<typeof cohortFormSchema>;
