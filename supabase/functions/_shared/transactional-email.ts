import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { TEMPLATES } from "./transactional-email-templates/registry.ts";

// Brand-aligned identity for inbox trust. From: header uses the root domain
// (techfleet.org) so recipients see a real human-recognisable mailbox; DKIM
// signing still happens on SENDER_DOMAIN (notify.techfleet.org) with relaxed
// DMARC alignment (adkim=r; aspf=r) configured at the DNS layer.
const SITE_NAME = "Tech Fleet";
const SENDER_DOMAIN = "notify.techfleet.org";
const FROM_DOMAIN = "techfleet.org";
const FROM_MAILBOX = "onboarding";
const REPLY_TO = "onboarding@techfleet.org";

// Templates that target many recipients per send batch. Project-blast subjects
// are coordinator-authored and need sanitization (strip emoji/!/all-caps) to
// keep them out of Gmail's Promotions tab.
export const BULK_TEMPLATES = new Set<string>([
  "project-blast",
  "fleety-coach-digest",
  "announcement",
]);

export function resolveEmailQueue(templateName: string): "bulk_emails" | "transactional_emails" {
  return BULK_TEMPLATES.has(templateName) ? "bulk_emails" : "transactional_emails";
}

// Strip spam-trigger characters from coordinator-supplied subjects.
function sanitizeBulkSubject(raw: string): string {
  if (!raw) return raw;
  let s = raw;
  // strip emoji / pictographs
  s = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, "");
  // collapse exclamation marks
  s = s.replace(/!+/g, "");
  // de-shout: if 70%+ caps and >6 letters, lowercase then sentence-case
  const letters = s.replace(/[^a-zA-Z]/g, "");
  if (letters.length > 6) {
    const caps = letters.replace(/[^A-Z]/g, "").length;
    if (caps / letters.length > 0.7) {
      s = s.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, (m) => m.toUpperCase());
    }
  }
  // collapse whitespace, cap length
  s = s.replace(/\s+/g, " ").trim().slice(0, 78);
  return s;
}

type JsonRecord = Record<string, unknown>;

export interface QueueTransactionalEmailInput {
  templateName: string;
  recipientEmail?: string;
  idempotencyKey?: string;
  messageId?: string;
  templateData?: JsonRecord;
  supabase?: SupabaseClient;
  bypassFrequencyCap?: boolean;
}

export type QueueTransactionalEmailResult =
  | {
      ok: true;
      queued: true;
      messageId: string;
      suppressed: boolean;
      deduped?: boolean;
      reason?: "email_suppressed";
    }
  | {
      ok: false;
      status: number;
      error: string;
      messageId?: string;
    };

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// H9: content hash for correlating a durable log row to the (transient) queue
// payload WITHOUT persisting the rendered email / PII in the long-lived log.
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getServiceSupabaseClient(existingClient?: SupabaseClient): SupabaseClient {
  if (existingClient) return existingClient;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing required environment variables");
  }

  return createClient(supabaseUrl, supabaseServiceKey);
}

async function insertEmailLog(
  supabase: SupabaseClient,
  payload: {
    message_id: string;
    template_name: string;
    recipient_email: string;
    status: string;
    error_message?: string;
    metadata?: JsonRecord;
  }
) {
  const { error } = await supabase.from("email_send_log").insert(payload);

  if (error) {
    console.error("Failed to write email log entry", {
      payload,
      error,
    });
  }
}

async function lookupTokenWithRetry(
  supabase: SupabaseClient,
  normalizedEmail: string,
  attempts = 3
): Promise<{
  data: Array<{ token: string; used_at: string | null; created_at: string }> | null;
  error: unknown;
}> {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i++) {
    // Simpler order clause — `nullsFirst` option has caused PostgREST issues in the past.
    // Sort used_at ASC so NULL (unused) rows naturally come first in PostgREST default ordering,
    // then by created_at ASC as a tiebreaker.
    const { data, error } = await supabase
      .from("email_unsubscribe_tokens")
      .select("token, used_at, created_at")
      .eq("email", normalizedEmail)
      .order("used_at", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1);

    if (!error) {
      return { data, error: null };
    }
    lastError = error;
    // Brief backoff before retry (transient network/PostgREST hiccups)
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100 * (i + 1)));
    }
  }
  return { data: null, error: lastError };
}

async function resolveUnsubscribeToken(
  supabase: SupabaseClient,
  normalizedEmail: string,
  messageId: string,
  templateName: string,
  recipientEmail: string
): Promise<
  { ok: true; token: string } | { ok: true; suppressed: true } | { ok: false; error: string }
> {
  // Defensive: in case legacy duplicate rows exist for an email, take the
  // oldest unused row (or oldest if all used) instead of erroring on multi-row.
  const { data: tokenRows, error: tokenLookupError } = await lookupTokenWithRetry(
    supabase,
    normalizedEmail
  );
  const existingToken = tokenRows && tokenRows.length > 0 ? tokenRows[0] : null;

  if (tokenLookupError && !existingToken) {
    console.error("Token lookup failed after retries — falling back to fresh token mint", {
      error: tokenLookupError,
      email: normalizedEmail,
    });
    // Self-heal: instead of failing the email, mint a fresh token.
    // The unique constraint on email will cause upsert to succeed or no-op.
    const fallbackToken = generateToken();
    const { error: fallbackError } = await supabase
      .from("email_unsubscribe_tokens")
      .upsert(
        { token: fallbackToken, email: normalizedEmail },
        { onConflict: "email", ignoreDuplicates: true }
      );

    if (fallbackError) {
      console.error("Fallback token mint also failed", {
        error: fallbackError,
        email: normalizedEmail,
      });
      await insertEmailLog(supabase, {
        message_id: messageId,
        template_name: templateName,
        recipient_email: recipientEmail,
        status: "failed",
        error_message: "Failed to look up or create unsubscribe token",
      });
      return { ok: false, error: "Failed to prepare email" };
    }

    // Re-read to get whichever token now exists for this email
    const { data: postFallbackRows } = await lookupTokenWithRetry(supabase, normalizedEmail);
    if (postFallbackRows && postFallbackRows.length > 0 && !postFallbackRows[0].used_at) {
      return { ok: true, token: postFallbackRows[0].token };
    }
    if (postFallbackRows && postFallbackRows.length > 0) {
      // A used token exists but no unused — treat as suppressed-style edge case
      return { ok: true, token: postFallbackRows[0].token };
    }
    // As a last resort, use the token we just generated
    return { ok: true, token: fallbackToken };
  }

  if (existingToken && !existingToken.used_at) {
    return { ok: true, token: existingToken.token };
  }

  if (!existingToken) {
    const nextToken = generateToken();
    const { error: tokenError } = await supabase
      .from("email_unsubscribe_tokens")
      .upsert(
        { token: nextToken, email: normalizedEmail },
        { onConflict: "email", ignoreDuplicates: true }
      );

    if (tokenError) {
      console.error("Failed to create unsubscribe token", {
        error: tokenError,
      });
      await insertEmailLog(supabase, {
        message_id: messageId,
        template_name: templateName,
        recipient_email: recipientEmail,
        status: "failed",
        error_message: "Failed to create unsubscribe token",
      });
      return { ok: false, error: "Failed to prepare email" };
    }

    const { data: storedRows, error: reReadError } = await supabase
      .from("email_unsubscribe_tokens")
      .select("token")
      .eq("email", normalizedEmail)
      .order("created_at", { ascending: true })
      .limit(1);
    const storedToken = storedRows && storedRows.length > 0 ? storedRows[0] : null;

    if (reReadError || !storedToken) {
      console.error("Failed to read back unsubscribe token after upsert", {
        error: reReadError,
        email: normalizedEmail,
      });
      await insertEmailLog(supabase, {
        message_id: messageId,
        template_name: templateName,
        recipient_email: recipientEmail,
        status: "failed",
        error_message: "Failed to confirm unsubscribe token storage",
      });
      return { ok: false, error: "Failed to prepare email" };
    }

    return { ok: true, token: storedToken.token };
  }

  console.warn("Unsubscribe token already used but email not suppressed", {
    email: normalizedEmail,
  });
  await insertEmailLog(supabase, {
    message_id: messageId,
    template_name: templateName,
    recipient_email: recipientEmail,
    status: "suppressed",
    error_message: "Unsubscribe token used but email missing from suppressed list",
  });

  return { ok: true, suppressed: true };
}

export async function queueTransactionalEmail({
  templateName,
  recipientEmail,
  idempotencyKey,
  messageId = crypto.randomUUID(),
  templateData = {},
  supabase: existingClient,
  bypassFrequencyCap = false,
}: QueueTransactionalEmailInput): Promise<QueueTransactionalEmailResult> {
  let supabase: SupabaseClient;

  try {
    supabase = getServiceSupabaseClient(existingClient);
  } catch (error) {
    console.error("Missing required environment variables", { error });
    return {
      ok: false,
      status: 500,
      error: "Server configuration error",
      messageId,
    };
  }

  // ── Email subsystem v2 strangler fig ───────────────────────────────────────
  // If the v2 lane flag is set for this template's lane, route through the
  // new Outbox + dispatcher. Same external contract, completely different
  // (clean) internals. Per-lane bitmask in email_send_state.pipeline_v2_lanes_bitmask
  // gates rollout (1=auth, 2=transactional, 4=bulk). Legacy path below stays
  // intact until Phase 4 decommission.
  try {
    const { buildEmailContainer, isV2Enabled } = await import("./email/composition.ts");
    const { routeLane } = await import("./email/domain/policies.ts");
    const lane = routeLane(templateName);
    if (await isV2Enabled(supabase, lane)) {
      const tmpl = TEMPLATES[templateName];
      if (!tmpl) {
        return { ok: false, status: 404, error: `Template '${templateName}' not found`, messageId };
      }
      const effectiveRecipient = (tmpl.to || recipientEmail || "").toLowerCase();
      if (!effectiveRecipient) {
        return { ok: false, status: 400, error: "recipientEmail is required", messageId };
      }
      const { enqueueEmail } = buildEmailContainer(supabase);
      const out = await enqueueEmail({
        template: templateName,
        recipient: effectiveRecipient,
        payload: { ...templateData, bypass_frequency_cap: bypassFrequencyCap },
        idempotencyKey: idempotencyKey ?? messageId,
        messageId,
      });
      return {
        ok: true,
        queued: true,
        messageId: out.messageId,
        suppressed: out.suppressed,
        reason: out.suppressed ? "email_suppressed" : undefined,
      };
    }
  } catch (e) {
    console.warn("email v2 path errored — falling back to legacy pipeline", { err: String(e) });
  }
  // ── End v2 strangler fig ───────────────────────────────────────────────────

  const template = TEMPLATES[templateName];

  if (!template) {
    console.error("Template not found in registry", { templateName });
    return {
      ok: false,
      status: 404,
      error: `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(", ")}`,
      messageId,
    };
  }

  const effectiveRecipient = template.to || recipientEmail;

  if (!effectiveRecipient) {
    return {
      ok: false,
      status: 400,
      error: "recipientEmail is required (unless the template defines a fixed recipient)",
      messageId,
    };
  }

  const normalizedEmail = effectiveRecipient.toLowerCase();

  // Refuse role-based mailboxes — they hurt reputation and are usually parsed
  // by ticketing systems, not humans (Phase 3.4 of deliverability plan).
  const ROLE_LOCAL_PARTS = new Set([
    "postmaster",
    "abuse",
    "noreply",
    "no-reply",
    "donotreply",
    "do-not-reply",
    "mailer-daemon",
    "bounce",
    "bounces",
    "root",
  ]);
  const localPart = normalizedEmail.split("@")[0];
  if (ROLE_LOCAL_PARTS.has(localPart)) {
    await insertEmailLog(supabase, {
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: "suppressed",
      error_message: "Role-based mailbox blocked",
    });
    return { ok: true, queued: true, messageId, suppressed: true, reason: "email_suppressed" };
  }

  const requestIdempotencyKey = idempotencyKey || messageId;

  const { data: suppressed, error: suppressionError } = await supabase
    .from("suppressed_emails")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (suppressionError) {
    console.error("Suppression check failed — refusing to send", {
      error: suppressionError,
      effectiveRecipient,
    });
    return {
      ok: false,
      status: 500,
      error: "Failed to verify suppression status",
      messageId,
    };
  }

  if (suppressed) {
    await insertEmailLog(supabase, {
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: "suppressed",
    });

    console.log("Email suppressed", { effectiveRecipient, templateName });
    return {
      ok: true,
      queued: true,
      messageId,
      suppressed: true,
      reason: "email_suppressed",
    };
  }

  const unsubscribe = await resolveUnsubscribeToken(
    supabase,
    normalizedEmail,
    messageId,
    templateName,
    effectiveRecipient
  );

  if (!unsubscribe.ok) {
    return {
      ok: false,
      status: 500,
      error: unsubscribe.error,
      messageId,
    };
  }

  if ("suppressed" in unsubscribe && unsubscribe.suppressed) {
    return {
      ok: true,
      queued: true,
      messageId,
      suppressed: true,
      reason: "email_suppressed",
    };
  }
  if (!("token" in unsubscribe)) {
    return {
      ok: false,
      status: 500,
      error: "Failed to prepare email",
      messageId,
    };
  }
  const unsubscribeToken = unsubscribe.token;

  const html = await renderAsync(React.createElement(template.component, templateData));
  const plainText = await renderAsync(React.createElement(template.component, templateData), {
    plainText: true,
  });

  let resolvedSubject =
    typeof template.subject === "function" ? template.subject(templateData) : template.subject;

  if (BULK_TEMPLATES.has(templateName)) {
    resolvedSubject = sanitizeBulkSubject(resolvedSubject);
  }

  // Server-side dedup guard (Layer 1 of EMAIL-RECONCILE).
  // If a row already exists for this messageId — terminal (sent/failed/dlq/
  // suppressed/rate_limited/frequency_capped) OR recent pending (<5 min) —
  // skip the enqueue entirely. Prevents the duplicate-pending artifact that
  // made isabelle's community-agreement email show as "pending" forever even
  // though it was actually delivered. The worker's own `alreadySent` guard
  // is now a second line of defense.
  {
    const fiveMinAgoIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: existingRows } = await supabase
      .from("email_send_log")
      .select("id,status,created_at")
      .eq("message_id", messageId)
      .order("created_at", { ascending: false })
      .limit(5);
    const TERMINAL = new Set([
      "sent",
      "failed",
      "dlq",
      "suppressed",
      "rate_limited",
      "frequency_capped",
    ]);
    const hasTerminal = (existingRows ?? []).some((r) => TERMINAL.has(r.status));
    const hasRecentPending = (existingRows ?? []).some(
      (r) => r.status === "pending" && r.created_at > fiveMinAgoIso
    );
    if (hasTerminal || hasRecentPending) {
      console.log("Duplicate enqueue skipped at source", {
        messageId,
        templateName,
        hasTerminal,
        hasRecentPending,
      });
      return {
        ok: true,
        queued: true,
        messageId,
        suppressed: false,
        deduped: true,
      };
    }
  }

  // Bulk-sender headers required by Gmail/Yahoo (RFC 8058) + inbox-trust signals.
  const unsubscribeUrl = `https://techfleet.network/unsubscribe?token=${unsubscribeToken}`;
  const isBulk = BULK_TEMPLATES.has(templateName);
  const customHeaders: Record<string, string> = {
    "List-Unsubscribe": `<mailto:unsubscribe@techfleet.org?subject=unsubscribe>, <${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "X-Entity-Ref-ID": messageId,
  };
  if (isBulk) {
    customHeaders["Precedence"] = "bulk";
  } else {
    customHeaders["Auto-Submitted"] = "auto-generated";
  }

  // Route bulk templates (announcements, project blasts, digests) to the
  // dedicated `bulk_emails` lane so a bulk 429 can NEVER freeze auth
  // confirmations or 1:1 transactional sends. See process-email-queue.
  const targetQueue = BULK_TEMPLATES.has(templateName) ? "bulk_emails" : "transactional_emails";
  const queuedAtIso = new Date().toISOString();
  const emailPayload = {
    message_id: messageId,
    to: effectiveRecipient,
    from: `${SITE_NAME} <${FROM_MAILBOX}@${FROM_DOMAIN}>`,
    reply_to: REPLY_TO,
    sender_domain: SENDER_DOMAIN,
    subject: resolvedSubject,
    html,
    text: plainText,
    headers: customHeaders,
    purpose: "transactional",
    label: templateName,
    idempotency_key: requestIdempotencyKey,
    unsubscribe_token: unsubscribeToken,
    queued_at: queuedAtIso,
    bypass_frequency_cap: bypassFrequencyCap,
  };

  // H9: the durable email_send_log is long-lived, broadly service-role-read, and
  // survives GDPR erasure — so it must NOT persist rendered content (html/text/
  // subject) or raw templateData (names/tokens/PII). The full payload lives only
  // transiently in the email_outbox row (enqueue_email_v2 below) and is consumed
  // on delivery / re-rendered from source on DLQ replay. Store only non-PII
  // operational refs plus a content hash for correlation.
  const payloadSha256 = await sha256Hex(JSON.stringify(emailPayload));
  await insertEmailLog(supabase, {
    message_id: messageId,
    template_name: templateName,
    recipient_email: effectiveRecipient,
    status: "pending",
    metadata: {
      idempotency_key: requestIdempotencyKey,
      bypass_frequency_cap: bypassFrequencyCap,
      queued_at: queuedAtIso,
      queue_name: targetQueue,
      payload_sha256: payloadSha256,
    },
  });

  // Route through the live v2 pipeline (email_outbox -> email-dispatcher-v2 ->
  // Resend). The legacy `enqueue_email` RPC is a raw `pgmq.send` into the
  // transactional_emails / bulk_emails queues, whose consumer (process-email-queue)
  // was RETIRED at the July v2 cutover — so every transactional email sent through
  // this shared helper (application confirmations, applicant-status, interview
  // scheduling, nudges, digests, project blasts, the generic sender, …) was
  // silently stranded in a queue with no reader. The Resend provider reads
  // payload.html/text + subject; message_id threads to the terminal write-back
  // trigger. targetQueue maps 1:1 to the v2 lane.
  const v2Lane = targetQueue === "bulk_emails" ? "bulk" : "transactional";
  const { error: enqueueError } = await supabase.rpc("enqueue_email_v2", {
    p_lane: v2Lane,
    p_template: templateName,
    p_recipient: effectiveRecipient,
    p_subject: resolvedSubject,
    p_payload: emailPayload,
    p_idempotency_key: requestIdempotencyKey,
    p_message_id: messageId,
  });

  if (enqueueError) {
    console.error("Failed to enqueue email", {
      error: enqueueError,
      templateName,
      effectiveRecipient,
    });

    await insertEmailLog(supabase, {
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: "failed",
      error_message: "Failed to enqueue email",
    });

    return {
      ok: false,
      status: 500,
      error: "Failed to enqueue email",
      messageId,
    };
  }

  console.log("Transactional email enqueued", {
    templateName,
    effectiveRecipient,
    messageId,
  });

  return {
    ok: true,
    queued: true,
    messageId,
    suppressed: false,
  };
}
