// @edge-public
import * as React from "npm:react@18.3.1";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { withAuditWrapper } from "../_shared/audit.ts";
import { SignupEmail } from "../_shared/email-templates/signup.tsx";
import { InviteEmail } from "../_shared/email-templates/invite.tsx";
import { MagicLinkEmail } from "../_shared/email-templates/magic-link.tsx";
import { RecoveryEmail } from "../_shared/email-templates/recovery.tsx";
import { EmailChangeEmail } from "../_shared/email-templates/email-change.tsx";
import { ReauthenticationEmail } from "../_shared/email-templates/reauthentication.tsx";

// ─────────────────────────────────────────────────────────────────────────────
// auth-email-hook
//
// Supabase Auth "Send Email" hook. GoTrue mints the auth token/link and calls
// this function; we render the branded template and hand the SEND off to the
// SAME pipeline transactional email uses (email_outbox → email-dispatcher →
// Resend). This is what unifies ALL email onto one provider + one pipeline
// (one log, retry/DLQ, suppression, and the auth-email watchdog).
//
// Contract: Supabase's NATIVE Send Email Hook, verified with the Standard
// Webhooks scheme (headers webhook-id / webhook-timestamp / webhook-signature,
// secret "v1,whsec_<base64>"). The previous implementation spoke Lovable's
// bespoke webhook format (@lovable.dev/*), which does not exist on the owned
// project — that mismatch is why auth email silently stopped at cutover. All
// Lovable dependencies are removed here.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature",
};

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: "Confirm your Tech Fleet email",
  invite: "You were invited to Tech Fleet",
  magiclink: "Sign in to Tech Fleet",
  recovery: "Reset your Tech Fleet password",
  email_change: "Confirm your new email",
  reauthentication: "Your verification code",
};

// Template mapping (keyed by our normalized action name)
const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
};

// Configuration
const SITE_NAME = "Tech Fleet";
const APP_ORIGIN = "https://techfleet.network";
const SENDER_DOMAIN = "notify.techfleet.org";
const FROM_DOMAIN = "techfleet.org";
const FROM_MAILBOX = "onboarding";
const REPLY_TO = "onboarding@techfleet.org";
const DEDUP_WINDOW_SECONDS = 60;
const ALLOWED_RESET_ORIGINS = new Set([
  "https://techfleet.network",
  "https://www.techfleet.network",
]);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Native Supabase Send Email Hook payload shape.
interface NativeHookPayload {
  user: { id: string; email: string; new_email?: string | null };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url?: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

// Normalize GoTrue action types to our template keys.
function normalizeAction(action: string): string {
  if (action === "email_change_current" || action === "email_change_new") return "email_change";
  return action;
}

// Sample data for the /preview endpoint ONLY (never used for real sends).
const SAMPLE_URL = APP_ORIGIN;
const SAMPLE_EMAIL = "user@example.test";
const SAMPLE_DATA: Record<string, object> = {
  signup: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_URL,
  },
  magiclink: { siteName: SITE_NAME, confirmationUrl: SAMPLE_URL },
  recovery: { siteName: SITE_NAME, confirmationUrl: SAMPLE_URL },
  invite: { siteName: SITE_NAME, siteUrl: SAMPLE_URL, confirmationUrl: SAMPLE_URL },
  email_change: {
    siteName: SITE_NAME,
    oldEmail: SAMPLE_EMAIL,
    email: SAMPLE_EMAIL,
    newEmail: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_URL,
  },
  reauthentication: { token: "123456" },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Preview endpoint — returns rendered HTML without sending. Authorized with the
// same hook secret as a bearer token.
async function handlePreview(req: Request): Promise<Response> {
  const previewCors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: previewCors });

  const secret = Deno.env.get("AUTH_EMAIL_HOOK_SECRET");
  const authHeader = req.headers.get("Authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...previewCors, "Content-Type": "application/json" },
    });
  }

  let type: string;
  try {
    type = (await req.json()).type;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON in request body" }), {
      status: 400,
      headers: { ...previewCors, "Content-Type": "application/json" },
    });
  }

  const EmailTemplate = EMAIL_TEMPLATES[normalizeAction(type)];
  if (!EmailTemplate) {
    return new Response(JSON.stringify({ error: `Unknown email type: ${type}` }), {
      status: 400,
      headers: { ...previewCors, "Content-Type": "application/json" },
    });
  }
  const html = await renderAsync(
    React.createElement(EmailTemplate, SAMPLE_DATA[normalizeAction(type)] ?? {})
  );
  return new Response(html, {
    status: 200,
    headers: { ...previewCors, "Content-Type": "text/html; charset=utf-8" },
  });
}

// Build the link the email button points at, from GoTrue's token_hash.
function buildConfirmationUrl(rawType: string, tokenHash: string, redirectToRaw: string): string {
  const fallbackRedirect = redirectToRaw || `${APP_ORIGIN}/reset-password`;
  try {
    const rt = new URL(fallbackRedirect);
    const origin = ALLOWED_RESET_ORIGINS.has(rt.origin) ? rt.origin : APP_ORIGIN;

    // Recovery uses the app's inert confirm landing (AUTH-RESET-PREFETCH-001):
    // link scanners can GET it without consuming the single-use token; only a
    // human click forwards to /reset-password where verifyOtp runs.
    if (rawType === "recovery" && tokenHash) {
      const target = new URL("/reset-password/confirm", origin);
      target.searchParams.set("token_hash", tokenHash);
      target.searchParams.set("type", "recovery");
      return target.toString();
    }
  } catch {
    // fall through to the standard verify URL
  }

  // Everything else: the standard GoTrue verify endpoint, which validates the
  // token_hash server-side then redirects to redirect_to.
  const verify = new URL("/auth/v1/verify", SUPABASE_URL);
  verify.searchParams.set("token", tokenHash);
  verify.searchParams.set("type", rawType);
  verify.searchParams.set("redirect_to", fallbackRedirect);
  return verify.toString();
}

async function handleWebhook(req: Request): Promise<Response> {
  const hookSecret = Deno.env.get("AUTH_EMAIL_HOOK_SECRET") ?? "";
  if (!hookSecret) {
    console.error("AUTH_EMAIL_HOOK_SECRET not configured — cannot verify Send Email Hook");
    return json({ error: "Server configuration error" }, 500);
  }

  const rawBody = await req.text();

  // Verify with the Standard Webhooks scheme. The dashboard secret is
  // "v1,whsec_<base64>"; the library takes the base64 portion.
  let payload: NativeHookPayload;
  try {
    const wh = new Webhook(hookSecret.replace(/^v1,whsec_/, "").replace(/^whsec_/, ""));
    payload = wh.verify(rawBody, {
      "webhook-id": req.headers.get("webhook-id") ?? "",
      "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
      "webhook-signature": req.headers.get("webhook-signature") ?? "",
    }) as NativeHookPayload;
  } catch (err) {
    console.error("Send Email Hook signature verification failed", { err: String(err) });
    return json({ error: "Invalid signature" }, 401);
  }

  const emailData = payload?.email_data;
  if (!emailData || !payload?.user) {
    console.error("Send Email Hook payload missing user/email_data");
    return json({ error: "Invalid payload" }, 400);
  }

  const rawType = emailData.email_action_type;
  const emailType = normalizeAction(rawType);
  // For "confirm your NEW email" the recipient is the new address.
  const recipient =
    rawType === "email_change_new"
      ? (payload.user.new_email ?? payload.user.email)
      : payload.user.email;
  const correlationId = req.headers.get("webhook-id") ?? crypto.randomUUID();

  const EmailTemplate = EMAIL_TEMPLATES[emailType];
  if (!EmailTemplate) {
    console.error("Unknown email type", { rawType, correlationId });
    return json({ error: `Unknown email type: ${rawType}` }, 400);
  }

  const confirmationUrl = buildConfirmationUrl(
    rawType,
    emailData.token_hash,
    emailData.redirect_to
  );

  const templateProps = {
    siteName: SITE_NAME,
    siteUrl: APP_ORIGIN,
    recipient,
    confirmationUrl,
    token: emailData.token,
    email: recipient,
    oldEmail: payload.user.email,
    newEmail: payload.user.new_email,
  };

  const html = await renderAsync(React.createElement(EmailTemplate, templateProps));
  const text = await renderAsync(React.createElement(EmailTemplate, templateProps), {
    plainText: true,
  });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const messageId = crypto.randomUUID();
  const normalizedEmail = (recipient || "").trim().toLowerCase();

  // Short-window dedup: GoTrue may retry the hook; don't double-send.
  const cooldownSinceIso = new Date(Date.now() - DEDUP_WINDOW_SECONDS * 1000).toISOString();
  const { data: recent } = await supabase
    .from("email_send_log")
    .select("id")
    .eq("recipient_email", recipient)
    .eq("template_name", emailType)
    .in("status", ["pending", "sent"])
    .gte("created_at", cooldownSinceIso)
    .limit(1);
  if (recent && recent.length > 0) {
    console.log("Auth email dedup hit — dropping duplicate", { emailType, correlationId });
    return json({ success: true, deduped: true }, 200);
  }

  // Mint (or fetch) the unsubscribe token in one atomic ON CONFLICT roundtrip.
  const freshToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const { data: tokenRow, error: tokenError } = await supabase
    .from("email_unsubscribe_tokens")
    .upsert(
      { email: normalizedEmail, token: freshToken },
      { onConflict: "email", ignoreDuplicates: false }
    )
    .select("token")
    .single();
  const unsubscribeToken = tokenRow?.token ?? null;
  if (tokenError || !unsubscribeToken) {
    console.error("mint_unsubscribe_token failed", {
      code: (tokenError as { code?: string } | null)?.code,
      message: tokenError?.message,
    });
    // 503 → GoTrue retries; the cause is almost always a transient PostgREST blip.
    return json(
      { error: `mint_unsubscribe_token: ${tokenError?.message ?? "no_row_returned"}` },
      503
    );
  }

  // ── Hand the SEND to the unified pipeline (email_outbox → dispatcher → Resend).
  // This is the same path transactional email uses. laneOverride:'auth' tags the
  // lane; the dispatcher delivers via Resend and records terminal state.
  try {
    const { buildEmailContainer } = await import("../_shared/email/composition.ts");
    const { enqueueEmail } = buildEmailContainer(supabase);
    const out = await enqueueEmail({
      template: emailType,
      recipient,
      subject: EMAIL_SUBJECTS[emailType] || "Notification",
      payload: {
        run_id: correlationId,
        html,
        text,
        from: `${SITE_NAME} <${FROM_MAILBOX}@${FROM_DOMAIN}>`,
        reply_to: REPLY_TO,
        sender_domain: SENDER_DOMAIN,
        purpose: "transactional",
        label: emailType,
        unsubscribe_token: unsubscribeToken,
      },
      idempotencyKey: messageId,
      messageId,
      laneOverride: "auth",
    });
    await supabase.from("email_send_log").insert({
      message_id: out.messageId,
      template_name: emailType,
      recipient_email: recipient,
      status: out.suppressed ? "suppressed" : "pending",
    });
    return json({ ok: true, queued: true, messageId: out.messageId }, 200);
  } catch (e) {
    console.error("auth email enqueue failed", { err: String(e), correlationId, emailType });
    await supabase.from("email_send_log").insert({
      message_id: messageId,
      template_name: emailType,
      recipient_email: recipient,
      status: "failed",
      error_message: "enqueue_failed",
    });
    // 500 → GoTrue retries the hook rather than dropping the email silently.
    return json({ error: "Failed to enqueue email" }, 500);
  }
}

Deno.serve(
  withAuditWrapper("auth-email-hook", async (req) => {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (url.pathname.endsWith("/preview")) return handlePreview(req);
    try {
      return await handleWebhook(req);
    } catch (error) {
      console.error("Webhook handler error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      return json({ error: message }, 500);
    }
  })
);
