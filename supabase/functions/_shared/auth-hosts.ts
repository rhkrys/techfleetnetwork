/**
 * Canonical production hostnames for Tech Fleet Network (edge-side).
 * Mirror of `src/lib/auth/production-hosts.ts`. Keep in sync.
 */
export const PRODUCTION_HOSTS: ReadonlySet<string> = new Set([
  "techfleetnetwork.lovable.app",
  "www.techfleet.network",
  "techfleet.network",
]);

export function originHostFromRequest(req: Request): string {
  try {
    const originHeader = req.headers.get("origin") ?? req.headers.get("referer") ?? "";
    if (!originHeader) return "";
    return new URL(originHeader).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isProductionOrigin(host: string): boolean {
  return PRODUCTION_HOSTS.has(host);
}
