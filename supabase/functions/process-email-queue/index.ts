import { sendLovableEmail } from 'npm:@lovable.dev/email-js'
import { createClient } from 'npm:@supabase/supabase-js@2'

import { withAuditWrapper } from "../_shared/audit.ts";
const MAX_RETRIES = 5
const DEFAULT_BATCH_SIZE = 10
const DEFAULT_SEND_DELAY_MS = 200
const DEFAULT_AUTH_TTL_MINUTES = 15
const DEFAULT_TRANSACTIONAL_TTL_MINUTES = 60
// Global workspace pacer: minimum gap between provider API calls across ALL
// lanes within a single invocation. Sized to the Lovable Email per-workspace
// quota (~2 sends/sec). Without this, lane priority correctly drains auth
// first but bursts within a lane can still trip the workspace-wide rate
// limit, which then mis-attributes to whichever lane reads the 429 next.
// Paired with cross-lane 429 attribution below to keep cooldowns on the
// actual offender.
const MIN_GLOBAL_GAP_MS = 500

// Check if an error is a rate-limit (429) response.
// Uses EmailAPIError.status when available (email-js >=0.x with structured errors),
// falls back to parsing the error message for older versions.
function isRateLimited(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    return (error as { status: number }).status === 429
  }
  return error instanceof Error && error.message.includes('429')
}

// Check if an error is a forbidden (403) response. Retrying won't help.
// Move straight to DLQ.
function isForbidden(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    return (error as { status: number }).status === 403
  }
  return error instanceof Error && error.message.includes('403')
}

// Extract Retry-After seconds from a structured EmailAPIError, or default to 60s.
function getRetryAfterSeconds(error: unknown): number {
  if (error && typeof error === 'object' && 'retryAfterSeconds' in error) {
    return (error as { retryAfterSeconds: number | null }).retryAfterSeconds ?? 60
  }
  return 60
}

function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2) {
    return null
  }

  try {
    const payload = parts[1]
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=')

    return JSON.parse(atob(payload)) as Record<string, unknown>
  } catch {
    return null
  }
}

// Move a message to the dead letter queue and log the reason.
//
// `eventType` controls the audit_log routing:
//   - 'email_dlq' (default for TTL / max-retry / 403): healthy guardrail event,
//     blocked from agent_fix_queue by block_non_actionable_fix_queue_inserts.
//   - 'edge_invoke_failed': use for unexpected send failures that should be
//     triaged. Currently unused here because we only reach the DLQ via the
//     three guardrail branches above.
async function moveToDlq(
  supabase: ReturnType<typeof createClient>,
  queue: string,
  msg: { msg_id: number; message: Record<string, unknown> },
  reason: string,
  eventType: 'email_dlq' | 'edge_invoke_failed' = 'email_dlq'
): Promise<void> {
  const payload = msg.message
  await supabase.from('email_send_log').insert({
    message_id: payload.message_id,
    template_name: (payload.label || queue) as string,
    recipient_email: payload.to,
    status: 'dlq',
    error_message: reason,
  })
  // Audit trail for admins (System Health > Email tab). Service-role context
  // means auth.uid() is null, which write_audit_log accepts.
  await supabase.rpc('write_audit_log', {
    p_event_type: eventType,
    p_table_name: 'email_queue',
    p_record_id: String(payload.message_id ?? msg.msg_id),
    p_user_id: null,
    p_error_message: reason,
    p_changed_fields: [`queue:${queue}`, `template:${String(payload.label ?? queue)}`],
  })
  const { error } = await supabase.rpc('move_to_dlq', {
    source_queue: queue,
    dlq_name: `${queue}_dlq`,
    message_id: msg.msg_id,
    payload,
  })
  if (error) {
    console.error('Failed to move message to DLQ', { queue, msg_id: msg.msg_id, reason, error })
  }
}


Deno.serve(withAuditWrapper("process-email-queue", async (req) => {
  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!apiKey || !supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Defense in depth: only service-role callers can trigger queue processing.
  // Supports both legacy JWT tokens (claims.role === 'service_role') and the
  // new signing-keys format (sb_secret_... opaque tokens, compared to the
  // SUPABASE_SERVICE_ROLE_KEY env var).
  const token = authHeader.slice('Bearer '.length).trim()
  const claims = parseJwtClaims(token)
  const isLegacyServiceRoleJwt = claims?.role === 'service_role'
  const isOpaqueServiceRoleKey = token === supabaseServiceKey
  if (!isLegacyServiceRoleJwt && !isOpaqueServiceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'Forbidden' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // 1. Read queue config + per-queue cooldown state.
  // Per-queue cooldown ensures a 429 on one lane does NOT freeze the others.
  // Three lanes (priority order): auth_emails → transactional_emails → bulk_emails.
  const { data: state } = await supabase
    .from('email_send_state')
    .select('retry_after_until, auth_retry_after_until, transactional_retry_after_until, bulk_retry_after_until, auth_consecutive_rate_limits, transactional_consecutive_rate_limits, bulk_consecutive_rate_limits, batch_size, send_delay_ms, bulk_batch_size, bulk_send_delay_ms, auth_email_ttl_minutes, transactional_email_ttl_minutes, bulk_email_ttl_minutes, bulk_hourly_cap, bulk_paused, per_recipient_bulk_window_hours, per_recipient_bulk_max')
    .single()

  const cooldownCols: Record<string, string> = {
    auth_emails: 'auth_retry_after_until',
    transactional_emails: 'transactional_retry_after_until',
    bulk_emails: 'bulk_retry_after_until',
  }
  const counterCols: Record<string, string> = {
    auth_emails: 'auth_consecutive_rate_limits',
    transactional_emails: 'transactional_consecutive_rate_limits',
    bulk_emails: 'bulk_consecutive_rate_limits',
  }
  // Legacy global retry_after_until is treated as a floor for backward compatibility.
  const legacyCooldown = (state as any)?.retry_after_until ?? null
  const cooldownUntil: Record<string, string | null> = {
    auth_emails: (state as any)?.auth_retry_after_until ?? legacyCooldown,
    transactional_emails: (state as any)?.transactional_retry_after_until ?? legacyCooldown,
    bulk_emails: (state as any)?.bulk_retry_after_until ?? null,
  }
  const consecutive: Record<string, number> = {
    auth_emails: (state as any)?.auth_consecutive_rate_limits ?? 0,
    transactional_emails: (state as any)?.transactional_consecutive_rate_limits ?? 0,
    bulk_emails: (state as any)?.bulk_consecutive_rate_limits ?? 0,
  }

  const txBatchSize = state?.batch_size ?? DEFAULT_BATCH_SIZE
  const txBaseDelayMs = state?.send_delay_ms ?? DEFAULT_SEND_DELAY_MS
  const bulkBatchSize = (state as any)?.bulk_batch_size ?? 3
  const bulkBaseDelayMs = (state as any)?.bulk_send_delay_ms ?? 1000
  const batchSizeByQueue: Record<string, number> = {
    auth_emails: txBatchSize,
    transactional_emails: txBatchSize,
    bulk_emails: bulkBatchSize,
  }
  const baseDelayByQueue: Record<string, number> = {
    auth_emails: txBaseDelayMs,
    transactional_emails: txBaseDelayMs,
    bulk_emails: bulkBaseDelayMs,
  }
  const bulkHourlyCap = state?.bulk_hourly_cap ?? 50
  const bulkPaused = state?.bulk_paused === true
  const perRecipientWindowHours = state?.per_recipient_bulk_window_hours ?? 24
  const perRecipientMax = state?.per_recipient_bulk_max ?? 1
  const ttlMinutes: Record<string, number> = {
    auth_emails: state?.auth_email_ttl_minutes ?? DEFAULT_AUTH_TTL_MINUTES,
    transactional_emails: state?.transactional_email_ttl_minutes ?? DEFAULT_TRANSACTIONAL_TTL_MINUTES,
    bulk_emails: (state as any)?.bulk_email_ttl_minutes ?? 240,
  }

  // Two distinct bulk categories — both live on the dedicated `bulk_emails`
  // lane so a 429 there can never block auth or 1:1 transactional sends:
  // - BULK_DELIVERABILITY_TEMPLATES: solicited but promotional digests/blasts.
  //   Subject to per-recipient frequency cap to protect sender reputation.
  // - BROADCAST_TEMPLATES: explicit opt-in 1:N broadcasts (announcements).
  //   Members signed up to receive these — NEVER apply a per-recipient cap.
  // Both share the global hourly cap + bulk_paused circuit breaker + suppression
  // list + RFC 8058 unsubscribe headers.
  const BULK_DELIVERABILITY_TEMPLATES = new Set(['project-blast', 'fleety-coach-digest'])
  const BROADCAST_TEMPLATES = new Set(['announcement'])
  const ALL_BULK_TEMPLATES = new Set<string>([
    ...BULK_DELIVERABILITY_TEMPLATES,
    ...BROADCAST_TEMPLATES,
  ])
  const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const windowAgoIso = new Date(Date.now() - perRecipientWindowHours * 60 * 60 * 1000).toISOString()
  let bulkSentLastHour = 0
  if (!bulkPaused) {
    const { count } = await supabase
      .from('email_send_log')
      .select('id', { count: 'exact', head: true })
      .in('template_name', Array.from(ALL_BULK_TEMPLATES))
      .eq('status', 'sent')
      .gte('created_at', oneHourAgoIso)
    bulkSentLastHour = count ?? 0
  }

  let totalProcessed = 0
  // Tracks the lane whose last send hit the provider successfully. When a 429
  // arrives with a workspace-scoped rate-limit key, the offender is whoever
  // sent immediately before — NOT necessarily the lane that received the 429.
  // Without this attribution, every shared-quota 429 would mis-blame the
  // lane that happens to drain next (typically transactional, which drains
  // right after an auth burst).
  let lastSentLane: string | null = null
  // Global workspace pacer state: timestamp of the most recent provider call
  // across all lanes within this invocation.
  let lastGlobalSendAt = 0

  // 2. Process queues in fixed priority order.
  for (const queue of ['auth_emails', 'transactional_emails', 'bulk_emails']) {
    if (cooldownUntil[queue] && new Date(cooldownUntil[queue] as string) > new Date()) {
      console.log('Skipping queue (cooldown active)', { queue, until: cooldownUntil[queue] })
      continue
    }
    // Bulk lane respects the global pause switch.
    if (queue === 'bulk_emails' && bulkPaused) {
      console.log('Bulk lane paused via email_send_state.bulk_paused')
      continue
    }
    // Adaptive send delay: if this queue is recovering from 429s, slow down.
    const sendDelayMs = baseDelayByQueue[queue] * Math.pow(2, Math.min(consecutive[queue] ?? 0, 4))
    const batchSize = batchSizeByQueue[queue]

    const { data: messages, error: readError } = await supabase.rpc('read_email_batch', {
      queue_name: queue,
      batch_size: batchSize,
      vt: 30,
    })

    if (readError) {
      console.error('Failed to read email batch', { queue, error: readError })
      continue
    }

    if (!messages?.length) continue

    // Retry budget is based on real send failures, not pgmq read_ct.
    // read_ct increments for every message in a claimed batch, including
    // messages not attempted when a 429 stops processing early.
    const messageIds = Array.from(
      new Set(
        messages
          .map((msg) =>
            msg?.message?.message_id && typeof msg.message.message_id === 'string'
              ? msg.message.message_id
              : null
          )
          .filter((id): id is string => Boolean(id))
      )
    )
    const failedAttemptsByMessageId = new Map<string, number>()
    if (messageIds.length > 0) {
      const { data: failedRows, error: failedRowsError } = await supabase
        .from('email_send_log')
        .select('message_id')
        .in('message_id', messageIds)
        .eq('status', 'failed')

      if (failedRowsError) {
        console.error('Failed to load failed-attempt counters', {
          queue,
          error: failedRowsError,
        })
      } else {
        for (const row of failedRows ?? []) {
          const messageId = row?.message_id
          if (typeof messageId !== 'string' || !messageId) continue
          failedAttemptsByMessageId.set(
            messageId,
            (failedAttemptsByMessageId.get(messageId) ?? 0) + 1
          )
        }
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      const payload = msg.message
      const failedAttempts =
        payload?.message_id && typeof payload.message_id === 'string'
          ? (failedAttemptsByMessageId.get(payload.message_id) ?? 0)
          : msg.read_ct ?? 0

      // Drop expired messages (TTL exceeded).
      // Prefer payload.queued_at when present; fall back to PGMQ's enqueued_at
      // which is always set by the queue.
      const queuedAt = payload.queued_at ?? msg.enqueued_at
      if (queuedAt) {
        const ageMs = Date.now() - new Date(queuedAt).getTime()
        const maxAgeMs = ttlMinutes[queue] * 60 * 1000
        if (ageMs > maxAgeMs) {
          console.warn('Email expired (TTL exceeded)', {
            queue,
            msg_id: msg.msg_id,
            queued_at: queuedAt,
            ttl_minutes: ttlMinutes[queue],
          })
          await moveToDlq(supabase, queue, msg, `TTL exceeded (${ttlMinutes[queue]} minutes)`)
          continue
        }
      }

      // Move to DLQ if max failed send attempts reached.
      if (failedAttempts >= MAX_RETRIES) {
        await moveToDlq(supabase, queue, msg, `Max retries (${MAX_RETRIES}) exceeded (attempted ${failedAttempts} times)`)
        continue
      }

      // Guard: skip if another worker already sent this message (VT expired race)
      if (payload.message_id) {
        const { data: alreadySent } = await supabase
          .from('email_send_log')
          .select('id')
          .eq('message_id', payload.message_id)
          .eq('status', 'sent')
          .maybeSingle()

        if (alreadySent) {
          console.warn('Skipping duplicate send (already sent)', {
            queue,
            msg_id: msg.msg_id,
            message_id: payload.message_id,
          })
          const { error: dupDelError } = await supabase.rpc('delete_email', {
            queue_name: queue,
            message_id: msg.msg_id,
          })
          if (dupDelError) {
            console.error('Failed to delete duplicate message from queue', { queue, msg_id: msg.msg_id, error: dupDelError })
          }
          continue
        }
      }

      // Bulk template gating: skip (leave in queue) if paused or hourly cap reached.
      // Per-recipient frequency cap applies ONLY to deliverability-sensitive
      // bulk templates (project-blast, fleety-coach-digest). Announcements
      // are opt-in broadcasts and bypass the per-recipient cap.
      const labelStr = typeof payload.label === 'string' ? payload.label : ''
      const isAnyBulk = ALL_BULK_TEMPLATES.has(labelStr)
      const isDeliverabilityBulk = BULK_DELIVERABILITY_TEMPLATES.has(labelStr)
      const bypassCap = payload?.bypass_frequency_cap === true
      if (isAnyBulk) {
        if (bulkPaused) {
          console.log('Bulk send paused — leaving message in queue', { msg_id: msg.msg_id })
          continue
        }
        if (bulkSentLastHour >= bulkHourlyCap) {
          console.log('Bulk hourly cap reached — leaving message in queue', {
            cap: bulkHourlyCap,
            sent: bulkSentLastHour,
          })
          continue
        }
        if (isDeliverabilityBulk && !bypassCap && perRecipientMax > 0) {
          const { count: recentToRecipient } = await supabase
            .from('email_send_log')
            .select('id', { count: 'exact', head: true })
            .eq('recipient_email', payload.to)
            .in('template_name', Array.from(BULK_DELIVERABILITY_TEMPLATES))
            .eq('status', 'sent')
            .gte('created_at', windowAgoIso)
          if ((recentToRecipient ?? 0) >= perRecipientMax) {
            const capReason = `Recipient already received ${perRecipientMax} ${labelStr} email(s) in the last ${perRecipientWindowHours}h`
            await supabase.from('email_send_log').insert({
              message_id: payload.message_id,
              template_name: labelStr || queue,
              recipient_email: payload.to,
              status: 'frequency_capped',
              error_message: capReason,
            })
            // Audit trail for admins (event_type=email_capped is in the
            // non-actionable allow-list, so this lands in audit_log + System
            // Health > Email but is blocked from agent_fix_queue by trigger
            // and discover_audit_fingerprints exclusion). Refactored
            // 2026-05-30: replaces the previous substring suppression on
            // "Recipient already received".
            await supabase.rpc('write_audit_log', {
              p_event_type: 'email_capped',
              p_table_name: 'email_send_log',
              p_record_id: String(payload.message_id ?? msg.msg_id),
              p_user_id: null,
              p_error_message: capReason,
              p_changed_fields: [`template:${labelStr || queue}`, `cap:${perRecipientMax}`, `window_hours:${perRecipientWindowHours}`],
            })

            const { error: capDelErr } = await supabase.rpc('delete_email', {
              queue_name: queue,
              message_id: msg.msg_id,
            })
            if (capDelErr) {
              console.error('Failed to delete frequency-capped message', { error: capDelErr })
            }
            continue
          }

        }
      }


      try {
        await sendLovableEmail(
          {
            run_id: payload.run_id,
            to: payload.to,
            from: payload.from,
            reply_to: payload.reply_to,
            sender_domain: payload.sender_domain,
            subject: payload.subject,
            html: payload.html,
            text: payload.text,
            purpose: payload.purpose,
            label: payload.label,
            idempotency_key: payload.idempotency_key,
            unsubscribe_token: payload.unsubscribe_token,
            message_id: payload.message_id,
          },
          // sendUrl is optional — when LOVABLE_SEND_URL is not set, the library
          // falls back to the default Lovable API endpoint (https://api.lovable.dev).
          // Set LOVABLE_SEND_URL as a Supabase secret to override (e.g. for local dev).
          { apiKey, sendUrl: Deno.env.get('LOVABLE_SEND_URL') }
        )

        // Log success
        await supabase.from('email_send_log').insert({
          message_id: payload.message_id,
          template_name: payload.label || queue,
          recipient_email: payload.to,
          status: 'sent',
        })

        // Delete from queue
        const { error: delError } = await supabase.rpc('delete_email', {
          queue_name: queue,
          message_id: msg.msg_id,
        })
        if (delError) {
          console.error('Failed to delete sent message from queue', { queue, msg_id: msg.msg_id, error: delError })
        }
        if (ALL_BULK_TEMPLATES.has(labelStr)) bulkSentLastHour++
        totalProcessed++

        // Success-reset: clear this queue's consecutive 429 counter on first
        // successful send. Only writes when there's something to clear.
        if ((consecutive[queue] ?? 0) > 0) {
          await supabase
            .from('email_send_state')
            .update({ [counterCols[queue]]: 0, updated_at: new Date().toISOString() })
            .eq('id', 1)
          consecutive[queue] = 0
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.error('Email send failed', {
          queue,
          msg_id: msg.msg_id,
          read_ct: msg.read_ct,
          failed_attempts: failedAttempts,
          error: errorMsg,
        })

        if (isRateLimited(error)) {
          await supabase.from('email_send_log').insert({
            message_id: payload.message_id,
            template_name: payload.label || queue,
            recipient_email: payload.to,
            status: 'rate_limited',
            error_message: errorMsg.slice(0, 1000),
          })

          // Exponential backoff per consecutive 429 for this queue: 60s → 120s → 240s …, cap 900s.
          // Honor provider Retry-After when present; otherwise grow exponentially from a 60s base.
          const providerSecs = getRetryAfterSeconds(error)
          const nextCount = (consecutive[queue] ?? 0) + 1
          const expSecs = Math.min(60 * Math.pow(2, nextCount - 1), 900)
          const retryAfterSecs = Math.max(providerSecs, expSecs)
          const until = new Date(Date.now() + retryAfterSecs * 1000).toISOString()

          await supabase
            .from('email_send_state')
            .update({
              [cooldownCols[queue]]: until,
              [counterCols[queue]]: nextCount,
              updated_at: new Date().toISOString(),
            })
            .eq('id', 1)
          cooldownUntil[queue] = until
          consecutive[queue] = nextCount

          // Admin signal — deduped per hour per queue via agent_fix_queue.
          // Wrapped because the table is optional and failures here must not break sends.
          try {
            const hourBucket = new Date().toISOString().slice(0, 13) // YYYY-MM-DDTHH
            // Auth + transactional freezes are user-critical (signup confirmation,
            // password reset, 1:1 receipts) — surface as 'error' so System Health
            // Triage pages admins. Bulk lane freezes stay at 'warn' since they
            // only delay digests/blasts and are isolated by design.
            const laneSeverity = queue === 'bulk_emails' ? 'warn' : 'error'
            await supabase.from('agent_fix_queue').upsert(
              {
                fingerprint: `email_queue.rate_limited.${queue}.${hourBucket}`,
                event_type: 'email_rate_limited',
                source: 'process-email-queue',
                severity: laneSeverity,
                error_message: `${queue} paused ${retryAfterSecs}s after consecutive 429 #${nextCount}. ${errorMsg.slice(0, 500)}`,
              } as any,
              { onConflict: 'fingerprint', ignoreDuplicates: false }
            )
          } catch (signalErr) {
            console.warn('agent_fix_queue insert failed', { err: String(signalErr) })
          }


          // Stop THIS queue's batch; outer loop continues to the next queue
          // (which has its own cooldown). Auth no longer blocked by transactional 429s.
          break
        }


        // 403s are permanent configuration or authorization failures for this
        // message, so move straight to DLQ and stop processing the rest of the batch.
        if (isForbidden(error)) {
          await moveToDlq(supabase, queue, msg, errorMsg.slice(0, 1000))
          return new Response(
            JSON.stringify({ processed: totalProcessed, stopped: 'forbidden' }),
            { headers: { 'Content-Type': 'application/json' } }
          )
        }

        // Log non-429 failures to track real retry attempts.
        await supabase.from('email_send_log').insert({
          message_id: payload.message_id,
          template_name: payload.label || queue,
          recipient_email: payload.to,
          status: 'failed',
          error_message: errorMsg.slice(0, 1000),
        })
        if (payload?.message_id && typeof payload.message_id === 'string') {
          failedAttemptsByMessageId.set(payload.message_id, failedAttempts + 1)
        }

        // Non-429 errors: message stays invisible until VT expires, then retried
      }

      // Small delay between sends to smooth bursts
      if (i < messages.length - 1) {
        await new Promise((r) => setTimeout(r, sendDelayMs))
      }
    }
  }

  return new Response(
    JSON.stringify({ processed: totalProcessed }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}))
