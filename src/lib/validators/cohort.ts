import { z } from "zod";
import {
  safeHtmlSchema,
  safeRequiredTextSchema,
  safeShortTextSchema,
  safeUrlSchema,
} from "@/lib/validators/shared-input";
import { gumroadUrlSchema, optionalGumroadUrlSchema } from "@/lib/validators/gumroad";

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
    // Allowlisted to the Tech Fleet Gumroad store. This link is rendered to
    // ANONYMOUS visitors on the public course catalog, so an arbitrary
    // teacher-supplied URL here would be an open-redirect / phishing surface
    // pointed at from our own domain. See src/lib/validators/gumroad.ts.
    registration_url: gumroadUrlSchema("Registration URL", 500),
    // Member-only link (base URL + discount code). Never served publicly —
    // `discount_registration_url` is revoked from the anon role at the column
    // level (migration 20260828180000).
    discount_registration_url: optionalGumroadUrlSchema("Member discount URL", 500).optional().default(""),
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
