// @edge-auth
import { queueTransactionalEmail } from '../_shared/transactional-email.ts'
import { z } from 'npm:zod@3.23.8'

import { withAuditWrapper } from "../_shared/audit.ts";

const BodySchema = z.object({}).passthrough();
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

Deno.serve(withAuditWrapper("send-transactional-email", async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // --- Service role key validation (internal only) ---
  const authHeader = req.headers.get('Authorization')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authHeader || !serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
  // --- End auth ---

  // Parse request body
  let templateName: string
  let recipientEmail: string
  let idempotencyKey: string
  let messageId: string | undefined
  let templateData: Record<string, unknown> = {}
  try {
    const _raw = await req.json()
    const _parsed = BodySchema.safeParse(_raw)
    const body: any = _parsed.success ? _parsed.data : {}
    templateName = body.templateName || body.template_name
    recipientEmail = body.recipientEmail || body.recipient_email
    messageId = body.messageId || body.message_id
    idempotencyKey = body.idempotencyKey || body.idempotency_key || messageId
    if (body.templateData && typeof body.templateData === 'object') {
      templateData = body.templateData as Record<string, unknown>
    }
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON in request body' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (!templateName) {
    return new Response(
      JSON.stringify({ error: 'templateName is required' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  const result = await queueTransactionalEmail({
    templateName,
    recipientEmail,
    idempotencyKey,
    messageId,
    templateData,
  })

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: result.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (result.suppressed) {
    return new Response(
      JSON.stringify({ success: false, reason: result.reason }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  return new Response(
    JSON.stringify({ success: true, queued: true, messageId: result.messageId, deduped: result.deduped === true }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  )
}))
