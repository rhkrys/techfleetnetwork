// @edge-public
import { withAuditWrapper } from "../_shared/audit.ts";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";
/**
 * triage-digest-builder
 *
 * Daily summary of the error triage queue + audit pressure for admins.
 * Sends ONE Discord webhook message + ONE email per admin per day
 * (idempotency-keyed so re-runs are safe).
 *
 * Cost discipline:
 *   - Pure SQL aggregation, NO AI calls
 *   - Service-role only (cron-invoked)
 *   - Idempotent per UTC day per admin
 *   - One Discord post total (uses DISCORD_PLATFORM_UPDATES_WEBHOOK)
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { queueTransactionalEmail } from "../_shared/transactional-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DISCORD_WEBHOOK = Deno.env.get("DISCORD_PLATFORM_UPDATES_WEBHOOK") ?? "";
const SITE_URL = "https://techfleet.network";

interface QueueRow {
  event_type: string;
  source: string;
  occurrence_count: number;
  status: string;
  last_seen_at: string;
}

Deno.serve(
  withAuditWrapper("triage-digest-builder", async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // Service-role only. Constant-time exact key match; NO unverified JWT decode.
    const svcAuth = authorizeServiceRoleRequest(req);
    if (!svcAuth.ok) {
      return json({ error: "unauthorized", reason: "not_service_role" }, svcAuth.status);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // ---- Queue stats --------------------------------------------------------
    const { data: openRows } = await supabase
      .from("agent_fix_queue")
      .select(
        "id,fingerprint,event_type,source,error_message,severity,occurrence_count,status,first_seen_at,last_seen_at,root_cause_hypothesis,proposed_fix_summary,proposed_fix_files"
      )
      .in("status", ["pending", "triaged", "proposed"])
      .order("occurrence_count", { ascending: false })
      .limit(200);

    const open = (openRows ?? []) as any[];
    const pendingCount = open.filter((r) => r.status === "pending").length;
    const proposedCount = open.filter((r) => r.status === "proposed").length;
    const topItems = open.slice(0, 8);

    // Fuller rows for the inline plan section (last 24h resolved + all open)
    const { data: resolvedRows } = await supabase
      .from("agent_fix_queue")
      .select(
        "id,fingerprint,event_type,source,error_message,severity,occurrence_count,status,resolved_at,root_cause_hypothesis,proposed_fix_summary,proposed_fix_files"
      )
      .in("status", ["resolved", "applied", "dismissed"])
      .gte("updated_at", yesterdayIso)
      .order("updated_at", { ascending: false })
      .limit(200);

    const planMarkdown = buildPlanMarkdown(todayStr, open, (resolvedRows ?? []) as any[]);

    const { count: resolvedYesterday } = await supabase
      .from("agent_fix_queue")
      .select("*", { count: "exact", head: true })
      .in("status", ["resolved", "dismissed"])
      .gte("updated_at", yesterdayIso);

    // ---- Pressure + 24h volume ----------------------------------------------
    const { data: healthRow } = await supabase
      .from("system_health_state")
      .select("metadata")
      .eq("id", 1)
      .maybeSingle();
    const meta = (healthRow?.metadata ?? {}) as { audit_pressure?: string };
    const auditPressure = (meta.audit_pressure ?? "none") as Props["auditPressure"];

    const { count: audit24h } = await supabase
      .from("audit_log")
      .select("*", { count: "exact", head: true })
      .gte("created_at", yesterdayIso);

    // Lane 2 self-heal counter — how many transient failures auto-recovered
    const { count: recovered24h } = await supabase
      .from("audit_log")
      .select("*", { count: "exact", head: true })
      .eq("event_type", "external_api_recovered")
      .gte("created_at", yesterdayIso);

    const { data: budget } = await supabase
      .from("agent_triage_budget")
      .select("triage_calls_used,day")
      .eq("id", 1)
      .maybeSingle();
    const triageBudgetUsed = budget?.day === todayStr ? (budget.triage_calls_used ?? 0) : 0;

    // ---- Skip-send guard: nothing pending AND nothing resolved -------------
    // Don't spam admins on quiet days. Always send when there's open work.
    const isQuietDay =
      pendingCount === 0 &&
      proposedCount === 0 &&
      (resolvedYesterday ?? 0) === 0 &&
      auditPressure === "none";

    // ---- Discord (single post) ---------------------------------------------
    let discordSent = false;
    if (!isQuietDay && DISCORD_WEBHOOK) {
      const lines = [
        `**Daily Triage Digest — ${todayStr}**`,
        `🔴 Pending: **${pendingCount}**  ·  💡 Proposed: **${proposedCount}**  ·  ✅ Resolved 24h: **${resolvedYesterday ?? 0}**  ·  🔁 Self-recovered: **${recovered24h ?? 0}**`,
        `📊 Audit volume 24h: **${(audit24h ?? 0).toLocaleString()}**  ·  Pressure: **${auditPressure}**  ·  AI budget: ${triageBudgetUsed}/20`,
        ...(topItems.length
          ? [
              "",
              "**Top open errors:**",
              ...topItems
                .slice(0, 5)
                .map(
                  (it) =>
                    `• \`${it.event_type}\` ×${it.occurrence_count} — ${it.source.slice(0, 80)} *(${it.status})*`
                ),
            ]
          : []),
        ``,
        `<${SITE_URL}/admin/system-health?tab=triage>`,
      ].join("\n");
      try {
        const resp = await fetch(DISCORD_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: lines.slice(0, 1900) }),
        });
        discordSent = resp.ok;
      } catch (_e) {
        /* swallow — telemetry must never throw */
      }
    }

    // ---- Email digest recipients (idempotent per day) ----------------------
    // Hard-pinned to mdenner@techfleet.org per owner request. To restore the
    // broadcast-to-all-admins behaviour, swap this back to a user_roles query.
    const recipients = [{ user_id: "owner", email: "mdenner@techfleet.org", first_name: "Marisa" }];

    let emailsSent = 0;
    if (!isQuietDay && recipients.length > 0) {
      for (const p of recipients) {
        if (!p.email) continue;
        const idemKey = `triage-digest:${p.user_id}:${todayStr}`;
        const res = await queueTransactionalEmail({
          templateName: "triage-digest",
          recipientEmail: p.email,
          idempotencyKey: idemKey,
          supabase,
          templateData: {
            firstName: p.first_name || "Admin",
            date: todayStr,
            pendingCount,
            proposedCount,
            resolvedYesterday: resolvedYesterday ?? 0,
            auditPressure,
            audit24hCount: audit24h ?? 0,
            topItems,
            triageBudgetUsed,
            triageBudgetCap: 20,
            adminUrl: `${SITE_URL}/admin/system-health?tab=triage`,
            planMarkdown,
          },
        });
        if (res.ok) emailsSent += 1;
      }
    }

    return json({
      ok: true,
      quietDay: isQuietDay,
      pendingCount,
      proposedCount,
      resolvedYesterday: resolvedYesterday ?? 0,
      auditPressure,
      audit24h: audit24h ?? 0,
      discordSent,
      emailsSent,
      planBytes: planMarkdown.length,
    });
  })
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Type alias for the email template props we pass in.
type Props = {
  auditPressure?: "none" | "soft" | "medium" | "hard";
};

// ---- Plan markdown builder -------------------------------------------------
// Embedded inline in the email body (Lovable Emails has no attachment support).
// Hard-capped so payloads stay well under provider limits.
const PLAN_MAX_BYTES = 120_000;

function buildPlanMarkdown(date: string, open: any[], resolved: any[]): string {
  const lines: string[] = [];
  lines.push(`# Tech Fleet Triage Plan — ${date}`);
  lines.push("");
  lines.push(`_Open: ${open.length} · Resolved 24h: ${resolved.length}_`);
  lines.push("");
  lines.push(`## Open (pending / triaged / proposed)`);
  if (open.length === 0) lines.push("_None — queue is clear._");
  else for (const r of open) lines.push(...renderEntry(r));
  lines.push("");
  lines.push(`## Resolved / applied / dismissed in last 24h`);
  if (resolved.length === 0) lines.push("_None._");
  else for (const r of resolved) lines.push(...renderEntry(r));

  let out = lines.join("\n");
  if (out.length > PLAN_MAX_BYTES) {
    out =
      out.slice(0, PLAN_MAX_BYTES) +
      "\n\n_… truncated — see /admin/system-health?tab=triage for full list._";
  }
  return out;
}

function renderEntry(r: any): string[] {
  const out: string[] = [];
  out.push("");
  out.push(`### \`${r.event_type}\` — ${r.fingerprint}`);
  out.push(
    `- **Status:** ${r.status} · **Severity:** ${r.severity} · **Occurrences:** ${r.occurrence_count}`
  );
  out.push(`- **Source:** ${(r.source ?? "").slice(0, 200)}`);
  if (r.first_seen_at) out.push(`- **First seen:** ${r.first_seen_at}`);
  if (r.last_seen_at) out.push(`- **Last seen:** ${r.last_seen_at}`);
  if (r.resolved_at) out.push(`- **Resolved at:** ${r.resolved_at}`);
  if (r.error_message) {
    out.push(`- **Error:** \`${String(r.error_message).slice(0, 400).replace(/`/g, "'")}\``);
  }
  if (r.root_cause_hypothesis) out.push(`- **Root cause hypothesis:** ${r.root_cause_hypothesis}`);
  if (r.proposed_fix_summary) out.push(`- **Proposed fix:** ${r.proposed_fix_summary}`);
  const files = Array.isArray(r.proposed_fix_files) ? r.proposed_fix_files : [];
  if (files.length > 0) {
    out.push(`- **Files:**`);
    for (const f of files.slice(0, 20)) {
      const path = f?.path ?? f?.file ?? "(unknown)";
      const summary = f?.change_summary ?? f?.summary ?? "";
      out.push(`  - \`${path}\`${summary ? ` — ${summary}` : ""}`);
    }
  }
  return out;
}
