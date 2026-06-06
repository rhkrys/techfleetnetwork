// @edge-public
import { createClient } from 'npm:@supabase/supabase-js@2'

import { withAuditWrapper } from "../_shared/audit.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

/** Allowed redirect origins — prevents open redirect (OWASP A01) */
const ALLOWED_REDIRECT_ORIGINS = new Set([
  'https://techfleetnetwork.lovable.app',
])

function getSafeAppOrigin(): string {
  const configured = Deno.env.get('APP_ORIGIN') || 'https://techfleetnetwork.lovable.app'
  try {
    const parsed = new URL(configured)
    if (ALLOWED_REDIRECT_ORIGINS.has(parsed.origin)) return parsed.origin
  } catch { /* invalid URL */ }
  return 'https://techfleetnetwork.lovable.app'
}

Deno.serve(withAuditWrapper("confirm-admin-role", async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Only allow GET for confirmation links (OWASP A05)
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')

    // Validate token format: must be 64-char hex (32 bytes encoded)
    if (!token || typeof token !== 'string' || !/^[0-9a-f]{64}$/i.test(token)) {
      return new Response(
        JSON.stringify({ error: 'Invalid or missing token' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const appOrigin = getSafeAppOrigin()

    // Verify the token via SECURITY DEFINER function which compares against
    // the SHA-256 hash stored in admin_promotions.token_hash. This prevents
    // a DB read leak from exposing the plaintext token of pending promotions.
    const { data: rows, error: fetchErr } = await supabase
      .rpc('verify_admin_promotion_token', { p_token: token })

    const promotion = Array.isArray(rows) ? rows[0] : null

    if (fetchErr || !promotion) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired confirmation link' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (promotion.confirmed_at) {
      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders, Location: `${appOrigin}/login?admin_confirmed=already` },
      })
    }

    // Grant the admin role
    const { error: roleErr } = await supabase
      .from('user_roles')
      .upsert({ user_id: promotion.user_id, role: 'admin' }, { onConflict: 'user_id,role' })

    if (roleErr) {
      console.error('Failed to grant admin role:', roleErr)
      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders, Location: `${appOrigin}/login?admin_confirmed=error` },
      })
    }

    // Mark promotion as confirmed
    await supabase
      .from('admin_promotions')
      .update({ confirmed_at: new Date().toISOString() })
      .eq('id', promotion.id)

    // Audit log
    await supabase.rpc('write_audit_log', {
      p_event_type: 'admin_role_confirmed',
      p_table_name: 'user_roles',
      p_record_id: promotion.user_id,
      p_user_id: promotion.user_id,
      p_changed_fields: ['role:admin'],
    })

    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: `${appOrigin}/login?admin_confirmed=true` },
    })
  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}))