/**
 * Boot-time host canonicalization.
 *
 * The auth surface (and the Lovable OAuth broker) only behaves on the
 * `www.techfleet.network` host. Loading any page on the apex
 * `techfleet.network` host produced an apex↔www Google sign-in loop
 * because click-time restart + cross-origin sessionStorage have no shared
 * memory.
 *
 * `enforceCanonicalHost()` runs ONCE, synchronously, before React mounts
 * and before any auth code reads `window.location`. If we're on the apex
 * it immediately replaces the URL with the www equivalent (preserving
 * path/query/hash, including any in-flight `#access_token=…`) and throws
 * to halt the rest of boot — no React mount, no flash of `/login`, no
 * loop.
 *
 * BDD: AUTH-OAUTH-APEX-CANONICAL-003
 */

const APEX_HOST = "techfleet.network";
const CANONICAL_ORIGIN = "https://www.techfleet.network";

export interface CanonicalDecision {
  shouldRedirect: boolean;
  target?: string;
}

export function decideCanonicalRedirect(loc: {
  host: string;
  pathname: string;
  search: string;
  hash: string;
}): CanonicalDecision {
  const host = (loc.host ?? "").toLowerCase();
  if (host !== APEX_HOST) return { shouldRedirect: false };
  // The OAuth broker worker handles its own paths — never intercept.
  if (loc.pathname.startsWith("/~oauth")) return { shouldRedirect: false };
  return {
    shouldRedirect: true,
    target: `${CANONICAL_ORIGIN}${loc.pathname}${loc.search}${loc.hash}`,
  };
}

export function enforceCanonicalHost(): void {
  if (typeof window === "undefined") return;
  const decision = decideCanonicalRedirect(window.location);
  if (!decision.shouldRedirect || !decision.target) return;
  window.location.replace(decision.target);
  // Halt the rest of module evaluation so React never mounts on apex.
  throw new Error("__tfn_canonical_host_redirect__");
}
