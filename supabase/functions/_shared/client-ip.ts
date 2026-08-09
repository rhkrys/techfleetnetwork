// Audit T-C: `X-Forwarded-For` is client-controllable — its leftmost entry can
// be spoofed to defeat per-IP rate limits and forge audit-trail IPs. Behind
// Cloudflare, `cf-connecting-ip` is set by the edge and is the trustworthy
// client IP. Prefer it; fall back to the LAST XFF hop (appended by the nearest
// trusted proxy, so least attacker-controllable) only when it's absent, and
// treat that fallback as best-effort.
export function clientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf && cf.trim()) return cf.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    if (hops.length) return hops[hops.length - 1]; // last hop, not leftmost
  }

  const xri = req.headers.get("x-real-ip");
  return xri && xri.trim() ? xri.trim() : null;
}

/** Non-null variant for callers that key a bucket and want a stable fallback. */
export function clientIpOr(req: Request, fallback = "unknown"): string {
  return clientIp(req) ?? fallback;
}
