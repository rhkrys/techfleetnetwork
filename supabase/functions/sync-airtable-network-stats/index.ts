// @edge-public
// Sync Airtable-derived inputs for Network Stats into network_stats_baselines.
// Counts (all-time):
//   1. unique general application submitters from "General Applications"
//   2. unique Service Leadership Masterclass (legacy alias: "Servant Leadership") registrants from "Masterclass Registrations"
//   3. total rows in "Masterclass Registrations"
// Writes results to network_stats_baselines (id=1). On failure, last-known values are preserved.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { withAuditWrapper } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const AIRTABLE_PAT = Deno.env.get("AIRTABLE_PAT") ?? "";
const AIRTABLE_BASE_ID = Deno.env.get("AIRTABLE_BASE_ID") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const GENERAL_APPS_TABLE = "General Applications";
const MASTERCLASS_TABLE = "Masterclass Registrations";

const SERVICE_LEADERSHIP_REGEX = /serv(ice|ant)\s*leadership/i;

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

async function fetchAll(table: string, fields?: string[]): Promise<AirtableRecord[]> {
  const all: AirtableRecord[] = [];
  let offset: string | undefined;
  const params = new URLSearchParams();
  params.set("pageSize", "100");
  if (fields) fields.forEach((f) => params.append("fields[]", f));

  // Exponential backoff for transient 429/5xx
  for (let page = 0; page < 1000; page++) {
    const qp = new URLSearchParams(params);
    if (offset) qp.set("offset", offset);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}?${qp}`;

    let attempt = 0;
    let res: Response | null = null;
    while (attempt < 4) {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
      });
      if (res.ok) break;
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 250 * Math.pow(2, attempt)));
        attempt++;
        continue;
      }
      const body = await res.text();
      throw new Error(`Airtable ${table} failed [${res.status}]: ${body}`);
    }
    if (!res || !res.ok) throw new Error(`Airtable ${table} retry exhausted`);

    const data = (await res.json()) as { records: AirtableRecord[]; offset?: string };
    all.push(...data.records);
    if (!data.offset) return all;
    offset = data.offset;
  }
  return all;
}

function uniqueKey(rec: AirtableRecord, fieldCandidates: string[]): string | null {
  for (const f of fieldCandidates) {
    const v = rec.fields[f];
    if (typeof v === "string" && v.trim()) return v.trim().toLowerCase();
    if (Array.isArray(v) && v.length && typeof v[0] === "string")
      return (v[0] as string).trim().toLowerCase();
  }
  // fallback: stable rec id (won't collapse duplicates but never inflates)
  return rec.id;
}

Deno.serve(
  withAuditWrapper("sync-airtable-network-stats", async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    // Auth: require either service-role bearer OR an authenticated admin user
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const isServiceRole = !!token && token === SERVICE_ROLE;
    const cronSecret = Deno.env.get("NETWORK_STATS_CRON_SECRET") ?? "";
    const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (!isServiceRole && !isCron) {
      if (!token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(token);
      if (userErr || !userRes.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
        _user_id: userRes.user.id,
        _role: "admin",
      });
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
      return new Response(JSON.stringify({ error: "Airtable env not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      // 1. General Applications — unique submitters (by email/name fallback)
      const genApps = await fetchAll(GENERAL_APPS_TABLE);
      const genAppKeys = new Set<string>();
      for (const r of genApps) {
        const k = uniqueKey(r, ["Email", "email", "Applicant Email", "Name", "Full Name"]);
        if (k) genAppKeys.add(k);
      }
      const airtable_general_apps = genAppKeys.size;

      // 2 + 3. Masterclass Registrations — total + unique Service Leadership registrants (legacy alias: "Servant Leadership")
      const mc = await fetchAll(MASTERCLASS_TABLE);
      const airtable_masterclass_total = mc.length;
      const slKeys = new Set<string>();
      for (const r of mc) {
        // Check any text field for service leadership match (regex still matches legacy "servant" rows)
        let matched = false;
        for (const v of Object.values(r.fields)) {
          if (typeof v === "string" && SERVICE_LEADERSHIP_REGEX.test(v)) {
            matched = true;
            break;
          }
          if (Array.isArray(v)) {
            for (const item of v) {
              if (typeof item === "string" && SERVICE_LEADERSHIP_REGEX.test(item)) {
                matched = true;
                break;
              }
            }
            if (matched) break;
          }
        }
        if (!matched) continue;
        const k = uniqueKey(r, [
          "Masterclass Attendee Unique ID",
          "Email",
          "email",
          "Attendee Email",
          "Name",
          "Full Name",
        ]);
        if (k) slKeys.add(k);
      }
      const airtable_service_leadership_unique = slKeys.size;

      // Never regress: keep max(existing, new) so baseline only goes up
      const { data: current } = await supabaseAdmin
        .from("network_stats_baselines")
        .select(
          "airtable_general_apps, airtable_service_leadership_unique, airtable_masterclass_total"
        )
        .eq("id", 1)
        .maybeSingle();

      const next = {
        airtable_general_apps: Math.max(current?.airtable_general_apps ?? 0, airtable_general_apps),
        airtable_service_leadership_unique: Math.max(
          current?.airtable_service_leadership_unique ?? 0,
          airtable_service_leadership_unique
        ),
        airtable_masterclass_total: Math.max(
          current?.airtable_masterclass_total ?? 0,
          airtable_masterclass_total
        ),
        last_synced_at: new Date().toISOString(),
        last_sync_status: "ok",
        last_sync_error: null as string | null,
      };

      const { error: updErr } = await supabaseAdmin
        .from("network_stats_baselines")
        .update(next)
        .eq("id", 1);
      if (updErr) throw updErr;

      return new Response(
        JSON.stringify({
          success: true,
          computed: {
            airtable_general_apps,
            airtable_service_leadership_unique,
            airtable_masterclass_total,
          },
          stored: next,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("sync-airtable-network-stats error:", msg);
      // Record failure (preserves last-known values)
      await supabaseAdmin
        .from("network_stats_baselines")
        .update({
          last_synced_at: new Date().toISOString(),
          last_sync_status: "error",
          last_sync_error: msg.slice(0, 500),
        })
        .eq("id", 1);
      return new Response(JSON.stringify({ success: false, error: "Sync failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  })
);
