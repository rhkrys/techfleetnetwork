// @edge-cron
// Generic email-pipeline health probe.
//
// For every template we care about, count *truly* stuck pending sends and
// recent failed sends using the latest-status RPCs (which dedupe email_send_log
// by message_id). If anything is unhealthy, write an audit_log event with a
// fingerprintable event_type so System Health → Top Errors surfaces it.
//
// This mirrors the fix shipped for signup confirmations (where naive
// COUNT(status='pending') inflated forever as later 'sent' rows accumulated)
// and applies the same treatment to all other email pipelines.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

import { withAuditWrapper } from "../_shared/audit.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// template_name in email_send_log -> short slug used to build the event_type.
// event_type regex requires ^[a-z][a-z0-9_:-]{2,80}$ so we map dashes/underscores
// into a safe slug.
const PROBES: Array<{ template: string; slug: string }> = [
  { template: 'signup',                       slug: 'signup_confirmation' },
  { template: 'signup-confirmation-reminder', slug: 'signup_reminder' },
  { template: 'recovery',                     slug: 'password_recovery' },
  { template: 'transactional_emails',         slug: 'transactional' },
  { template: 'announcement',                 slug: 'announcement' },
  { template: 'interview-invite',             slug: 'interview_invite' },
  { template: 'project_opening_alert',        slug: 'project_opening_alert' },
  { template: 'feedback_alert',               slug: 'feedback_alert' },
  { template: 'admin_promotion',              slug: 'admin_promotion' },
]

const STUCK_AFTER_MINUTES = 15
const FAILED_WINDOW_HOURS = 24

Deno.serve(withAuditWrapper("email-pipeline-health", async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  // Service-role only. Compare the bearer token directly to the env-injected
  // service-role key. A JWT-decode fallback is intentionally NOT used — it
  // accepted any structurally valid JWT whose unsigned payload claimed
  // `role: service_role`, which is forgeable without credentials.
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!serviceRoleKey || !token || token !== serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Stuck-pending window: pending row older than 15 min is suspicious, but
  // anything older than 7 days is an orphan (queue/log mismatch from a past
  // bug, not a live failure) — exclude it so we don't trip on archeology.
  const stuckCutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60 * 1000).toISOString()
  const stuckFloor = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const failedCutoff = new Date(Date.now() - FAILED_WINDOW_HOURS * 60 * 60 * 1000).toISOString()

  const results: Array<Record<string, unknown>> = []

  for (const { template, slug } of PROBES) {
    try {
      const [stuckRes, failedRes] = await Promise.all([
        supabase.rpc('email_send_log_latest_stuck', {
          p_template_name: template, p_older_than: stuckCutoff,
        }),
        supabase.rpc('email_send_log_latest_failed', {
          p_template_name: template, p_since: failedCutoff,
        }),
      ])

      const stuckRaw = Array.isArray(stuckRes.data) ? stuckRes.data : []
      // Filter out ancient orphans (older than 7 days) — see stuckFloor comment above.
      const stuck = stuckRaw.filter((r: { created_at?: string }) => {
        if (!r?.created_at) return true
        return r.created_at >= stuckFloor
      }).length
      const failed = Array.isArray(failedRes.data) ? failedRes.data.length : 0

      const unhealthy = stuck > 0 || failed > 0
      results.push({ template, stuck, failed, unhealthy })

      if (unhealthy) {
        // De-noise: only emit one audit_log row per state-change. Look at the
        // most recent prior alert for this slug; if the (stuck, failed) tuple
        // is identical, skip — the operator already has the alert. This stops
        // the cron from drip-inserting an identical row every 15 min while
        // a stale orphan keeps tripping the probe.
        const eventType = `email_${slug}_pipeline_unhealthy`
        const expectedTag = `stuck_pending:${stuck}`
        const expectedFailedTag = `failed_last_24h:${failed}`

        const { data: prior } = await supabase
          .from('audit_log')
          .select('changed_fields, created_at')
          .eq('event_type', eventType)
          .order('created_at', { ascending: false })
          .limit(1)

        const lastRow = Array.isArray(prior) && prior.length > 0 ? prior[0] : null
        const lastFields: string[] = Array.isArray(lastRow?.changed_fields) ? lastRow!.changed_fields : []
        const sameState = lastFields.includes(expectedTag) && lastFields.includes(expectedFailedTag)

        // Always re-emit if last alert is older than 24h (heartbeat), even if state is identical.
        const lastAt = lastRow?.created_at ? new Date(lastRow.created_at).getTime() : 0
        const stale = Date.now() - lastAt > 24 * 60 * 60 * 1000

        if (!sameState || stale) {
          const summary = `${template} email pipeline degraded — stuck_pending:${stuck} · failed_last_24h:${failed}`
          await supabase.rpc('write_audit_log', {
            p_event_type: eventType,
            p_table_name: 'email_send_log',
            p_record_id: null,
            p_user_id: null,
            p_changed_fields: [
              expectedTag,
              expectedFailedTag,
              `template:${slug}`,
            ],
            p_error_message: summary,
          })
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[email-pipeline-health] probe failed', { template, error: msg })
      results.push({ template, error: msg })
    }
  }

  // ---- Audit-log volume pressure (no new cron) ----
  // Cheap aggregate: count last 5 minutes, project to 24h, classify.
  let auditPressure: 'none' | 'soft' | 'medium' | 'hard' = 'none'
  let projected24h = 0
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { count } = await supabase
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', fiveMinAgo)
    const writes5m = count ?? 0
    projected24h = writes5m * 12 * 24
    if (projected24h >= 50000) auditPressure = 'hard'
    else if (projected24h >= 35000) auditPressure = 'medium'
    else if (projected24h >= 20000) auditPressure = 'soft'

    // Merge into system_health_state.metadata without clobbering other keys.
    const { data: existing } = await supabase
      .from('system_health_state')
      .select('metadata')
      .eq('id', 1)
      .maybeSingle()
    const meta = (existing?.metadata ?? {}) as Record<string, unknown>
    const prev = meta.audit_pressure as typeof auditPressure | undefined
    const nextMeta = {
      ...meta,
      audit_pressure: auditPressure,
      audit_writes_5m: writes5m,
      audit_projected_24h: projected24h,
      audit_pressure_updated_at: new Date().toISOString(),
    }
    await supabase.from('system_health_state').update({ metadata: nextMeta }).eq('id', 1)

    if (prev !== auditPressure && (auditPressure !== 'none' || prev)) {
      await supabase.rpc('write_audit_log', {
        p_event_type: 'audit_pressure_changed',
        p_table_name: 'system_health_state',
        p_record_id: '1',
        p_user_id: null,
        p_changed_fields: [
          `from:${prev ?? 'none'}`,
          `to:${auditPressure}`,
          `projected_24h:${projected24h}`,
        ],
        p_error_message: `audit_log volume pressure transitioned ${prev ?? 'none'} → ${auditPressure}`,
      })
    }
  } catch (err) {
    console.error('[email-pipeline-health] audit pressure probe failed', err)
  }

  return new Response(JSON.stringify({ ok: true, probed: PROBES.length, results, audit_pressure: auditPressure, audit_projected_24h: projected24h }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}))
