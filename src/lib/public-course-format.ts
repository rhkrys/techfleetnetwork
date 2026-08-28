import type { PublicCohort } from "@/types/public-course";

const TRACK_LABELS: Record<string, string> = {
  basic_training: "Basic Training",
  advanced_training: "Advanced Training",
};

export function trackLabel(track: string | null | undefined): string {
  if (!track) return "";
  return TRACK_LABELS[track] ?? track.replace(/_/g, " ");
}

/**
 * Formats a cohort's date range for display.
 * Dates are stored as plain YYYY-MM-DD. They are parsed as UTC and formatted in
 * UTC deliberately: `new Date("2026-03-01")` is midnight UTC, so formatting it
 * in a negative-offset local timezone renders the PREVIOUS day. Pinning to UTC
 * keeps the displayed date equal to the stored date everywhere.
 */
export function formatCohortDates(cohort: Pick<PublicCohort, "start_date" | "end_date">): string {
  const start = formatDate(cohort.start_date);
  const end = formatDate(cohort.end_date);
  if (start && end) return `${start} – ${end}`;
  return start || end || "Dates to be announced";
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
