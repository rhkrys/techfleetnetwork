// The single I/O boundary to the upstream email provider.
// Swapping providers tomorrow (Resend, SES) = replace this file only.
import { sendLovableEmail } from 'npm:@lovable.dev/email-js';
import type { EmailProviderPort } from '../ports.ts';
import type { EmailEnvelope, ProviderOutcome } from '../domain/types.ts';
import { TEMPLATES } from '../../transactional-email-templates/registry.ts';
import { renderAsync } from 'npm:@react-email/components@0.0.22';
import * as React from 'npm:react@18.3.1';

const SENDER_DOMAIN = 'notify.techfleet.org';
const FROM_DOMAIN = 'techfleet.org';
const FROM_MAILBOX = 'onboarding';
const REPLY_TO = 'onboarding@techfleet.org';

export function makeLovableEmailsProvider(): EmailProviderPort {
  return {
    async send(env: EmailEnvelope): Promise<ProviderOutcome> {
      try {
        // Auth templates carry pre-rendered html in payload.html; transactional render via registry.
        let html = (env.payload.html as string | undefined) ?? '';
        let subject = env.subject ?? '';
        if (!html) {
          const entry = TEMPLATES[env.template];
          if (!entry) {
            return { kind: 'permanent_fail', statusCode: 422, message: `unknown template: ${env.template}` };
          }
          html = await renderAsync(React.createElement(entry.component, env.payload as never));
          const entrySubject = typeof entry.subject === 'function'
            ? entry.subject(env.payload as Record<string, unknown>)
            : entry.subject;
          subject = subject || entrySubject;
        }
        const res = await sendLovableEmail(
          {
            senderDomain: SENDER_DOMAIN,
            from: `${FROM_MAILBOX}@${FROM_DOMAIN}`,
            to: env.recipient,
            subject,
            html,
            replyTo: REPLY_TO,
            headers: { 'X-Idempotency-Key': env.idempotencyKey, 'X-Message-Id': env.messageId },
          } as never,
          {} as never,
        );
        return { kind: 'sent', statusCode: 200, providerMessageId: (res as { id?: string })?.id };
      } catch (err) {
        const e = err as { status?: number; message?: string; retryAfterSeconds?: number | null };
        const status = e.status ?? 0;
        const msg = e.message ?? String(err);
        if (status === 429) {
          return { kind: 'rate_limited', statusCode: 429,
            retryAfterSeconds: e.retryAfterSeconds ?? 60,
            workspaceQuota: /rate_limit:workspace:email_send/i.test(msg),
            raw: msg };
        }
        if (status === 403) return { kind: 'permanent_fail', statusCode: 403, message: msg };
        if (status >= 400 && status < 500) {
          return { kind: 'permanent_fail', statusCode: status, message: msg };
        }
        return { kind: 'error', statusCode: status, message: msg, retryable: true };
      }
    },
  };
}
