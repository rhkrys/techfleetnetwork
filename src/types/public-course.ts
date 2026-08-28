/**
 * Public course catalog types.
 *
 * Mirrors the serializer contract in
 * supabase/functions/_shared/public-class.ts. Intentionally has NO field for
 * `discount_registration_url`, `capacity`, or `meeting_url`: the public
 * endpoint never returns them, and leaving them out of the type keeps a UI
 * component from being written against data it will never receive.
 */
export interface PublicCohort {
  id: string;
  label: string | null;
  start_date: string | null;
  end_date: string | null;
  timezone: string | null;
  /** null when the stored link is not on the registration allowlist. */
  registration_url: string | null;
}

export interface PublicClass {
  id: string;
  slug: string | null;
  title: string | null;
  summary: string | null;
  description: string | null;
  track: string | null;
  hero_image_url: string | null;
  outcomes: string[] | null;
  skills: string[] | null;
  prerequisites: string[] | null;
  published_at: string | null;
  cohorts: PublicCohort[];
}
