// @edge-auth
import { createClient } from "npm:@supabase/supabase-js@2";

import { withAuditWrapper } from "../_shared/audit.ts";
/**
 * SECURITY: This endpoint exposes Airtable schema and field names. It must
 * NEVER be reachable without admin auth. Originally deployed without auth —
 * fixed 2026-04-18 audit.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(withAuditWrapper("airtable-diag", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ── JWT + admin check ──────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: roleRow } = await adminClient
    .from("user_roles")
    .select("id")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (!roleRow) {
    return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // ── End auth ──────────────────────────────────────────────────────

  const PAT = Deno.env.get("AIRTABLE_PAT") ?? "";
  const BASE_ID = Deno.env.get("AIRTABLE_BASE_ID") ?? "";
  const results: Record<string, unknown> = {};

  if (!PAT || !BASE_ID) {
    return new Response(JSON.stringify({ error: "Airtable credentials not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const r = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`, {
      headers: { Authorization: `Bearer ${PAT}` },
    });
    const body = await r.text();
    results.schema_status = r.status;
    if (r.ok) {
      const parsed = JSON.parse(body);
      results.table_names = parsed.tables?.map((t: { name: string; id: string }) => ({
        name: t.name,
        id: t.id,
      }));
    } else {
      results.schema_body = body.slice(0, 500);
    }
  } catch (e) {
    results.schema_error = String(e);
  }

  try {
    const table = encodeURIComponent("Masterclass Registeration");
    const url = `https://api.airtable.com/v0/${BASE_ID}/${table}?maxRecords=1`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
    if (r.ok) {
      const body = await r.json();
      const fields = body.records?.[0]?.fields ?? {};
      results.sample_field_names = Object.keys(fields);
    } else {
      results.sample_status = r.status;
    }
  } catch (e) {
    results.sample_error = String(e);
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}));
