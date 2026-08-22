// @edge-cron
// Email Octopus sync worker (PR 6c, ADR-0017). Drains public.email_octopus_contact_sync and pushes
// each contact's desired marketing state to EO with retry/backoff, off the member request path.
// Service-role only. No-ops (not an error) when the EO secrets are absent — that is the feature flag.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { withAuditWrapper } from "../_shared/audit.ts";
import { eoConfigFromEnv, pushDesiredState } from "../_shared/email-octopus/client.ts";
import { runSyncCycle, type ClaimRow } from "./sync-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(
  withAuditWrapper("email-octopus-sync", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Feature flag = EO secret presence. Absent => stay disabled (fail closed), intents keep queuing.
    const cfg = eoConfigFromEnv(Deno.env);
    if (!cfg) {
      return json({ disabled: true, reason: "EMAILOCTOPUS secrets not configured" }, 200);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    try {
      const stats = await runSyncCycle({
        reclaim: async () => {
          const { error } = await supabase.rpc("reclaim_stale_eo_sync", { p_older_than_secs: 300 });
          if (error) console.error("reclaim_stale_eo_sync failed:", error.message);
        },
        claim: async (batch) => {
          const { data, error } = await supabase.rpc("claim_eo_sync", { p_max: batch });
          if (error) throw new Error(`claim_eo_sync: ${error.message}`);
          return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
            email: String(r.email),
            user_id: (r.user_id as string | null) ?? null,
            desired_status: r.desired_status as ClaimRow["desired_status"],
            fields: (r.fields as Record<string, unknown> | null) ?? null,
            version: Number(r.version), // int8 may arrive as string; settle needs the exact value
            attempts: Number(r.attempts ?? 0),
          }));
        },
        push: (row) =>
          pushDesiredState(cfg, {
            email: row.email,
            desiredStatus: row.desired_status,
            fields: row.fields ?? undefined,
          }),
        settle: async (row, res) => {
          const { error } = await supabase.rpc("record_eo_sync_result", {
            p_email: row.email,
            p_version: row.version,
            p_outcome: res.outcome,
            p_status_code: res.statusCode,
            p_error: res.error,
          });
          if (error) throw new Error(`record_eo_sync_result: ${error.message}`);
        },
        onError: (row, err) => console.error(`eo sync row failed (${row.email}):`, err),
      });

      console.log("email-octopus-sync:", JSON.stringify(stats));
      return json({ ...stats, config: "enabled" }, 200);
    } catch (err) {
      console.error("email-octopus-sync fatal:", err);
      return json({ error: "sync cycle failed" }, 500);
    }
  })
);
