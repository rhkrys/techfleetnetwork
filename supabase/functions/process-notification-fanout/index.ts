// @edge-cron
// process-notification-fanout
// Drains pending public.notification_fanout_jobs in 500-row chunks.
// Audit 2026-04-18: replaces the in-transaction fanout in notify_project_opening
// so that admin project-status changes never block the projects UPDATE.
//
// Schedule this with pg_cron / a Supabase scheduled trigger (e.g. every minute)
// or invoke it manually from an admin tool.
import { createClient } from "npm:@supabase/supabase-js@2";

import { withAuditWrapper } from "../_shared/audit.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_CHUNKS_PER_INVOCATION = 20; // 20 * 500 = up to 10k recipients per run
const CHUNK_SIZE = 500;

Deno.serve(withAuditWrapper("process-notification-fanout", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth: require either the service role key or an admin JWT.
  const authHeader = req.headers.get("authorization") ?? "";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

  const token = authHeader.replace("Bearer ", "");
  let isAuthorized = token === SERVICE_KEY;

  if (!isAuthorized && token) {
    try {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data, error } = await userClient.auth.getUser();
      if (!error && data?.user) {
        const { data: roleRow } = await userClient
          .from("user_roles")
          .select("role")
          .eq("user_id", data.user.id)
          .eq("role", "admin")
          .maybeSingle();
        isAuthorized = !!roleRow;
      }
    } catch { /* fall through */ }
  }

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const summary: Array<{ job_id: string; processed: number; remaining: number; done: boolean }> = [];

  try {
    const { data: jobs, error: listErr } = await admin.rpc("list_pending_fanout_jobs", { p_limit: 5 });
    if (listErr) throw listErr;
    if (!jobs || jobs.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: [], message: "No pending jobs" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    for (const job of jobs) {
      let chunks = 0;
      while (chunks < MAX_CHUNKS_PER_INVOCATION) {
        const { data, error } = await admin.rpc("process_notification_fanout_chunk", {
          p_job_id: job.id,
          p_chunk_size: CHUNK_SIZE,
        });
        if (error) {
          summary.push({ job_id: job.id, processed: 0, remaining: -1, done: false });
          break;
        }
        const result = data as { processed: number; remaining: number; done: boolean };
        chunks++;
        if (result.done) {
          summary.push({ job_id: job.id, processed: result.processed, remaining: 0, done: true });
          break;
        }
        if (chunks >= MAX_CHUNKS_PER_INVOCATION) {
          summary.push({ job_id: job.id, processed: result.processed, remaining: result.remaining, done: false });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}));
