// @edge-public
import { createClient } from 'npm:@supabase/supabase-js@2'
import { z } from 'npm:zod@4.3.6'

import { withAuditWrapper } from "../_shared/audit.ts";

// M-01: Lenient shape guard. Existing String() coercion + self-revoke check below stay authoritative.
const BodySchema = z.object({ user_id: z.unknown().optional() }).passthrough()
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(withAuditWrapper("revoke-teacher-role", async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(supabaseUrl, serviceRoleKey)
    const { data: isAdmin } = await admin.rpc('has_role', { _user_id: caller.id, _role: 'admin' })
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const rawBody = await req.json().catch(() => ({}))
    const parsedBody = BodySchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return new Response(JSON.stringify({ error: 'Invalid body' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const body = parsedBody.data as Record<string, unknown>
    const targetUserId = String(body.user_id ?? '')
    if (!targetUserId) {
      return new Response(JSON.stringify({ error: 'user_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (targetUserId === caller.id) {
      return new Response(JSON.stringify({ error: 'Cannot revoke your own teacher role' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { error: delErr } = await admin
      .from('user_roles')
      .delete()
      .eq('user_id', targetUserId)
      .eq('role', 'teacher')
    if (delErr) throw delErr

    return new Response(JSON.stringify({ ok: true, message: 'Teacher role revoked' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}))
