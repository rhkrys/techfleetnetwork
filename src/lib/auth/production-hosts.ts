/**
 * Canonical production hostnames for Tech Fleet Network (client-side).
 * Used by Turnstile site-key selection, redirect guards, and any place
 * that needs to know whether the current host is "real" production.
 *
 * Edge functions have a parallel copy at
 * `supabase/functions/_shared/auth-hosts.ts`. Keep them in sync.
 */
export const PRODUCTION_HOSTNAMES: ReadonlySet<string> = new Set([
  "techfleetnetwork.lovable.app",
  "www.techfleet.network",
  "techfleet.network",
]);

export function isProductionHostname(host: string | null | undefined): boolean {
  if (!host) return false;
  return PRODUCTION_HOSTNAMES.has(host.toLowerCase());
}

const warned = new Set<string>();

/**
 * Warn once per unique non-prod / non-lovable hostname so future drift
 * (custom domains, accidental subdomains) is visible in console.
 */
export function warnOnUnknownAuthHost(host: string): void {
  if (typeof window === "undefined") return;
  const h = host.toLowerCase();
  if (isProductionHostname(h)) return;
  if (h === "localhost" || h.endsWith(".lovable.app") || h.endsWith(".lovableproject.com")) return;
  if (warned.has(h)) return;
  warned.add(h);
  // eslint-disable-next-line no-console
  console.warn(`[auth] Unknown hostname "${h}" — Turnstile will use the test site key.`);
}
