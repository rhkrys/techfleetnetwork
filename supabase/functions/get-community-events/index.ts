// @edge-cron
/**
 * get-community-events
 *
 * Reads the pre-parsed events from `community_events_cache` (populated by
 * `refresh-community-events` every 10 min). Sub-50ms cold, sub-5ms warm.
 *
 * Public on purpose — the underlying Google Calendar is already public.
 * We still apply WAF and per-IP rate limiting.
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { z } from "npm:zod@3.23.8";
import { applyWaf } from "../_shared/waf.ts";
import { withAuditWrapper } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const QuerySchema = z
  .object({
    windowDays: z.coerce.number().int().min(1).max(400).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .refine((v) => (v.from && v.to) || (!v.from && !v.to), {
    message: "from and to must be provided together",
  })
  .refine(
    (v) => {
      if (!v.from || !v.to) return true;
      const ms = Date.parse(v.to) - Date.parse(v.from);
      return ms > 0 && ms <= 14 * 24 * 60 * 60 * 1000;
    },
    { message: "from/to span must be 1-14 days" }
  );

const MEET_BOILERPLATE_RE =
  /\n*\s*Learn more about Meet at:?\s*https?:\/\/support\.google\.com\/a\/users\/answer\/9282720\s*\n*/gi;

function cleanDescription(desc: string): string {
  if (!desc) return "";
  return desc
    .replace(MEET_BOILERPLATE_RE, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface CachedEvent {
  uid: string;
  title: string;
  startUtc: string;
  endUtc: string;
  allDay: boolean;
  description: string;
  location: string;
  url: string;
  organizerEmail: string;
}

// L1 in-memory cache: serves identical edge-instance hits in <1ms.
let memo: { at: number; events: CachedEvent[] } | null = null;
const MEMO_TTL_MS = 60 * 1000;

// Per-IP rate limit (60 req / hour).
const RL_WINDOW_MS = 60 * 60 * 1000;
const RL_LIMIT = 60;
const rl = new Map<string, { count: number; reset: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rl.get(ip);
  if (!entry || entry.reset < now) {
    rl.set(ip, { count: 1, reset: now + RL_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RL_LIMIT;
}

async function readCache(): Promise<CachedEvent[]> {
  if (memo && Date.now() - memo.at < MEMO_TTL_MS) return memo.events;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data, error } = await supabase
    .from("community_events_cache")
    .select("events")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  const events = (data?.events ?? []) as CachedEvent[];
  memo = { at: Date.now(), events };
  return events;
}

Deno.serve(
  withAuditWrapper("get-community-events", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const blocked = await applyWaf(req, "get-community-events");
    if (blocked) return blocked;

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (rateLimited(ip)) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse({
      windowDays: url.searchParams.get("windowDays") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const all = await readCache();
      // Server-side floor: never serve anything that started more than 1 day ago,
      // regardless of what the caller asks for. Defense-in-depth so a stale cache
      // or buggy expansion can never leak ancient events to the UI.
      const HARD_FLOOR_MS = Date.now() - 24 * 60 * 60 * 1000;
      let rangeStart: number;
      let rangeEnd: number;
      if (parsed.data.from && parsed.data.to) {
        rangeStart = Math.max(Date.parse(parsed.data.from), HARD_FLOOR_MS);
        rangeEnd = Date.parse(parsed.data.to);
      } else {
        rangeStart = Date.now();
        rangeEnd = rangeStart + (parsed.data.windowDays ?? 60) * 24 * 60 * 60 * 1000;
      }
      if (rangeEnd < rangeStart) rangeEnd = rangeStart;
      const events = all
        .filter((e) => {
          const start = Date.parse(e.startUtc);
          const end = Date.parse(e.endUtc);
          if (start < HARD_FLOOR_MS) return false; // hard guard
          return end >= rangeStart && start <= rangeEnd;
        })
        .map((e) => ({ ...e, description: cleanDescription(e.description) }));

      return new Response(JSON.stringify({ events }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
        },
      });
    } catch (err) {
      console.error("get-community-events error:", err);
      return new Response(JSON.stringify({ error: "Failed to load events" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  })
);
