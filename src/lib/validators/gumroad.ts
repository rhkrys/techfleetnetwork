import { z } from "zod";

/**
 * Allowlist for course registration links.
 *
 * WHY THIS EXISTS: `cohorts.registration_url` is free text supplied by
 * teachers, and the Epic 03 public course catalog renders it to ANONYMOUS
 * visitors on an SEO-indexed page. Without an allowlist that turns a
 * teacher-editable field into an open-redirect / phishing surface pointed at
 * from the Tech Fleet domain. The 2026-08 audit already flagged that a cohort
 * owner can swap `registration_url` to an arbitrary external link mid-review
 * (docs/architecture/audit-2026-08/findings.md).
 *
 * WHY NOT A WILDCARD `*.gumroad.com`: Gumroad subdomains are per-creator, so
 * an attacker can register their own store and get a legitimate
 * `evil.gumroad.com`. A wildcard would happily admit it. The allowlist names
 * Tech Fleet's own store host explicitly instead.
 *
 * WHY `new URL()` AND NOT A REGEX: host matching by regex is routinely
 * bypassable — `https://techfleet.gumroad.com.evil.com/`,
 * `https://techfleet.gumroad.com@evil.com/`. Parsing and comparing
 * `url.hostname` defeats both, because the parser resolves the real host.
 */
export const GUMROAD_ALLOWED_HOSTS: readonly string[] = [
  "techfleet.gumroad.com",
];

export function isAllowedGumroadUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }

  // https only — no http, and certainly no javascript:/data:.
  if (url.protocol !== "https:") return false;

  // Reject embedded credentials outright. `hostname` already resolves
  // `https://techfleet.gumroad.com@evil.com` to `evil.com` so the host check
  // below would catch it, but a URL carrying userinfo is never legitimate here
  // and rejecting it explicitly keeps the intent obvious.
  if (url.username !== "" || url.password !== "") return false;

  // `hostname` is normalized (lowercased, punycoded) by the URL parser, and
  // excludes any port. Exact match against the allowlist — no suffix matching.
  return GUMROAD_ALLOWED_HOSTS.includes(url.hostname);
}

/**
 * Zod schema for a required course registration link.
 * Kept separate from `safeUrlSchema` because that helper deliberately coerces
 * scheme-less input to https and permits any host; registration links must be
 * strictly one of ours.
 */
export const gumroadUrlSchema = (label: string, max = 500) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be under ${max} characters`)
    .refine(
      isAllowedGumroadUrl,
      `${label} must be a link to ${GUMROAD_ALLOWED_HOSTS.join(" or ")} (https)`,
    );

/** Optional variant — empty string / null / undefined are allowed. */
export const optionalGumroadUrlSchema = (label: string, max = 500) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (typeof v === "string" ? v.trim() : ""))
    .refine(
      (v) => v === "" || (v.length <= max && isAllowedGumroadUrl(v)),
      `${label} must be a link to ${GUMROAD_ALLOWED_HOSTS.join(" or ")} (https)`,
    );
