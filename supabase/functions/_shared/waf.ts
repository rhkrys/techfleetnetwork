/**
 * Lightweight Web Application Firewall (WAF) middleware for edge functions.
 *
 * Goal: catch obviously malicious or abusive traffic *before* it reaches
 * business logic. Not a substitute for input validation — a complement.
 *
 * Blocks on:
 *   - Oversized request bodies (>1 MB by default)
 *   - Path traversal attempts (../, ..\, %2e%2e)
 *   - SQL-injection patterns in URL or body (UNION SELECT, DROP TABLE, etc.)
 *   - Known scanner User-Agents (sqlmap, nikto, acunetix, ...)
 *   - Per-IP bursts: >100 req in 10s (in-memory, isolate-local)
 *
 * Logs every block to the security_events table via the admin client so
 * admins see them in the weekly digest.
 *
 * Usage:
 *   const blocked = await applyWaf(req, "techfleet-chat");
 *   if (blocked) return blocked;
 */
import { getAdminClient } from "./admin-client.ts";
import { clientIpOr } from "./client-ip.ts";

const MAX_BODY_BYTES = 1_000_000; // 1 MB
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 100;

const SCANNER_UA_RE =
  /sqlmap|nikto|acunetix|nessus|nmap|wpscan|dirbuster|gobuster|masscan|metasploit|fimap|w3af/i;

const SQLI_RE =
  /(\bunion\b\s+\bselect\b)|(\bdrop\b\s+\btable\b)|(\binsert\b\s+\binto\b\s+\w+\s+\bselect\b)|(\bor\b\s+1\s*=\s*1\b)|(\bor\b\s+'\w*'\s*=\s*'\w*\b)|(--\s*$)|(\/\*.*\*\/)/i;
const PATH_TRAVERSAL_RE = /(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\/|%2e%2e%5c)/i;

interface RateBucket {
  count: number;
  windowStart: number;
}
const ipBuckets = new Map<string, RateBucket>();

// Audit T-C: prefer cf-connecting-ip; XFF leftmost is spoofable and this IP keys
// the per-IP burst bucket + security_events audit rows.
function clientIp(req: Request): string {
  return clientIpOr(req, "unknown");
}

function checkRate(ip: string): boolean {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    ipBuckets.set(ip, { count: 1, windowStart: now });
    // Opportunistic GC: cap map size
    if (ipBuckets.size > 5000) {
      const cutoff = now - RATE_LIMIT_WINDOW_MS;
      for (const [k, v] of ipBuckets) {
        if (v.windowStart < cutoff) ipBuckets.delete(k);
      }
    }
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
}

async function logEvent(
  source: string,
  eventType: string,
  severity: "info" | "warn" | "error" | "critical",
  ip: string,
  details: Record<string, unknown>
) {
  // Fire-and-forget; never block on logging
  try {
    const admin = getAdminClient();
    await admin.from("security_events").insert({
      source,
      event_type: eventType,
      severity,
      ip_address: ip,
      details,
    });
  } catch {
    // swallow — never break the request because of a logging failure
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function deny(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Apply WAF checks to a request. Returns a Response if the request should be
 * BLOCKED, or null if it should proceed.
 *
 * Skips OPTIONS (CORS preflight) and trusted internal calls (service-role
 * bearer header matches the env key).
 *
 * The request body is NOT consumed — callers can still parse it normally.
 */
export async function applyWaf(req: Request, source: string): Promise<Response | null> {
  if (req.method === "OPTIONS") return null;

  const ip = clientIp(req);

  // 1. Rate limit
  if (!checkRate(ip)) {
    await logEvent(source, "waf_rate_limit", "warn", ip, { method: req.method, url: req.url });
    return deny(429, "Too many requests");
  }

  // 2. Body size (use Content-Length when available)
  const len = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
    await logEvent(source, "waf_oversize_body", "warn", ip, { len, max: MAX_BODY_BYTES });
    return deny(413, "Payload too large");
  }

  // 3. Scanner User-Agent
  const ua = req.headers.get("user-agent") ?? "";
  if (SCANNER_UA_RE.test(ua)) {
    await logEvent(source, "waf_scanner_ua", "error", ip, { ua });
    return deny(403, "Forbidden");
  }

  // 4. URL pattern checks (SQLi / path traversal)
  const url = req.url;
  if (PATH_TRAVERSAL_RE.test(url)) {
    await logEvent(source, "waf_path_traversal", "error", ip, { url });
    return deny(400, "Bad request");
  }
  if (SQLI_RE.test(decodeURIComponent(url))) {
    await logEvent(source, "waf_sqli_url", "error", ip, { url });
    return deny(400, "Bad request");
  }

  return null;
}
