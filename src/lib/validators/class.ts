import { z } from "zod";
import {
  safeHtmlSchema,
  safeRequiredTextSchema,
  safeStringArraySchema,
  safeUrlSchema,
} from "@/lib/validators/shared-input";

export const CLASS_TRACKS = ["basic_training", "advanced_training"] as const;
export type ClassTrack = (typeof CLASS_TRACKS)[number];

export const CLASS_STATUSES = ["draft", "pending_review", "published", "archived"] as const;
export type ClassStatus = (typeof CLASS_STATUSES)[number];

export const classFormSchema = z.object({
  title: safeRequiredTextSchema("Title", 120),
  summary: safeHtmlSchema("Summary", 10_000).default(""),
  description: safeHtmlSchema("Description", 50_000).default(""),
  track: z.union([z.literal("basic_training"), z.literal("advanced_training")], {
    message: "Track is required",
  }),
  hero_image_url: safeUrlSchema("Hero image URL", 500).optional().default(""),
  skills: safeStringArraySchema("Skills", 50, 120).default([]),
  outcomes: safeHtmlSchema("Outcomes", 20_000).default(""),
  why_take: safeHtmlSchema("Why take this course?", 20_000).default(""),
  audiences: safeHtmlSchema("Audiences", 20_000).default(""),
  prerequisites: safeStringArraySchema("Prerequisites", 30, 200).default([]),
  // New optional rich-text sections (CLASS-EDIT-EXT-001).
  // Sanitized again at the DB layer by sanitize_classes_html trigger.
  curriculum: safeHtmlSchema("Curriculum", 50_000).default(""),
  reading_assignments: safeHtmlSchema("Reading Assignments", 20_000).default(""),
  class_expectations: safeHtmlSchema("Class Expectations", 20_000).default(""),
});

export type ClassFormValues = z.infer<typeof classFormSchema>;
