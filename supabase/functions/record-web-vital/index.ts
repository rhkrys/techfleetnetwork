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
import { BodyTooLargeError, readBoundedText } from "../_shared/bounded-body.ts";
import { enforceEdgeRateLimit } from "../_shared/edge-rate-limit.ts";

// T-H: the beacon fires with credentials:"omit" (no cookies), so we do NOT need
// (and must not use) reflect-Origin + Allow-Credentials:true — that combination
// is the CORS anti-pattern the audit flagged. Echo only allow-listed origins and
// never send Allow-Credentials.
const ALLOWED_ORIGINS = new Set([
  "https://techfleetnetwork.lovable.app",
  "https://www.techfleet.network",
  "https://techfleet.network",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);
function corsFor(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://www.techfleet.network";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
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

Deno.serve(
  withAuditWrapper("record-web-vital", async (req) => {
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

    // T-H: per-IP throttle — an unauth service-role INSERT of up to 50 rows/req
    // with no cap is a write-amplification DoS. Silently drop (204) over the cap.
    const rl = await enforceEdgeRateLimit(req, { action: "web_vital", max: 120, windowMinutes: 1 });
    if (!rl.allowed) return new Response(null, { status: 204, headers: cors });

    try {
      // Beacons are text/plain (CORS-safelisted, no preflight). Bound the read
      // WHILE streaming — do not trust Content-Length.
      let raw: string;
      try {
        raw = await readBoundedText(req, 64 * 1024);
      } catch {
        // BodyTooLargeError or a read error — drop the beacon quietly.
        return new Response(null, { status: 204, headers: cors });
      }
      let body: Record<string, unknown> = {};
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        return new Response(null, { status: 204, headers: cors });
      }

      // Accept either a single sample (legacy single-row beacon) or a batch
      // `{samples: [...]}` so the client can collapse 5+ vitals per page into
      // one POST + one multi-row INSERT (DB pool relief).
      const rawSamples: Array<Record<string, unknown>> = Array.isArray(
        (body as { samples?: unknown }).samples
      )
        ? ((body as { samples: unknown[] }).samples as Array<Record<string, unknown>>)
        : [body];

      if (rawSamples.length === 0 || rawSamples.length > 50) {
        return new Response(null, { status: 204, headers: cors });
      }

      const user_agent = clampStr(req.headers.get("user-agent"), 512);

      type Row = {
        user_id: string | null;
        metric_name: string;
        value: number;
        rating: string;
        route: string;
        navigation_type: string | null;
        connection_type: string | null;
        save_data: boolean | null;
        device_memory: number | null;
        viewport_w: number | null;
        viewport_h: number | null;
        user_agent: string | null;
        browser_name: string | null;
        browser_major: number | null;
        os_name: string | null;
        os_major: number | null;
        device_type: string | null;
      };

      const rows: Row[] = [];
      for (const s of rawSamples) {
        const metric_name = clampStr(s.name, 8);
        const rating = clampStr(s.rating, 32);
        const route = normaliseRoute(s.route);
        const value = clampNum(s.value, 0, 600_000);
        if (
          !metric_name ||
          !ALLOWED_METRICS.has(metric_name) ||
          !rating ||
          !ALLOWED_RATINGS.has(rating) ||
          !route ||
          value === null
        )
          continue;

        const navType = clampStr(s.navigationType, 32);
        const rawDeviceType = clampStr(s.deviceType, 16);
        const rawUserId = clampStr(s.userId, 64);
        const user_id =
          rawUserId &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawUserId)
            ? rawUserId.toLowerCase()
            : null;

        rows.push({
          user_id,
          metric_name,
          value,
          rating,
          route,
          navigation_type: navType && ALLOWED_NAV_TYPES.has(navType) ? navType : null,
          connection_type: clampStr(s.connectionType, 32),
          save_data: typeof s.saveData === "boolean" ? s.saveData : null,
          device_memory: clampNum(s.deviceMemory, 0, 1024),
          viewport_w: clampInt(s.viewportW, 0, 16_384),
          viewport_h: clampInt(s.viewportH, 0, 16_384),
          user_agent,
          browser_name: clampStr(s.browserName, 32),
          browser_major: clampInt(s.browserMajor, 0, 9999),
          os_name: clampStr(s.osName, 32),
          os_major: clampInt(s.osMajor, 0, 9999),
          device_type:
            rawDeviceType && ALLOWED_DEVICE_TYPES.has(rawDeviceType) ? rawDeviceType : null,
        });
      }

      if (rows.length === 0) {
        return new Response(null, { status: 204, headers: cors });
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } }
      );

      // Single multi-row insert — one round-trip, one connection acquire.
      await supabase.from("web_vital_samples").insert(rows);

      return new Response(null, { status: 204, headers: cors });
    } catch (err) {
      if (err instanceof Response) return err;
      console.error("[record-web-vital] error", (err as Error)?.message);
      return new Response(null, { status: 204, headers: cors });
    }
  })
);
