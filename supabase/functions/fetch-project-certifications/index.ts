// @edge-cron
import { createClient } from "npm:@supabase/supabase-js@2";
import { extractProjectDisplayTitle } from "../_shared/cert-title-utils.ts";

import { withAuditWrapper } from "../_shared/audit.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TABLE_NAME = "Project Trainee and Volunteer Roster";
const PROJECT_EMAIL_FIELD = "{Contributor Email Address (from Project Teammate)}";

function escapeAirtableFormulaValue(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').trim();
}

async function fetchAllAirtableRecords(
  baseId: string,
  tableName: string,
  filterFormula: string,
  pat: string,
) {
  const encodedTable = encodeURIComponent(tableName);
  const records: Array<{ id: string; fields?: Record<string, unknown> }> = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({
      filterByFormula: filterFormula,
      pageSize: "100",
    });

    if (offset) params.set("offset", offset);

    const airtableUrl = `https://api.airtable.com/v0/${baseId}/${encodedTable}?${params.toString()}`;
    const airtableRes = await fetch(airtableUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${pat}`,
      },
    });

    if (!airtableRes.ok) {
      const errBody = await airtableRes.text();
      throw new Error(`Airtable query failed [${airtableRes.status}]: ${errBody.slice(0, 500)}`);
    }

    const result = await airtableRes.json();
    records.push(...(result.records ?? []));
    offset = result.offset;
  } while (offset);

  return records;
}

Deno.serve(withAuditWrapper("fetch-project-certifications", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;
    const userEmail = (claimsData.claims.email as string) ?? "";

    if (!userEmail) {
      return new Response(JSON.stringify({ error: "No email associated with account" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Env ---
    const AIRTABLE_PAT = Deno.env.get("AIRTABLE_PAT");
    if (!AIRTABLE_PAT) throw new Error("AIRTABLE_PAT is not configured");

    const AIRTABLE_BASE_ID = Deno.env.get("AIRTABLE_BASE_ID");
    if (!AIRTABLE_BASE_ID) throw new Error("AIRTABLE_BASE_ID is not configured");

    // --- Admin client for DB writes ---
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // --- Query Airtable by email with fallback matching for lookup/array fields ---
    const escapedEmail = escapeAirtableFormulaValue(userEmail);
    const filterStrategies = [
      {
        name: "exact-arrayjoin-match",
        formula: `LOWER(TRIM(ARRAYJOIN(${PROJECT_EMAIL_FIELD}, ''))) = LOWER("${escapedEmail}")`,
      },
      {
        name: "contains-arrayjoin-match",
        formula: `FIND(',' & LOWER("${escapedEmail}") & ',', ',' & LOWER(ARRAYJOIN(${PROJECT_EMAIL_FIELD}, ',')) & ',') > 0`,
      },
    ];

    let records: Array<{ id: string; fields?: Record<string, unknown> }> = [];
    let usedStrategy = filterStrategies[0].name;

    try {
      for (const strategy of filterStrategies) {
        const found = await fetchAllAirtableRecords(
          AIRTABLE_BASE_ID,
          TABLE_NAME,
          strategy.formula,
          AIRTABLE_PAT,
        );

        if (found.length > 0) {
          records = found;
          usedStrategy = strategy.name;
          break;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Airtable error";
      console.error("fetch-project-certifications Airtable query failed", { message, userEmail });

      await adminClient.rpc("write_audit_log", {
        p_event_type: "client_error",
        p_table_name: "project_certifications",
        p_record_id: userId,
        p_user_id: userId,
        p_changed_fields: ["fetch-project-certifications", "Airtable query failed"],
        p_error_message: message,
      });

      return new Response(JSON.stringify({
        success: false,
        error: "Airtable query failed. Please ensure your Airtable token has access to the Project Trainee and Volunteer Roster table.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Project certification lookup result", {
      userEmail,
      strategy: usedStrategy,
      totalFound: records.length,
    });

    // --- Audit: log the search attempt with full details ---
    await adminClient.rpc("write_audit_log", {
      p_event_type: records.length > 0 ? "project_cert_sync_started" : "project_cert_sync_no_results",
      p_table_name: "project_certifications",
      p_record_id: userId,
      p_user_id: userId,
      p_changed_fields: [
        `email:${userEmail}`,
        `strategy:${usedStrategy}`,
        `airtable_records_found:${records.length}`,
        `table:${TABLE_NAME}`,
      ],
      p_error_message: null,
    });

    // --- Resolve linked "Project They Joined" IDs to project names ---
    const projectIds = new Set<string>();
    for (const record of records) {
      const projField = record.fields?.["Project They Joined"];
      if (Array.isArray(projField)) {
        projField.forEach((id: string) => {
          if (typeof id === "string" && id.trim()) projectIds.add(id);
        });
      }
    }

    const projectNameMap: Record<string, string> = {};
    if (projectIds.size > 0) {
      // Try to resolve from a Projects table in Airtable
      const projectTable = encodeURIComponent("Projects");
      const idArray = Array.from(projectIds);

      for (const id of idArray) {
        const projectUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${projectTable}/${id}`;
        const projectRes = await fetch(projectUrl, {
          headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
        });

        if (!projectRes.ok) {
          console.error("Project lookup failed", {
            projectId: id,
            status: projectRes.status,
            response: await projectRes.text(),
          });
          continue;
        }

        const projectRecord = await projectRes.json();
        // Try common name fields
        const projectName = projectRecord?.fields?.["Project Name"] 
          ?? projectRecord?.fields?.["Name"]
          ?? projectRecord?.fields?.["Project"];
        if (typeof projectName === "string" && projectName.trim()) {
          const cleaned = projectName.trim().split(",")[0].trim();
          projectNameMap[id] = cleaned;
        }
      }

      console.log("Resolved project names", {
        requested: projectIds.size,
        resolved: Object.keys(projectNameMap).length,
      });
    }

    // --- Audit: log project name resolution results ---
    if (projectIds.size > 0) {
      const unresolvedIds = Array.from(projectIds).filter(id => !projectNameMap[id]);
      if (unresolvedIds.length > 0) {
        await adminClient.rpc("write_audit_log", {
          p_event_type: "project_cert_name_resolution_partial",
          p_table_name: "project_certifications",
          p_record_id: userId,
          p_user_id: userId,
          p_changed_fields: [
            `resolved:${Object.keys(projectNameMap).length}/${projectIds.size}`,
            ...unresolvedIds.slice(0, 5).map(id => `unresolved:${id}`),
          ],
        });
      }
    }

    // --- Upsert into DB with resolved project names ---
    let upserted = 0;
    let upsertErrors = 0;
    for (const record of records) {
      const fields = { ...(record.fields ?? {}) };

      // Replace "Project They Joined" record IDs with human-readable names
      const projField = fields["Project They Joined"];
      if (Array.isArray(projField)) {
        fields["Project They Joined"] = projField.map((id: string) => projectNameMap[id] || id);
      }

      // Compute display_title server-side so UI never parses raw data
      const displayTitle = extractProjectDisplayTitle(fields);

      const { error: upsertErr } = await adminClient
        .from("project_certifications")
        .upsert(
          {
            user_id: userId,
            email: userEmail,
            airtable_record_id: record.id,
            raw_data: fields,
            display_title: displayTitle,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "user_id,airtable_record_id" }
        );

      if (upsertErr) {
        console.error("Upsert error for record", record.id, upsertErr);
        upsertErrors++;
      } else {
        upserted++;
      }
    }

    // --- Audit: log sync completion summary ---
    await adminClient.rpc("write_audit_log", {
      p_event_type: "project_cert_sync_completed",
      p_table_name: "project_certifications",
      p_record_id: userId,
      p_user_id: userId,
      p_changed_fields: [
        `email:${userEmail}`,
        `strategy:${usedStrategy}`,
        `airtable_found:${records.length}`,
        `upserted:${upserted}`,
        `upsert_errors:${upsertErrors}`,
        `projects_resolved:${Object.keys(projectNameMap).length}`,
      ],
    });

    return new Response(JSON.stringify({
      success: true,
      total_found: records.length,
      upserted,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("fetch-project-certifications error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
