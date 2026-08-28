/**
 * Serializers for the PUBLIC (anonymous) course catalog.
 *
 * Pure TypeScript on purpose: no Deno globals, no npm: imports. The edge
 * function imports this at runtime, and src/test/edge/public-class-serializer.test.ts
 * imports this SAME file under vitest, so the allowlist below is actually
 * executed by the test suite instead of being asserted only in review.
 *
 * THE RULE: output is built by EXPLICIT CONSTRUCTION, never by spreading the
 * database row. `{ ...row }` would republish every column the table gains in
 * future — and the `Public can view published classes` RLS policy is
 * column-blind, so new columns are anon-readable by default. Explicit
 * construction means a new column is private until someone adds it here on
 * purpose.
 */

/** Hosts permitted for a publicly rendered registration link. */
export const PUBLIC_REGISTRATION_HOSTS: readonly string[] = ["techfleet.gumroad.com"];

/**
 * Mirrors src/lib/validators/gumroad.ts. Duplicated across the runtime
 * boundary because Deno edge functions cannot import from src/ — the same
 * reason _shared/escape-html.ts exists alongside the frontend's sanitizer.
 * Both are covered by tests that assert identical bypass cases.
 */
export function isPublishableRegistrationUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  return PUBLIC_REGISTRATION_HOSTS.includes(url.hostname);
}

export interface PublicCohort {
  id: string;
  label: string | null;
  start_date: string | null;
  end_date: string | null;
  timezone: string | null;
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
  outcomes: unknown;
  skills: unknown;
  prerequisites: unknown;
  published_at: string | null;
  cohorts: PublicCohort[];
}

/**
 * Fields deliberately NOT published, each for a stated reason:
 *   capacity                  - operational. Also cannot be turned into a
 *                               meaningful open/full state: remaining seats
 *                               would need enrollment counts, and Gumroad owns
 *                               registration. Publishing a raw cap invites a
 *                               false "seats left" reading, so it is omitted
 *                               rather than guessed at.
 *   discount_registration_url - MEMBER-ONLY. Revoked from anon at the column
 *                               level (migration 20260828180000); excluded here
 *                               too so a service-role caller cannot leak it.
 *   meeting_url               - private join link (revoked from anon since
 *                               migration 20260513041024).
 *   status / owner_user_id    - operational.
 */
export function serializePublicCohort(row: Record<string, unknown>): PublicCohort {
  // A registration link is only published if it points at an allowlisted host.
  // This matters because the DB CHECK added in migration 20260828190000 is
  // NOT VALID: historical cohorts may still hold an arbitrary URL, and this is
  // an anonymous, SEO-indexed surface. A non-compliant link is dropped (null)
  // rather than rendered.
  const registrationUrl = isPublishableRegistrationUrl(row.registration_url)
    ? String(row.registration_url).trim()
    : null;

  return {
    id: String(row.id ?? ""),
    label: (row.label as string) ?? null,
    start_date: (row.start_date as string) ?? null,
    end_date: (row.end_date as string) ?? null,
    timezone: (row.timezone as string) ?? null,
    registration_url: registrationUrl,
  };
}

export function serializePublicClass(row: Record<string, unknown>): PublicClass {
  const rawCohorts = Array.isArray(row.cohorts) ? (row.cohorts as Record<string, unknown>[]) : [];

  const cohorts = rawCohorts
    .map(serializePublicCohort)
    .sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""));

  return {
    id: String(row.id ?? ""),
    slug: (row.slug as string) ?? null,
    title: (row.title as string) ?? null,
    summary: (row.summary as string) ?? null,
    description: (row.description as string) ?? null,
    track: (row.track as string) ?? null,
    hero_image_url: (row.hero_image_url as string) ?? null,
    outcomes: row.outcomes ?? [],
    skills: row.skills ?? [],
    prerequisites: row.prerequisites ?? [],
    published_at: (row.published_at as string) ?? null,
    cohorts,
  };
}

/** Envelope version for the public contract. Additive changes keep v=1. */
export const PUBLIC_CATALOG_VERSION = 1;
