// @edge-cron
import { createClient } from "npm:@supabase/supabase-js@2";
import { extractClassDisplayTitle } from "../_shared/cert-title-utils.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TABLE_NAME = "Masterclass Registeration";
const CLASS_EMAIL_FIELD = "{Contributor Email Address (from Contributor Record)}";

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
      headers: { Authorization: `Bearer ${pat}` },
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

Deno.serve(withAuditWrapper("fetch-class-certifications", async (req) => {
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
        formula: `LOWER(TRIM(ARRAYJOIN(${CLASS_EMAIL_FIELD}, ''))) = LOWER("${escapedEmail}")`,
      },
      {
        name: "contains-arrayjoin-match",
        formula: `FIND(',' & LOWER("${escapedEmail}") & ',', ',' & LOWER(ARRAYJOIN(${CLASS_EMAIL_FIELD}, ',')) & ',') > 0`,
      },
      {
        name: "find-arrayjoin-match",
        formula: `FIND(LOWER("${escapedEmail}"), LOWER(ARRAYJOIN(${CLASS_EMAIL_FIELD}, ",")))`,
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
      console.error("fetch-class-certifications Airtable query failed", { message, userEmail });

      await adminClient.rpc("write_audit_log", {
        p_event_type: "client_error",
        p_table_name: "class_certifications",
        p_record_id: userId,
        p_user_id: userId,
        p_changed_fields: ["fetch-class-certifications", "Airtable query failed"],
        p_error_message: message,
      });

      return new Response(JSON.stringify({
        success: false,
        error: "Airtable query failed. Please ensure your Airtable token has access to the Masterclass Registration table.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Class certification lookup result", {
      userEmail,
      strategy: usedStrategy,
      totalFound: records.length,
    });

    // --- Audit: log the search attempt with full details ---
    await adminClient.rpc("write_audit_log", {
      p_event_type: records.length > 0 ? "class_cert_sync_started" : "class_cert_sync_no_results",
      p_table_name: "class_certifications",
      p_record_id: userId,
      p_user_id: userId,
      p_changed_fields: [
        `email:${userEmail}`,
        `strategy:${usedStrategy}`,
        `airtable_records_found:${records.length}`,
        `table:${TABLE_NAME}`,
        `filter:${CLASS_EMAIL_FIELD}`,
      ],
      p_error_message: null,
    });

    // --- Resolve linked "Registered For" IDs to Cohort Names ---
    const cohortIds = new Set<string>();
    for (const record of records) {
      const regFor = record.fields?.["Registered For"];
      if (Array.isArray(regFor)) {
        regFor.forEach((id: string) => {
          if (typeof id === "string" && id.trim()) cohortIds.add(id);
        });
      }
    }

    const cohortNameMap: Record<string, string> = {};
    if (cohortIds.size > 0) {
      const cohortTable = encodeURIComponent("Masterclass Cohorts");
      const idArray = Array.from(cohortIds);

      for (const id of idArray) {
        try {
          const cohortUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${cohortTable}/${id}`;
          const cohortRes = await fetch(cohortUrl, {
            headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
          });

          if (!cohortRes.ok) {
            const errText = await cohortRes.text();
            console.error("Cohort lookup failed", {
              cohortId: id,
              status: cohortRes.status,
              response: errText,
            });
            continue;
          }

          const cohortRecord = await cohortRes.json();
          const cohortName = cohortRecord?.fields?.["Cohort Name"];
          if (typeof cohortName === "string" && cohortName.trim()) {
            const cleaned = cohortName.trim().split(",")[0].trim();
            cohortNameMap[id] = cleaned;
          }
        } catch (err) {
          console.error("Cohort lookup exception", { cohortId: id, error: err });
        }
      }

      console.log("Resolved cohort names", {
        requested: cohortIds.size,
        resolved: Object.keys(cohortNameMap).length,
      });
    }

    // --- Audit: log cohort name resolution results ---
    if (cohortIds.size > 0) {
      const unresolvedIds = Array.from(cohortIds).filter(id => !cohortNameMap[id]);
      if (unresolvedIds.length > 0) {
        await adminClient.rpc("write_audit_log", {
          p_event_type: "class_cert_name_resolution_partial",
          p_table_name: "class_certifications",
          p_record_id: userId,
          p_user_id: userId,
          p_changed_fields: [
            `resolved:${Object.keys(cohortNameMap).length}/${cohortIds.size}`,
            ...unresolvedIds.slice(0, 5).map(id => `unresolved:${id}`),
          ],
        });
      }
    }

    // --- Upsert into DB with resolved cohort names ---
    let upserted = 0;
    let upsertErrors = 0;
    for (const record of records) {
      const fields = { ...(record.fields ?? {}) };

      // Replace "Registered For" record IDs with human-readable cohort names
      const regFor = fields["Registered For"];
      if (Array.isArray(regFor)) {
        fields["Registered For"] = regFor.map((id: string) => cohortNameMap[id] || id);
      }

      // Compute display_title server-side so UI never parses raw data
      const displayTitle = extractClassDisplayTitle(fields);

      const { error: upsertErr } = await adminClient
        .from("class_certifications")
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
      p_event_type: "class_cert_sync_completed",
      p_table_name: "class_certifications",
      p_record_id: userId,
      p_user_id: userId,
      p_changed_fields: [
        `email:${userEmail}`,
        `strategy:${usedStrategy}`,
        `airtable_found:${records.length}`,
        `upserted:${upserted}`,
        `upsert_errors:${upsertErrors}`,
        `cohorts_resolved:${Object.keys(cohortNameMap).length}`,
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
    console.error("fetch-class-certifications error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
