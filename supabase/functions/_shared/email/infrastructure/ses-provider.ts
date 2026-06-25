// Amazon SES SMTP adapter for the email subsystem v2 provider port.
//
// Swap target documented in docs/runbooks/email-subsystem-v2.md ("Provider
// swap"). Selected over the Lovable adapter via EMAIL_PROVIDER=ses in
// composition.ts. Sends through the SES SMTP interface (denomailer) so the
// SAME SES SMTP credentials also power Supabase Auth → Custom SMTP for the
// auth lane — one credential set for the whole platform.
//
// Required runtime secrets on the project:
//   SES_SMTP_HOST      e.g. email-smtp.us-west-2.amazonaws.com
//   SES_SMTP_PORT      465 (implicit TLS, recommended) or 587 (STARTTLS); default 465
//   SES_SMTP_USERNAME  SES SMTP credential username
//   SES_SMTP_PASSWORD  SES SMTP credential password
// Optional:
//   EMAIL_FROM_ADDRESS override (default onboarding@techfleet.org)
//
// SES must be OUT of the sandbox (production access granted) to send to
// arbitrary recipients; in sandbox it only delivers to verified addresses.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
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

// Pull the leading 3-digit SMTP reply code out of a denomailer error, if present.
function smtpCodeOf(message: string): number {
  const m = message.match(/\b([45]\d{2})\b/);
  return m ? Number(m[1]) : 0;
}

function classifyError(err: unknown): ProviderOutcome {
  const message = err instanceof Error ? err.message : String(err);
  const code = smtpCodeOf(message);

  // SES throttling surfaces as 454 ("Throttling failure" / "Maximum sending
  // rate exceeded"). Treat as rate-limited so the dispatcher backs off rather
  // than DLQ-ing a perfectly good message.
  if (code === 454 || /throttl|maximum sending rate|rate exceeded/i.test(message)) {
    return {
      kind: "rate_limited",
      statusCode: 429,
      retryAfterSeconds: 60,
      workspaceQuota: false,
      raw: message,
    };
  }
  // 5xx = permanent SMTP rejection (bad address, message rejected, not verified).
  if (code >= 500 && code < 600) {
    return { kind: "permanent_fail", statusCode: code, message };
  }
  // 4xx (other than throttling) and connection/TLS errors are transient.
  return { kind: "error", statusCode: code, message, retryable: true };
}

export function makeSesEmailsProvider(): EmailProviderPort {
  return {
    async send(env: EmailEnvelope): Promise<ProviderOutcome> {
      const host = Deno.env.get("SES_SMTP_HOST");
      const username = Deno.env.get("SES_SMTP_USERNAME");
      const password = Deno.env.get("SES_SMTP_PASSWORD");
      const port = Number(Deno.env.get("SES_SMTP_PORT") ?? "465");
      const fromAddress = Deno.env.get("EMAIL_FROM_ADDRESS") ?? DEFAULT_FROM;

      if (!host || !username || !password) {
        // Operational misconfig, not a bad message — keep it retryable so
        // queued mail flushes once the secrets are set.
        return {
          kind: "error",
          statusCode: 0,
          message: "SES SMTP not configured (SES_SMTP_HOST/USERNAME/PASSWORD)",
          retryable: true,
        };
      }

      // Resolve subject + HTML. Auth templates arrive pre-rendered in
      // payload.html; transactional templates render from the registry — same
      // contract as the Lovable adapter so behavior is identical.
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

      // Implicit TLS on 465/2465; STARTTLS on 587/2587.
      const implicitTls = port === 465 || port === 2465;
      const client = new SMTPClient({
        connection: { hostname: host, port, tls: implicitTls, auth: { username, password } },
      });

      try {
        await client.send({
          from: `${FROM_NAME} <${fromAddress}>`,
          to: env.recipient,
          replyTo: REPLY_TO,
          subject,
          // denomailer derives a text part from the HTML when given "auto".
          content: text ?? "auto",
          html,
          headers: {
            "X-Idempotency-Key": env.idempotencyKey,
            "X-Message-Id": env.messageId,
          },
        });
        // SES SMTP doesn't return a queryable id over denomailer; our own
        // messageId is the correlation key recorded in the outbox.
        return { kind: "sent", statusCode: 200, providerMessageId: env.messageId };
      } catch (err) {
        return classifyError(err);
      } finally {
        try {
          await client.close();
        } catch {
          // best-effort connection teardown
        }
      }
    },
  };
}
