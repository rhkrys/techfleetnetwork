// @edge-cron
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { createEdgeLogger } from "../_shared/logger.ts";

import { withAuditWrapper } from "../_shared/audit.ts";
const log = createEdgeLogger("ingest-csv-knowledge");

const BodySchema = z.object({
  csv_text: z.string().optional(),
  dataset_name: z.string().optional(),
}).passthrough();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function parseCsvToMarkdown(csvText: string, datasetName: string): { url: string; title: string; content: string }[] {
  const rows: string[][] = [];
  let current: string[] = [];
  let inQuotes = false;
  let field = "";

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    if (ch === '"') {
      if (inQuotes && csvText[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      current.push(field.trim());
      field = "";
    } else if (ch === '\n' && !inQuotes) {
      current.push(field.trim());
      if (current.some(f => f !== "")) {
        rows.push(current);
      }
      current = [];
      field = "";
    } else if (ch === '\r' && !inQuotes) {
      // skip carriage return
    } else {
      field += ch;
    }
  }
  if (field || current.length > 0) {
    current.push(field.trim());
    if (current.some(f => f !== "")) {
      rows.push(current);
    }
  }

  if (rows.length < 2) return [];

  const headers = rows[0];
  const entries: { url: string; title: string; content: string }[] = [];
  const nameCol = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = row[nameCol] || "";
    if (!name || name === "﻿") continue;

    let md = `# ${name}\n\n`;
    md += `**Category:** ${datasetName}\n\n`;

    for (let c = 1; c < headers.length && c < row.length; c++) {
      const val = row[c];
      if (!val || val.includes("airtableusercontent.com")) continue;
      const header = headers[c] || `Field ${c}`;
      if (header.endsWith(" copy")) continue;
      md += `## ${header}\n\n${val}\n\n`;
    }

    entries.push({
      url: `csv://${datasetName.toLowerCase().replace(/\s+/g, "-")}/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      title: `${datasetName}: ${name}`,
      content: md.trim(),
    });
  }

  return entries;
}

serve(withAuditWrapper("ingest-csv-knowledge", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().substring(0, 8);
  log.info("handler", `CSV ingest request received [${requestId}]`, { requestId });

  // --- JWT + admin role validation ---
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL_AUTH = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY_AUTH = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const anonClient = createClient(SUPABASE_URL_AUTH, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await anonClient.auth.getUser();
  if (userErr || !userData?.user) {
    log.warn("auth", `Invalid JWT [${requestId}]`, { requestId });
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(SUPABASE_URL_AUTH, SUPABASE_SERVICE_ROLE_KEY_AUTH);
  const { data: roleData } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleData) {
    log.warn("auth", `Non-admin user attempted ingest [${requestId}]: ${userData.user.id}`, { requestId });
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // --- End auth ---

  try {
    const _raw = await req.json().catch(() => ({}));
    const _parsed = BodySchema.safeParse(_raw);
    if (!_parsed.success) {
      return new Response(JSON.stringify({ success: false, error: "Invalid request body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { csv_text, dataset_name } = _parsed.data as { csv_text?: string; dataset_name?: string };

    if (!csv_text || !dataset_name) {
      log.warn("validate", `Missing required fields [${requestId}]: csv_text=${!!csv_text}, dataset_name=${!!dataset_name}`, { requestId });
      return new Response(
        JSON.stringify({ success: false, error: "csv_text and dataset_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    log.info("parse", `Parsing CSV for dataset "${dataset_name}" [${requestId}]: ${csv_text.length} chars`, {
      requestId,
      datasetName: dataset_name,
      csvLength: csv_text.length,
    });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const entries = parseCsvToMarkdown(csv_text, dataset_name);
    log.info("parse", `Parsed ${entries.length} entries from "${dataset_name}" [${requestId}]`, {
      requestId,
      datasetName: dataset_name,
      entryCount: entries.length,
    });

    let inserted = 0;
    let errors = 0;

    for (const entry of entries) {
      const { error } = await supabase.from("knowledge_base").upsert(
        {
          url: entry.url,
          title: entry.title,
          content: entry.content,
          scraped_at: new Date().toISOString(),
        },
        { onConflict: "url" }
      );
      if (error) {
        log.error("upsert", `Failed to upsert "${entry.title}" [${requestId}]: ${error.message}`, {
          requestId,
          entryTitle: entry.title,
          entryUrl: entry.url,
          errorCode: error.code,
        }, error);
        errors++;
      } else {
        inserted++;
      }
    }

    log.info("handler", `CSV ingest completed [${requestId}]: ${inserted} inserted, ${errors} errors out of ${entries.length} entries`, {
      requestId,
      datasetName: dataset_name,
      parsed: entries.length,
      inserted,
      errors,
    });

    return new Response(
      JSON.stringify({ success: true, dataset_name, parsed: entries.length, inserted, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    log.error("handler", `Unhandled exception [${requestId}]`, { requestId }, err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
