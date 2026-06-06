// @edge-public
import { createClient } from 'npm:@supabase/supabase-js@2'

import { withAuditWrapper } from "../_shared/audit.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const ALLOWED_REDIRECT_ORIGINS = new Set([
  'https://techfleetnetwork.lovable.app',
  'https://www.techfleet.network',
  'https://techfleet.network',
])

function getSafeAppOrigin(): string {
  const configured = Deno.env.get('APP_ORIGIN') || 'https://techfleetnetwork.lovable.app'
  try {
    const parsed = new URL(configured)
    if (ALLOWED_REDIRECT_ORIGINS.has(parsed.origin)) return parsed.origin
  } catch { /* ignore */ }
  return 'https://techfleetnetwork.lovable.app'
}

Deno.serve(withAuditWrapper("confirm-teacher-role", async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')
    if (!token || !/^[0-9a-f]{64}$/i.test(token)) {
      return new Response(JSON.stringify({ error: 'Invalid or missing token' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const appOrigin = getSafeAppOrigin()

    const { data: promotion, error: fetchErr } = await supabase
      .from('teacher_promotions')
      .select('id, user_id, confirmed_at')
      .eq('token', token)
      .maybeSingle()

    if (fetchErr || !promotion) {
      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders, Location: `${appOrigin}/login?teacher_confirmed=invalid` },
      })
    }

    if (promotion.confirmed_at) {
      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders, Location: `${appOrigin}/login?teacher_confirmed=already` },
      })
    }

    const { error: roleErr } = await supabase
      .from('user_roles')
      .upsert({ user_id: promotion.user_id, role: 'teacher' }, { onConflict: 'user_id,role' })

    if (roleErr) {
      console.error('Failed to grant teacher role:', roleErr)
      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders, Location: `${appOrigin}/login?teacher_confirmed=error` },
      })
    }

    await supabase.from('teacher_promotions')
      .update({ confirmed_at: new Date().toISOString() })
      .eq('id', promotion.id)

    await supabase.rpc('write_audit_log', {
      p_event_type: 'teacher_role_confirmed',
      p_table_name: 'user_roles',
      p_record_id: promotion.user_id,
      p_user_id: promotion.user_id,
      p_changed_fields: ['role:teacher'],
    })

    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: `${appOrigin}/login?teacher_confirmed=true` },
    })
  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(JSON.stringify({ error: 'An unexpected error occurred' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}))
