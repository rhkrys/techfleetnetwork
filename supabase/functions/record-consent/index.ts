// @edge-auth required
import { withAuditWrapper } from "../_shared/audit.ts";
/**
 * record-consent — writes a row to public.cookie_consents whether or not the
 * caller is authenticated. Uses service role; the row is tied to either the
 * authenticated user or an anon_id provided by the client.
 *
 * Body:
 *   {
 *     anon_id: string,
 *     categories: { strictly_necessary, functional, analytics, marketing },
 *     gpc_signal: boolean,
 *     policy_version: string,
 *     source: "banner" | "settings" | "gpc"
 *   }
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(withAuditWrapper("record-consent", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const anon_id = typeof body.anon_id === "string" ? body.anon_id.slice(0, 80) : null;
  const categories = body.categories && typeof body.categories === "object" ? body.categories : null;
  const policy_version = typeof body.policy_version === "string" ? body.policy_version.slice(0, 64) : null;
  const gpc_signal = Boolean(body.gpc_signal);
  const source = typeof body.source === "string" ? body.source.slice(0, 32) : "banner";
  if (!categories || !policy_version || !anon_id) {
    return json({ error: "missing_fields" }, 400);
  }

  const country =
    req.headers.get("cf-ipcountry") ||
    req.headers.get("x-vercel-ip-country") ||
    null;
  const ua = (req.headers.get("user-agent") || "").slice(0, 256);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Optional: associate with logged-in user if a valid JWT was sent
  let user_id: string | null = null;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const { data } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    user_id = data.user?.id ?? null;
  }

  // Server-side dedupe: if the newest stored row for this identifier already
  // matches the incoming categories + GPC signal, skip the INSERT entirely.
  // Prevents per-page-load rewrites from saturating Postgres.
  try {
    const incomingFp = JSON.stringify({
      c: categories,
      g: gpc_signal ? 1 : 0,
      v: policy_version,
    });
    const lookup = user_id
      ? admin.from("cookie_consents").select("categories,gpc_signal,policy_version").eq("user_id", user_id)
      : admin.from("cookie_consents").select("categories,gpc_signal,policy_version").eq("anon_id", anon_id);
    const { data: latest } = await lookup
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest) {
      const latestFp = JSON.stringify({
        c: latest.categories,
        g: latest.gpc_signal ? 1 : 0,
        v: latest.policy_version,
      });
      if (latestFp === incomingFp) return json({ ok: true, deduped: true });
    }
  } catch {
    /* fall through to insert — dedupe is best-effort */
  }

  const { error } = await admin.from("cookie_consents").insert({
    user_id,
    anon_id,
    ip_country: country,
    gpc_signal,
    categories,
    policy_version,
    user_agent: ua,
    source,
  });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}));
