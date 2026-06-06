// @edge-auth
import { withAuditWrapper } from "../_shared/audit.ts";
/**
 * record-web-vital — RUM beacon ingestion endpoint.
 *
 * Receives Core Web Vitals samples (LCP, INP, CLS, FCP, TTFB, FID) from
 * `src/lib/web-vitals.ts` via `navigator.sendBeacon`. Public (verify_jwt=false)
 * because beacons fire after page hide for anonymous and authenticated users
 * alike — the auth token isn't reliably available on unload.
 *
 * Hardening:
 *  - Strict allow-list on `metric_name` and `rating`.
 *  - Numeric bounds: value 0..600000 ms; viewport 0..16384.
 *  - Route is normalised (path-only, no query/fragment, max 256 chars).
 *  - User agent capped at 512 chars to prevent log poisoning.
 *  - 16KB body cap inherited from `parseJsonBody`.
 *  - Service role used for insert (RLS denies public writes by design).
 *  - No PII captured. user_id is opt-in via the optional `userId` field, only
 *    set by the client when a session exists.
 *  - Best-effort: failures are swallowed with a 204 so beacons never spam
 *    error toasts in the user's browser.
 */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Note: _shared/http helpers intentionally not used — this endpoint needs
// origin-reflecting CORS to support credentialed sendBeacon requests.

// Origin-reflecting CORS — sendBeacon includes credentials (cookies), so the
// browser rejects "Access-Control-Allow-Origin: *". We must echo the request
// Origin and set Allow-Credentials accordingly.
function corsFor(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

const ALLOWED_METRICS = new Set(["LCP", "INP", "CLS", "FCP", "TTFB", "FID"]);
const ALLOWED_RATINGS = new Set(["good", "needs-improvement", "poor"]);
const ALLOWED_NAV_TYPES = new Set([
  "navigate",
  "reload",
  "back-forward",
  "back-forward-cache",
  "prerender",
  "restore",
]);
const ALLOWED_DEVICE_TYPES = new Set(["desktop", "mobile", "tablet", "bot", "unknown"]);

function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function clampInt(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < min || i > max) return null;
  return i;
}

function clampNum(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function normaliseRoute(raw: unknown): string | null {
  const s = clampStr(raw, 1024);
  if (!s) return null;
  // Path-only — strip query string + fragment to keep cardinality bounded.
  const path = s.split("?")[0].split("#")[0];
  return path.length > 256 ? path.slice(0, 256) : path || "/";
}

Deno.serve(withAuditWrapper("record-web-vital", async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    // Beacons are sent as text/plain (CORS-safelisted, no preflight).
    // Parse manually instead of using parseJsonBody (which enforces
    // Content-Type: application/json).
    const raw = await req.text();
    if (raw.length > 16 * 1024) {
      return new Response(null, { status: 204, headers: cors });
    }
    let body: Record<string, unknown> = {};
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      return new Response(null, { status: 204, headers: cors });
    }
    const metric_name = clampStr(body.name, 8);
    const rating = clampStr(body.rating, 32);
    const route = normaliseRoute(body.route);
    const value = clampNum(body.value, 0, 600_000);

    if (
      !metric_name ||
      !ALLOWED_METRICS.has(metric_name) ||
      !rating ||
      !ALLOWED_RATINGS.has(rating) ||
      !route ||
      value === null
    ) {
      // Always 204 so the browser doesn't surface beacon errors to users.
      return new Response(null, { status: 204, headers: cors });
    }

    const navType = clampStr(body.navigationType, 32);
    const navigation_type = navType && ALLOWED_NAV_TYPES.has(navType) ? navType : null;
    const connection_type = clampStr(body.connectionType, 32);
    const save_data = typeof body.saveData === "boolean" ? body.saveData : null;
    const device_memory = clampNum(body.deviceMemory, 0, 1024);
    const viewport_w = clampInt(body.viewportW, 0, 16_384);
    const viewport_h = clampInt(body.viewportH, 0, 16_384);
    const user_agent = clampStr(req.headers.get("user-agent"), 512);

    // Validate user_id format (uuid) without trusting the client to mean it.
    let user_id: string | null = null;
    const rawUserId = clampStr(body.userId, 64);
    if (rawUserId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawUserId)) {
      user_id = rawUserId.toLowerCase();
    }

    // Browser/OS/device breakdown — Track 4 RUM browser breakdown.
    const browser_name = clampStr(body.browserName, 32);
    const browser_major = clampInt(body.browserMajor, 0, 9999);
    const os_name = clampStr(body.osName, 32);
    const os_major = clampInt(body.osMajor, 0, 9999);
    const rawDeviceType = clampStr(body.deviceType, 16);
    const device_type = rawDeviceType && ALLOWED_DEVICE_TYPES.has(rawDeviceType) ? rawDeviceType : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Best-effort insert — never block beacon caller.
    await supabase.from("web_vital_samples").insert({
      user_id,
      metric_name,
      value,
      rating,
      route,
      navigation_type,
      connection_type,
      save_data,
      device_memory,
      viewport_w,
      viewport_h,
      user_agent,
      browser_name,
      browser_major,
      os_name,
      os_major,
      device_type,
    });

    return new Response(null, { status: 204, headers: cors });
  } catch (err) {
    if (err instanceof Response) return err;
    // Swallow errors — RUM must never surface to users.
    console.error("[record-web-vital] error", (err as Error)?.message);
    return new Response(null, { status: 204, headers: cors });
  }
}));
