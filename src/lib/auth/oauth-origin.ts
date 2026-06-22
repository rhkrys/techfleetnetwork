/**
 * OAuth origin pinning (defense-in-depth).
 *
 * The apex→www 301/302 lives at the Lovable hosting edge
 * (AUTH-OAUTH-APEX-EDGE-301-001), so the SPA only ever boots on
 * `www.techfleet.network` in production. `getCanonicalOAuthOrigin()` is
 * kept as a belt-and-braces pin on the OAuth `redirect_uri` in case some
 * future host config regresses; it is otherwise a pass-through.
 *
 * `needsCanonicalRestart()` (client-side restart helper) was removed when
 * the edge redirect landed — see git history.
 *
 * BDD: AUTH-OAUTH-APEX-EDGE-301-001
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
