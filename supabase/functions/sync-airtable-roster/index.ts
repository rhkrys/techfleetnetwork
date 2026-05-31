import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@4.3.6";

import { withAuditWrapper } from "../_shared/audit.ts";

// M-01: Lenient shape guard. Existing table_name string check below stays authoritative.
const BodySchema = z.object({
  table_name: z.string().optional(),
}).passthrough();
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Fetches all records from a given Airtable table using pagination.
 * Returns an array of Airtable record objects.
 */
async function fetchAllAirtableRecords(
  baseId: string,
  tableName: string,
  pat: string,
): Promise<Array<{ id: string; fields: Record<string, unknown> }>> {
  const records: Array<{ id: string; fields: Record<string, unknown> }> = [];
  let offset: string | undefined;
  const encodedTable = encodeURIComponent(tableName);

  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodedTable}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${pat}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Airtable fetch failed [${res.status}]: ${body}`);
    }

    const data = await res.json();
    records.push(...(data.records ?? []));
    offset = data.offset;
  } while (offset);

  return records;
}

/**
 * Maps an Airtable record's fields to the project_roster row shape.
 * Field names are case-insensitive matched for resilience.
 */
function mapToRosterRow(
  airtableId: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  // Build a lowercase lookup for field names
  const lc: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    lc[k.toLowerCase().replace(/[\s_-]+/g, "_")] = v;
  }

  const getString = (...keys: string[]): string => {
    for (const k of keys) {
      const val = lc[k];
      if (typeof val === "string" && val.trim()) return val.trim();
      if (Array.isArray(val) && val.length) return val.join(", ");
    }
    return "";
  };

  const getNumber = (...keys: string[]): number => {
    for (const k of keys) {
      const val = lc[k];
      if (typeof val === "number") return val;
      if (typeof val === "string") {
        const n = parseFloat(val);
        if (!isNaN(n)) return n;
      }
    }
    return 0;
  };

  const getDate = (...keys: string[]): string | null => {
    for (const k of keys) {
      const val = lc[k];
      if (typeof val === "string" && val.trim()) {
        const d = new Date(val);
        if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
      }
    }
    return null;
  };

  const getArray = (...keys: string[]): string[] => {
    for (const k of keys) {
      const val = lc[k];
      if (Array.isArray(val)) return val.map(String);
    }
    return [];
  };

  return {
    airtable_record_id: airtableId,
    member_name: getString("member_name", "name", "team_member", "member", "full_name"),
    member_email: getString("member_email", "email", "email_address"),
    member_role: getString("member_role", "role", "hat", "team_hat", "position"),
    project_name: getString("project_name", "project", "project_title"),
    client_name: getString("client_name", "client", "organization"),
    phase: getString("phase", "project_phase"),
    project_type: getString("project_type", "type"),
    status: getString("status", "member_status", "assignment_status"),
    start_date: getDate("start_date", "start", "date_started", "assigned_date"),
    end_date: getDate("end_date", "end", "date_ended", "completion_date"),
    hours_contributed: getNumber("hours_contributed", "hours", "total_hours"),
    performance_notes: getString("performance_notes", "notes", "feedback", "performance"),
    mentor: getString("mentor", "mentor_name", "assigned_mentor"),
    linked_project_ids: getArray("linked_project_ids", "linked_projects", "project_links"),
    raw_airtable_data: fields,
    synced_at: new Date().toISOString(),
  };
}

Deno.serve(withAuditWrapper("sync-airtable-roster", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth: require admin ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Env ---
    const AIRTABLE_PAT = Deno.env.get("AIRTABLE_PAT");
    if (!AIRTABLE_PAT) throw new Error("AIRTABLE_PAT is not configured");

    const AIRTABLE_BASE_ID = Deno.env.get("AIRTABLE_BASE_ID");
    if (!AIRTABLE_BASE_ID) throw new Error("AIRTABLE_BASE_ID is not configured");

    // Allow overriding table name from request body, default to "Project Roster"
    let tableName = "Project Roster";
    if (req.method === "POST") {
      try {
        const raw = await req.json();
        const parsed = BodySchema.safeParse(raw);
        const body = parsed.success ? (parsed.data as Record<string, unknown>) : {};
        if (body.table_name && typeof body.table_name === "string") {
          tableName = (body.table_name as string).trim();
        }
      } catch {
        // No body or invalid JSON — use default
      }
    }

    // --- Fetch all records from Airtable ---
    console.log(`sync-airtable-roster: Fetching from "${tableName}" in base ${AIRTABLE_BASE_ID}`);
    const records = await fetchAllAirtableRecords(AIRTABLE_BASE_ID, tableName, AIRTABLE_PAT);
    console.log(`sync-airtable-roster: Fetched ${records.length} records`);

    if (records.length === 0) {
      return new Response(
        JSON.stringify({ success: true, synced: 0, created: 0, updated: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Upsert into project_roster ---
    let created = 0;
    const updated = 0;
    const errors: string[] = [];

    // Process in batches of 50
    const batchSize = 50;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const rows = batch.map((r) => mapToRosterRow(r.id, r.fields));

      const { data: upserted, error: upsertErr } = await supabaseAdmin
        .from("project_roster")
        .upsert(rows, { onConflict: "airtable_record_id", ignoreDuplicates: false })
        .select("id");

      if (upsertErr) {
        console.error(`sync-airtable-roster batch ${i} error:`, upsertErr.message);
        errors.push(`Batch ${i}: ${upsertErr.message}`);
      } else {
        // Count created vs updated (simplified — upsert doesn't distinguish)
        created += upserted?.length ?? 0;
      }
    }

    // Log the sync event
    await supabaseAdmin.from("audit_log").insert({
      event_type: "roster_sync_completed",
      table_name: "project_roster",
      record_id: "bulk",
      user_id: userData.user.id,
      changed_fields: [`synced:${records.length}`, `errors:${errors.length}`],
    });

    return new Response(
      JSON.stringify({
        success: errors.length === 0,
        synced: records.length,
        upserted: created,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    console.error("sync-airtable-roster error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
