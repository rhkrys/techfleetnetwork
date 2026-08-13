// @edge-auth required — verify_jwt=true; background/admin job invoked with the service-role bearer.
// spf-sync — ingest the public SPF v1 API into the spf_* snapshot (ADR-0002).
// Background/admin job (NOT a user path). Per dataset: SSRF-guarded fetch → validate against
// the pinned v1 contract → checksum → atomic swap via spf_apply_dataset. FAILS CLOSED: a
// dataset that fails validation is skipped and its live snapshot is left unchanged, so a
// poisoned/malformed feed never reaches consumers. No consumer reads spf_entity yet (Phase A2).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createEdgeLogger } from "../_shared/logger.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
import {
  SPF_DATASETS,
  SPF_VERSION,
  spfDatasetUrl,
  validateRecords,
} from "../_shared/spf/contract.ts";
import { assertSpfUrlAllowed, entityTypeFor, normalizeDataset } from "./lib.ts";

const log = createEdgeLogger("spf-sync");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FETCH_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
/** Stop the run if this many datasets fail in a row (circuit-breaker-lite). */
const CONSECUTIVE_FAILURE_ABORT = 4;

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Fetch one SPF dataset with a hard timeout, no redirect-following, and capped
 *  exponential backoff + jitter on transient failure. Returns the raw response text. */
async function fetchDataset(url: string, requestId: string): Promise<string> {
  assertSpfUrlAllowed(url); // SSRF guard (T1)
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "error", // never follow a redirect to an unexpected host
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      log.warn("fetch", `attempt ${attempt} failed for ${url} [${requestId}]: ${String(e)}`, {
        requestId,
      });
      if (attempt < MAX_RETRIES) {
        const backoff = 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, backoff));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`fetch failed after ${MAX_RETRIES} attempts: ${String(lastErr)}`);
}

type DatasetResult = {
  entity: string;
  status: "ok" | "validation_failed" | "fetch_failed" | "swap_failed";
  count?: number;
  errors?: string[];
};

serve(
  withAuditWrapper("spf-sync", async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST, OPTIONS" },
      });
    }

    const requestId = crypto.randomUUID().substring(0, 8);
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY =
      Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";

    // ── AuthZ: admin JWT OR the service-role key (scheduled job). Model: ingest-reference-csv.
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isServiceRole = token === SERVICE_KEY;
    if (!isServiceRole) {
      const authClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
      } = await authClient.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const admin = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: isAdmin } = await admin.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Admin role required" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Optional { entities: [...] } to sync a subset; default = all pinned datasets.
    let requested: string[] = Object.keys(SPF_DATASETS);
    try {
      const body = await req.json();
      if (Array.isArray(body?.entities) && body.entities.length) {
        requested = body.entities.filter((e: string) => e in SPF_DATASETS);
      }
    } catch {
      /* no body → sync all */
    }

    log.info("run", `SPF sync start [${requestId}] entities=${requested.length}`, { requestId });

    const results: DatasetResult[] = [];
    let consecutiveFailures = 0;

    for (const entity of requested) {
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_ABORT) {
        results.push({
          entity,
          status: "fetch_failed",
          errors: ["aborted: too many consecutive failures"],
        });
        continue;
      }
      try {
        const text = await fetchDataset(spfDatasetUrl(entity), requestId);
        let records: unknown;
        try {
          records = JSON.parse(text);
        } catch {
          consecutiveFailures++;
          results.push({ entity, status: "fetch_failed", errors: ["payload is not valid JSON"] });
          continue;
        }

        // Contract validation — fail closed (do NOT swap on violation).
        const v = validateRecords(entity, records);
        if (!v.ok) {
          consecutiveFailures = 0; // it fetched fine; this is a contract issue, not an outage
          log.error("validate", `contract violation for ${entity} [${requestId}]`, { requestId });
          results.push({ entity, status: "validation_failed", errors: v.errors.slice(0, 10) });
          continue;
        }

        const arr = records as Record<string, unknown>[];
        const checksum = await sha256Hex(text);
        const rows = normalizeDataset(entity, arr);

        const { data: applied, error } = await supabase.rpc("spf_apply_dataset", {
          p_entity_type: entityTypeFor(entity),
          p_dataset: entity,
          p_spf_version: SPF_VERSION,
          p_checksum: checksum,
          p_record_count: arr.length,
          p_raw: arr,
          p_rows: rows,
        });
        if (error) {
          consecutiveFailures++;
          results.push({ entity, status: "swap_failed", errors: [error.message] });
          continue;
        }
        consecutiveFailures = 0;
        results.push({ entity, status: "ok", count: (applied as number) ?? rows.length });
        log.info("swap", `${entity} → ${applied} rows [${requestId}]`, { requestId });
      } catch (e) {
        consecutiveFailures++;
        results.push({ entity, status: "fetch_failed", errors: [String(e)] });
        log.error("dataset", `${entity} failed [${requestId}]: ${String(e)}`, { requestId });
      }
    }

    const okCount = results.filter((r) => r.status === "ok").length;
    log.info("run", `SPF sync done [${requestId}] ok=${okCount}/${results.length}`, { requestId });

    return new Response(
      JSON.stringify(
        { version: SPF_VERSION, ok: okCount, total: results.length, results },
        null,
        2
      ),
      {
        status: okCount === results.length ? 200 : 207,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  })
);
