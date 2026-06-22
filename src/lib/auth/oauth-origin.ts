/**
 * OAuth origin canonicalization.
 *
 * The Lovable OAuth broker + the upstream Google client treat the apex
 * `techfleet.network` as an unreliable origin — broker bounces it back with
 * `#error=server_error&error_description=failed+to+sign+in+with+vendor`.
 * The `www` host and the `lovable.app` subdomain work fine.
 *
 * Use `getCanonicalOAuthOrigin()` everywhere OAuth is initiated so the
 * apex never reaches the broker.
 *
 * BDD: AUTH-OAUTH-APEX-CANONICAL-001..002
 */

const APEX_HOST = "techfleet.network";
const CANONICAL_ORIGIN = "https://www.techfleet.network";

export function isApexHost(host: string | null | undefined): boolean {
  return (host ?? "").toLowerCase() === APEX_HOST;
}

export function getCanonicalOAuthOrigin(loc: { host: string; origin: string } | null = typeof window === "undefined" ? null : window.location): string {
  if (!loc) return CANONICAL_ORIGIN;
  return isApexHost(loc.host) ? CANONICAL_ORIGIN : loc.origin;
}

export function needsCanonicalRestart(loc: { host: string; origin: string } | null = typeof window === "undefined" ? null : window.location): boolean {
  if (!loc) return false;
  return getCanonicalOAuthOrigin(loc) !== loc.origin;
}
