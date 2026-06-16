// @edge-public
import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { parseEmailWebhookPayload } from 'npm:@lovable.dev/email-js'
import { WebhookError, verifyWebhookRequest } from 'npm:@lovable.dev/webhooks-js'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { withAuditWrapper } from "../_shared/audit.ts";
import { SignupEmail } from '../_shared/email-templates/signup.tsx'
import { InviteEmail } from '../_shared/email-templates/invite.tsx'
import { MagicLinkEmail } from '../_shared/email-templates/magic-link.tsx'
import { RecoveryEmail } from '../_shared/email-templates/recovery.tsx'
import { EmailChangeEmail } from '../_shared/email-templates/email-change.tsx'
import { ReauthenticationEmail } from '../_shared/email-templates/reauthentication.tsx'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-request-id, x-trace-id, x-lovable-signature, x-lovable-timestamp, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: 'Confirm your Tech Fleet email',
  invite: 'You were invited to Tech Fleet',
  magiclink: 'Sign in to Tech Fleet',
  recovery: 'Reset your Tech Fleet password',
  email_change: 'Confirm your new email',
  reauthentication: 'Your verification code',
}

// Template mapping
const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
}

// Configuration
const SITE_NAME = "Tech Fleet"
const APP_ORIGIN = "https://techfleet.network"
const SENDER_DOMAIN = "notify.techfleet.org"
const ROOT_DOMAIN = "techfleet.network"
const FROM_DOMAIN = "techfleet.org" // Domain shown in From address (may be root or sender subdomain)
const FROM_MAILBOX = "onboarding"
const REPLY_TO = "onboarding@techfleet.org"
const DEDUP_WINDOW_SECONDS = 60
const ALLOWED_RESET_ORIGINS = new Set([
  "https://techfleet.network",
  "https://www.techfleet.network",
  "https://techfleetnetwork.lovable.app",
])

// Sample data for preview mode ONLY (not used in actual email sending).
// URLs are baked in at scaffold time from the project's real data.
// The sample email uses a fixed placeholder (RFC 6761 .test TLD) so the Go backend
// can always find-and-replace it with the actual recipient when sending test emails,
// even if the project's domain has changed since the template was scaffolded.
const SAMPLE_PROJECT_URL = APP_ORIGIN
const SAMPLE_EMAIL = "user@example.test"
const SAMPLE_DATA: Record<string, object> = {
  signup: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  magiclink: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  recovery: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  invite: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  email_change: {
    siteName: SITE_NAME,
    oldEmail: SAMPLE_EMAIL,
    email: SAMPLE_EMAIL,
    newEmail: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  reauthentication: {
    token: '123456',
  },
}

// Preview endpoint handler - returns rendered HTML without sending email
async function handlePreview(req: Request): Promise<Response> {
  const previewCorsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: previewCorsHeaders })
  }

  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  const authHeader = req.headers.get('Authorization')

  if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let type: string
  try {
    const body = await req.json()
    type = body.type
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const EmailTemplate = EMAIL_TEMPLATES[type]

  if (!EmailTemplate) {
    return new Response(JSON.stringify({ error: `Unknown email type: ${type}` }), {
      status: 400,
      headers: { ...previewCorsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const sampleData = SAMPLE_DATA[type] || {}
  const html = await renderAsync(React.createElement(EmailTemplate, sampleData))

  return new Response(html, {
    status: 200,
    headers: { ...previewCorsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

// Webhook handler - verifies signature and sends email
async function handleWebhook(req: Request): Promise<Response> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY')

  if (!apiKey) {
    console.error('LOVABLE_API_KEY not configured')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // Verify signature + timestamp, then parse payload.
  let payload: any
  let run_id = ''
  try {
    const verified = await verifyWebhookRequest({
      req,
      secret: apiKey,
      parser: parseEmailWebhookPayload,
    })
    payload = verified.payload
    run_id = payload.run_id
  } catch (error) {
    if (error instanceof WebhookError) {
      switch (error.code) {
        case 'invalid_signature':
        case 'missing_timestamp':
        case 'invalid_timestamp':
        case 'stale_timestamp':
          console.error('Invalid webhook signature', { error: error.message })
          return new Response(JSON.stringify({ error: 'Invalid signature' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        case 'invalid_payload':
        case 'invalid_json':
          console.error('Invalid webhook payload', { error: error.message })
          return new Response(
            JSON.stringify({ error: 'Invalid webhook payload' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
      }
    }

    console.error('Webhook verification failed', { error })
    return new Response(
      JSON.stringify({ error: 'Invalid webhook payload' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  if (!run_id) {
    console.error('Webhook payload missing run_id')
    return new Response(
      JSON.stringify({ error: 'Invalid webhook payload' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (payload.version !== '1') {
    console.error('Unsupported payload version', { version: payload.version, run_id })
    return new Response(
      JSON.stringify({ error: `Unsupported payload version: ${payload.version}` }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // The email action type is in payload.data.action_type (e.g., "signup", "recovery")
  // payload.type is the hook event type ("auth")
  const emailType = payload.data.action_type
  console.log('Received auth event', { emailType, email: payload.data.email, run_id })

  const EmailTemplate = EMAIL_TEMPLATES[emailType]
  if (!EmailTemplate) {
    console.error('Unknown email type', { emailType, run_id })
    return new Response(
      JSON.stringify({ error: `Unknown email type: ${emailType}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  let confirmationUrl: string = payload.data.url
  let recoveryRewriteOk = false
  if (emailType === 'recovery') {
    try {
      const verifyUrl = new URL(payload.data.url)
      const tokenHash =
        verifyUrl.searchParams.get('token_hash') ||
        verifyUrl.searchParams.get('token') ||
        payload.data.token_hash ||
        payload.data.token
      const rawRedirectTo = verifyUrl.searchParams.get('redirect_to') || payload.data.redirect_to || `${APP_ORIGIN}/reset-password`
      const redirectTo = new URL(rawRedirectTo)
      const origin = ALLOWED_RESET_ORIGINS.has(redirectTo.origin) ? redirectTo.origin : APP_ORIGIN
      if (tokenHash) {
        // AUTH-RESET-PREFETCH-001: point email at the inert confirm page.
        // SafeLinks/Proofpoint/link previews can GET this route without
        // consuming the single-use token; only the human button click forwards
        // to /reset-password with reset_intent=confirm, where verifyOtp runs.
        const target = new URL('/reset-password/confirm', origin)
        target.searchParams.set('token_hash', tokenHash)
        target.searchParams.set('type', 'recovery')
        confirmationUrl = target.toString()
        recoveryRewriteOk = true
      }
    } catch (rewriteErr) {
      console.error('Recovery URL rewrite failed, falling back to default', { error: rewriteErr, run_id })
    }

    // AUTH-RESET-SESSION-005: fail-loud telemetry when recovery link shape is
    // unsafe (no token_hash extractable). No PII, no token content.
    if (!recoveryRewriteOk) {
      try {
        const admin = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )
        await admin.rpc('record_event', {
          p_sink: 'ops_events',
          p_kind: 'auth.recovery_link.unsafe_shape',
          p_actor: null,
          p_payload: {
            run_id,
            email_domain: (payload.data.email || '').split('@')[1] || null,
            has_url: Boolean(payload.data.url),
          },
          p_severity: 'warn',
          p_source_table: 'auth-email-hook',
        })
      } catch (telemetryErr) {
        console.error('record_event failed for recovery_link.unsafe_shape', { error: telemetryErr, run_id })
      }
    }
  }

  // Build template props from payload.data (HookData structure)
  const templateProps = {
    siteName: SITE_NAME,
    siteUrl: APP_ORIGIN,
    recipient: payload.data.email,
    confirmationUrl,
    token: payload.data.token,
    email: payload.data.email,
    oldEmail: payload.data.old_email,
    newEmail: payload.data.new_email,
  }

  // Render React Email to HTML and plain text
  const html = await renderAsync(React.createElement(EmailTemplate, templateProps))
  const text = await renderAsync(React.createElement(EmailTemplate, templateProps), {
    plainText: true,
  })

  // Enqueue email for async processing by the dispatcher (process-email-queue).
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const messageId = crypto.randomUUID()
  const normalizedEmail = (payload.data.email || '').trim().toLowerCase()
  let unsubscribeToken: string | null = null

  const cooldownSinceIso = new Date(Date.now() - DEDUP_WINDOW_SECONDS * 1000).toISOString()
  const { data: recent } = await supabase
    .from('email_send_log')
    .select('id')
    .eq('recipient_email', payload.data.email)
    .eq('template_name', emailType)
    .in('status', ['pending', 'sent'])
    .gte('created_at', cooldownSinceIso)
    .limit(1)

  if (recent && recent.length > 0) {
    console.log('Auth email dedup hit — dropping duplicate send', { emailType, email: payload.data.email })
    return new Response(JSON.stringify({ success: true, deduped: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Mint (or fetch) the unsubscribe token in ONE atomic round-trip.
  //
  // The previous read → upsert(ignoreDuplicates) → re-read pattern had a
  // data-race: if the upsert returned a transient PostgREST error
  // (PGRST002 schema-cache, 57014 statement timeout, etc.) the recovery
  // re-SELECT would also fail and overwrite the freshly generated token
  // with `null`, producing a synthetic "Failed to mint unsubscribe token"
  // email_send_log row that flooded the Triage queue.
  //
  // `onConflict:'email'` + `ignoreDuplicates:false` + `.select('token').single()`
  // is a single ON CONFLICT DO UPDATE roundtrip: it returns the canonical
  // row (existing or newly inserted) atomically, regardless of any race.
  // The unique constraint on `email` guarantees exactly one row.
  // See bdd_scenarios TRIAGE-ROOT-004.
  const freshToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const { data: tokenRow, error: tokenError } = await supabase
    .from('email_unsubscribe_tokens')
    .upsert(
      { email: normalizedEmail, token: freshToken },
      { onConflict: 'email', ignoreDuplicates: false },
    )
    .select('token')
    .single()

  unsubscribeToken = tokenRow?.token ?? null

  if (tokenError || !unsubscribeToken) {
    // Do NOT write a synthetic email_send_log status='failed' row here.
    // That generates an event_type='email_failed' audit_log entry which
    // discover_audit_fingerprints (correctly) classifies as actionable —
    // but the underlying cause is almost always a transient PostgREST
    // schema-cache blip, not a code defect. Fail the request so the
    // caller (Supabase auth hook) can retry, and surface the real cause
    // in the error message for log inspection.
    console.error('mint_unsubscribe_token failed', {
      email: payload.data.email,
      code: (tokenError as { code?: string } | null)?.code,
      message: tokenError?.message,
    })
    return new Response(
      JSON.stringify({
        error: `mint_unsubscribe_token: ${tokenError?.message ?? 'no_row_returned'}`,
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  // ── Email subsystem v2 strangler fig (auth lane) ─────────────────────────
  // When pipeline_v2_lanes_bitmask has bit 1 set, route auth emails through
  // the new Outbox. Same external contract; legacy path below is the fallback
  // until Phase 4 decommission.
  try {
    const { buildEmailContainer, isV2Enabled } = await import('../_shared/email/composition.ts')
    if (await isV2Enabled(supabase, 'auth')) {
      const { enqueueEmail } = buildEmailContainer(supabase)
      const out = await enqueueEmail({
        template: emailType,
        recipient: payload.data.email,
        subject: EMAIL_SUBJECTS[emailType] || 'Notification',
        payload: {
          run_id,
          html,
          text,
          from: `${SITE_NAME} <${FROM_MAILBOX}@${FROM_DOMAIN}>`,
          reply_to: REPLY_TO,
          sender_domain: SENDER_DOMAIN,
          purpose: 'transactional',
          label: emailType,
          unsubscribe_token: unsubscribeToken,
        },
        idempotencyKey: messageId,
        messageId,
        laneOverride: 'auth',
      })
      await supabase.from('email_send_log').insert({
        message_id: out.messageId,
        template_name: emailType,
        recipient_email: payload.data.email,
        status: out.suppressed ? 'suppressed' : 'pending',
      })
      return new Response(JSON.stringify({ ok: true, queued: true, v2: true, messageId: out.messageId }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  } catch (e) {
    console.warn('email v2 auth path errored — falling back to legacy', { err: String(e) })
  }
  // ── End v2 strangler fig ─────────────────────────────────────────────────

  // Log pending BEFORE enqueue so we have a record even if enqueue crashes
  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: emailType,
    recipient_email: payload.data.email,
    status: 'pending',
  })

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'auth_emails',
    payload: {
      run_id,
      message_id: messageId,
      to: payload.data.email,
      from: `${SITE_NAME} <${FROM_MAILBOX}@${FROM_DOMAIN}>`,
      reply_to: REPLY_TO,
      sender_domain: SENDER_DOMAIN,
      subject: EMAIL_SUBJECTS[emailType] || 'Notification',
      html,
      text,
      purpose: 'transactional',
      label: emailType,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  })


  if (enqueueError) {
    console.error('Failed to enqueue auth email', { error: enqueueError, run_id, emailType })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: emailType,
      recipient_email: payload.data.email,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })
    return new Response(JSON.stringify({ error: 'Failed to enqueue email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  console.log('Auth email enqueued', { emailType, email: payload.data.email, run_id })

  return new Response(
    JSON.stringify({ success: true, queued: true }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

Deno.serve(withAuditWrapper("auth-email-hook", async (req) => {
  const url = new URL(req.url)

  // Handle CORS preflight for main endpoint
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Route to preview handler for /preview path
  if (url.pathname.endsWith('/preview')) {
    return handlePreview(req)
  }

  // Main webhook handler
  try {
    return await handleWebhook(req)
  } catch (error) {
    console.error('Webhook handler error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}))
