// @edge-public
// send-application-confirmation
//
// Drains public.application_confirmation_outbox and sends the matching
// transactional confirmation email (general-application-submitted or
// project-application-submitted). Two callable modes:
//
//   1. Authenticated member call right after a successful submit:
//      POST { kind, applicationId } with the user's JWT.
//      Verifies the row belongs to auth.uid() before sending.
//
//   2. Cron sweep (service role bearer): POST {} with service role token.
//      Drains all pending outbox rows enqueued > 30s ago (gives the trigger
//      time to settle) and < 7 days ago (safety cap).
//
// Idempotency: outbox UNIQUE(kind, application_id) + sent_at guard makes this
// safe to call any number of times.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { queueTransactionalEmail } from "../_shared/transactional-email.ts";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";
import { withAuditWrapper } from "../_shared/audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id, x-trace-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") ?? "https://techfleet.network";

interface OutboxRow {
  id: string;
  kind: "general" | "project";
  application_id: string;
  user_id: string;
  recipient_email: string | null;
  project_id: string | null;
  attempts: number;
}

async function loadRecipientContext(
  admin: SupabaseClient,
  row: OutboxRow
): Promise<{ email: string | null; firstName: string | null; projectName: string | null }> {
  let email = row.recipient_email;
  let firstName: string | null = null;
  let projectName: string | null = null;

  const { data: profile } = await admin
    .from("profiles")
    .select("email, first_name, display_name")
    .eq("user_id", row.user_id)
    .maybeSingle();

  if (!email && profile?.email) email = profile.email as string;
  firstName = (profile?.first_name as string) || (profile?.display_name as string) || null;

  if (row.kind === "project" && row.project_id) {
    const { data: proj } = await admin
      .from("projects")
      .select("friendly_name, project_type, client_id")
      .eq("id", row.project_id)
      .maybeSingle();
    if (proj) {
      let clientName: string | null = null;
      if (proj.client_id) {
        const { data: client } = await admin
          .from("clients")
          .select("name")
          .eq("id", proj.client_id)
          .maybeSingle();
        clientName = (client?.name as string) || null;
      }
      projectName =
        [clientName, (proj.friendly_name as string) || null].filter(Boolean).join(" — ") || null;
    }
  }

  return { email, firstName, projectName };
}

async function processRow(
  admin: SupabaseClient,
  row: OutboxRow
): Promise<{ ok: boolean; reason?: string }> {
  const ctx = await loadRecipientContext(admin, row);
  if (!ctx.email) {
    await admin
      .from("application_confirmation_outbox")
      .update({ attempts: row.attempts + 1, last_error: "no_recipient_email" })
      .eq("id", row.id);
    return { ok: false, reason: "no_recipient_email" };
  }

  const templateName =
    row.kind === "general" ? "general-application-submitted" : "project-application-submitted";

  const templateData =
    row.kind === "general"
      ? {
          firstName: ctx.firstName,
          applicationsUrl: `${SITE_ORIGIN}/applications`,
          projectsUrl: `${SITE_ORIGIN}/project-openings`,
        }
      : {
          firstName: ctx.firstName,
          projectName: ctx.projectName,
          statusUrl: `${SITE_ORIGIN}/applications/projects`,
        };

  const idempotencyKey = `app-confirm:${row.kind}:${row.application_id}`;

  const result = await queueTransactionalEmail({
    templateName,
    recipientEmail: ctx.email,
    idempotencyKey,
    messageId: idempotencyKey,
    templateData,
    supabase: admin,
  });

  if (!result.ok) {
    await admin
      .from("application_confirmation_outbox")
      .update({ attempts: row.attempts + 1, last_error: result.error ?? "queue_failed" })
      .eq("id", row.id);
    return { ok: false, reason: result.error };
  }

  await admin
    .from("application_confirmation_outbox")
    .update({ sent_at: new Date().toISOString(), attempts: row.attempts + 1, last_error: null })
    .eq("id", row.id);

  return { ok: true };
}

Deno.serve(
  withAuditWrapper("send-application-confirmation", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization") ?? "";
    const serviceAuth = authorizeServiceRoleRequest(req);

    // ── Mode A: cron / service-role sweep ───────────────────────────────
    if (serviceAuth.ok) {
      const { data: rows, error } = await admin
        .from("application_confirmation_outbox")
        .select("id, kind, application_id, user_id, recipient_email, project_id, attempts")
        .is("sent_at", null)
        .lt("attempts", 5)
        .lt("enqueued_at", new Date(Date.now() - 30_000).toISOString())
        .gt("enqueued_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order("enqueued_at", { ascending: true })
        .limit(50);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let sent = 0;
      let failed = 0;
      for (const row of (rows ?? []) as OutboxRow[]) {
        const r = await processRow(admin, row);
        if (r.ok) sent++;
        else failed++;
      }
      return new Response(
        JSON.stringify({ mode: "sweep", sent, failed, scanned: rows?.length ?? 0 }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Mode B: authenticated member call ───────────────────────────────
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userRes.user.id;

    let body: { kind?: string; applicationId?: string } = {};
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const kind = body.kind;
    const applicationId = body.applicationId;
    if (kind !== "general" && kind !== "project") {
      return new Response(JSON.stringify({ error: 'kind must be "general" or "project"' }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!applicationId || typeof applicationId !== "string") {
      return new Response(JSON.stringify({ error: "applicationId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row, error: rowErr } = await admin
      .from("application_confirmation_outbox")
      .select("id, kind, application_id, user_id, recipient_email, project_id, attempts, sent_at")
      .eq("kind", kind)
      .eq("application_id", applicationId)
      .maybeSingle();

    if (rowErr) {
      return new Response(JSON.stringify({ error: rowErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!row) {
      // The outbox row is created by a DB trigger; if it's missing the app
      // isn't actually completed yet. Caller can retry.
      return new Response(JSON.stringify({ error: "application_not_completed" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if ((row as any).user_id !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if ((row as any).sent_at) {
      return new Response(JSON.stringify({ ok: true, deduped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await processRow(admin, row as unknown as OutboxRow);
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  })
);
