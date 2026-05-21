// Refreshes the email_health_snapshot materialized view and rolls up
// 7-day complaint / bounce rates into email_domain_health. Auto-pauses
// bulk sending if complaint rate > 0.1% or bounce rate > 2% (Phase 3.3 / 5.3).
// Runs every 15 min via pg_cron.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    return new Response(JSON.stringify({ error: 'Server config error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || authHeader !== `Bearer ${key}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(url, key)

  // 1. Refresh the snapshot MV (best-effort).
  const { error: refreshErr } = await supabase.rpc('refresh_email_health_snapshot')
  if (refreshErr) {
    console.error('refresh_email_health_snapshot failed', refreshErr)
  }

  // 2. Compute 7-day rolling rates from email_send_log (dedup by message_id).
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { data: rates, error: ratesErr } = await supabase.rpc(
    'compute_email_domain_health',
    { p_since: since }
  )

  if (ratesErr) {
    console.error('compute_email_domain_health failed', ratesErr)
    return new Response(JSON.stringify({ error: ratesErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const row = Array.isArray(rates) && rates.length > 0 ? rates[0] : null
  if (!row) {
    return new Response(JSON.stringify({ ok: true, empty: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  await supabase.from('email_domain_health').insert({
    window_start: since,
    window_end: new Date().toISOString(),
    sent: row.sent ?? 0,
    bounced: row.bounced ?? 0,
    complained: row.complained ?? 0,
    complaint_rate: row.complaint_rate ?? 0,
    bounce_rate: row.bounce_rate ?? 0,
  })

  // 3. Auto-pause if rates breach thresholds.
  const complaintRate = Number(row.complaint_rate ?? 0)
  const bounceRate = Number(row.bounce_rate ?? 0)
  const shouldPause = complaintRate > 0.001 || bounceRate > 0.02

  if (shouldPause) {
    await supabase
      .from('email_send_state')
      .update({ bulk_paused: true, updated_at: new Date().toISOString() })
      .eq('id', 1)
    console.warn('Bulk email auto-paused', { complaintRate, bounceRate })
  }

  return new Response(JSON.stringify({
    ok: true,
    sent: row.sent,
    complaintRate,
    bounceRate,
    paused: shouldPause,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
