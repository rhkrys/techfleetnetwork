// Resend adapter for the email subsystem v2 provider port.
//
// Selected via EMAIL_PROVIDER=resend in composition.ts. Replaces SES (AWS
// production access was denied) as the transactional + auth email sender. Sends
// over the Resend HTTP API (no SMTP), so the same credential powers both the
// transactional lane and the Supabase Auth "Send Email" hook (auth-email-hook
// enqueues; the dispatcher sends through this provider).
//
// Required runtime secret on the project:
//   RESEND_API_KEY     from resend.com -> API Keys
// Optional:
//   EMAIL_FROM_ADDRESS override (default onboarding@techfleet.org)
//
// The sending domain (techfleet.org) must be verified in Resend (DKIM/SPF/DMARC)
// before it delivers to arbitrary recipients — the Resend equivalent of "out of
// the SES sandbox."
import type { EmailProviderPort } from "../ports.ts";
import type { EmailEnvelope, ProviderOutcome } from "../domain/types.ts";
import { TEMPLATES } from "../../transactional-email-templates/registry.ts";
import { renderAsync } from "npm:@react-email/components@0.0.22";
import * as React from "npm:react@18.3.1";

const FROM_NAME = "Tech Fleet";
const FROM_DOMAIN = "techfleet.org";
const FROM_MAILBOX = "onboarding";
const DEFAULT_FROM = `${FROM_MAILBOX}@${FROM_DOMAIN}`;
const REPLY_TO = "onboarding@techfleet.org";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function makeResendEmailsProvider(): EmailProviderPort {
  return {
    async send(env: EmailEnvelope): Promise<ProviderOutcome> {
      const apiKey = Deno.env.get("RESEND_API_KEY");
      const fromAddress = Deno.env.get("EMAIL_FROM_ADDRESS") ?? DEFAULT_FROM;

      if (!apiKey) {
        // Operational misconfig, not a bad message — keep it retryable so
        // queued mail flushes once the secret is set.
        return {
          kind: "error",
          statusCode: 0,
          message: "Resend not configured (RESEND_API_KEY)",
          retryable: true,
        };
      }

      // Same template contract as the SES/Lovable adapters: auth templates
      // arrive pre-rendered in payload.html; transactional templates render
      // from the registry — identical behavior across providers.
      let html = (env.payload.html as string | undefined) ?? "";
      let subject = env.subject ?? "";
      if (!html) {
        const entry = TEMPLATES[env.template];
        if (!entry) {
          return {
            kind: "permanent_fail",
            statusCode: 422,
            message: `unknown template: ${env.template}`,
          };
        }
        html = await renderAsync(React.createElement(entry.component, env.payload as never));
        const entrySubject =
          typeof entry.subject === "function"
            ? entry.subject(env.payload as Record<string, unknown>)
            : entry.subject;
        subject = subject || entrySubject;
      }
      const text = env.payload.text as string | undefined;

      let res: Response;
      try {
        res = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `${FROM_NAME} <${fromAddress}>`,
            to: [env.recipient],
            reply_to: REPLY_TO,
            subject,
            html,
            ...(text ? { text } : {}),
            headers: {
              "X-Idempotency-Key": env.idempotencyKey,
              "X-Message-Id": env.messageId,
            },
          }),
        });
      } catch (err) {
        // Network/DNS/TLS failure — transient, keep retryable.
        return {
          kind: "error",
          statusCode: 0,
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        };
      }

      if (res.ok) {
        // Resend returns { id } — use it as the provider message id when present.
        let providerMessageId = env.messageId;
        try {
          const data = await res.json();
          if (data && typeof data.id === "string") providerMessageId = data.id;
        } catch {
          // body is optional for our purposes
        }
        return { kind: "sent", statusCode: res.status, providerMessageId };
      }

      const bodyText = await res.text().catch(() => "");
      // Resend rate limit -> back off, don't DLQ a good message.
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after")) || 5;
        return {
          kind: "rate_limited",
          statusCode: 429,
          retryAfterSeconds: retryAfter,
          workspaceQuota: /quota|monthly|daily limit/i.test(bodyText),
          raw: bodyText.slice(0, 300),
        };
      }
      // 5xx = transient server error.
      if (res.status >= 500) {
        return { kind: "error", statusCode: res.status, message: bodyText.slice(0, 300), retryable: true };
      }
      // 4xx (422 unverified domain, 403, 400 invalid request) = permanent.
      return { kind: "permanent_fail", statusCode: res.status, message: bodyText.slice(0, 300) };
    },
  };
}
