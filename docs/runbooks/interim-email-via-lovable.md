# Runbook — System email provider (SES denied → Resend)

**Decision (2026-07-06, updated):** AWS SES production access was **denied**. After briefly considering routing back through Lovable (blocked: the `LOVABLE_API_KEY` value is unrecoverable — Lovable only allows *rotate*, not view), the chosen provider is **Resend**. It's the permanent path and avoids any Lovable dependency for email. The code selects it via `EMAIL_PROVIDER=resend` (see `_shared/email/composition.ts`) using `makeResendEmailsProvider` (`_shared/email/infrastructure/resend-provider.ts`).

## Resend setup (current path)
1. **Create a Resend account** → https://resend.com → **API Keys → Create** → copy the key (`re_…`).
2. **Verify the sending domain** `techfleet.org` in Resend → Domains → Add domain → add the DKIM/SPF/DMARC DNS records it shows into **Cloudflare** (techfleet.org zone) → wait for "Verified." Until verified, Resend only sends to your own address.
3. **Set Supabase secrets** (Project Settings → Edge Functions → Secrets):
   - `RESEND_API_KEY` = the `re_…` key
   - `EMAIL_PROVIDER` = `resend`
   - `AUTH_EMAIL_HOOK_SECRET` = a strong random string (this is the Supabase Auth "Send Email" hook secret — provider-neutral, replaces the old `LOVABLE_API_KEY` role)
4. **Register the Auth "Send Email" hook** — Supabase → Authentication → Hooks → Send Email hook → **HTTPS** → URL `https://pzvqxdgoztbfikfuifix.supabase.co/functions/v1/auth-email-hook` → **Secret** = the same `AUTH_EMAIL_HOOK_SECRET` value.
5. **Confirm `auth-email-hook` is deployed.**
6. **Test:** signup + password reset to a real inbox; `email_send_log` rows should show `sent`.

Once Resend is verified and sending, `LOVABLE_API_KEY` is no longer needed for email (it stays removed from the AI path by the Fleety re-architecture, so it can be dropped from the project entirely).

---

## (Superseded) interim-via-Lovable notes
Kept for reference; not the chosen path.

## Why no code change is needed
`supabase/functions/_shared/email/composition.ts` selects the provider from `EMAIL_PROVIDER`:
- unset or anything ≠ `ses` → **Lovable** (`makeLovableEmailsProvider`, sends via `npm:@lovable.dev/email-js` from `onboarding@techfleet.org` over `notify.techfleet.org`)
- `ses` → Amazon SES SMTP

Default is Lovable, so reverting = ensure `EMAIL_PROVIDER` is not `ses` and the Lovable key is present.

## Cowork steps (on project `pzvqxdgoztbfikfuifix`)
1. **Set secret `LOVABLE_API_KEY`** (Supabase → Edge Functions → Secrets) — value from the Lovable account. Without it, `auth-email-hook` returns 500 and no auth email sends.
2. **Ensure `EMAIL_PROVIDER` is NOT `ses`** — leave unset, or set to `lovable`.
3. **Register the Auth email hook** — Supabase → Authentication → Emails/Hooks → point "Send Email" at the **`auth-email-hook`** function. GoTrue only invokes the hook if it is registered; without this, no email sends even with the key set.
4. **Confirm `auth-email-hook` is deployed** on the project (redeploy if missing).
5. **Verify DNS** (DKIM/SPF for `techfleet.org` / `notify.techfleet.org`) still authorizes the Lovable sender.
6. **Test:** trigger a signup + a password reset to a real inbox; confirm delivery and that `email_send_log` rows show `sent` (not `pending`).

## ⚠️ Guard: do NOT delete `LOVABLE_API_KEY` (dual-purpose)
`LOVABLE_API_KEY` has **two** independent uses in this codebase:
1. The **Lovable AI gateway** for Fleety chat/embeddings — **being removed** by the Fleety re-architecture (D-03/D-04): `techfleet-chat`, `fleety-embed` now use Groq/Gemini directly.
2. The **email provider** (`auth-email-hook` + the Lovable email adapter) — **still in use** via this interim.

Therefore the re-architecture's "delete `LOVABLE_API_KEY`" step (SAD §1.3) and its absence-grep (UC-23) **must be scoped to the AI usages only**. Deleting the secret or grepping the whole repo to zero would **re-break email**. Keep `LOVABLE_API_KEY` set until email is migrated to the permanent provider.

## Permanent replacement (later)
`lovable-emails-provider.ts` header: *"Swapping providers tomorrow (Resend, SES) = replace this file only."* When a provider is chosen:
1. Add `makeResendEmailsProvider()` (or Postmark/Mailgun) mirroring `ses-provider.ts`.
2. Set its secret (e.g., `RESEND_API_KEY`) + `EMAIL_PROVIDER=resend`.
3. Verify sending domain DKIM/SPF/DMARC.
4. Then `LOVABLE_API_KEY` (email use) can retire.
