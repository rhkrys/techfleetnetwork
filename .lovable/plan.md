# Comprehensive deliverability + trust plan for `techfleet.org`

Goal: move from "Promotions / Spam" to "Primary inbox" for Gmail/Outlook/Yahoo on every email we send. Fix alignment, headers, content shape, sender reputation, and observability — without changing user-facing UX.

DNS prerequisite (DMARC/SPF/MX on `techfleet.org`) is already done by you. Everything below is code + config we ship.

---

## Phase 1 — Identity & headers (the #1 cause of Promotions/Spam routing)

### 1.1 Switch `From` and `Reply-To` on every send

Edit both edge functions:

- `supabase/functions/send-transactional-email/index.ts`
- `supabase/functions/auth-email-hook/index.ts`
- Shared helper `supabase/functions/_shared/transactional-email.ts`

Change:
- `FROM_DOMAIN` → `techfleet.org`
- From name → `Tech Fleet` (no "Network", shorter = less promo-looking)
- From address → `onboarding@techfleet.org`
- `reply_to` → `onboarding@techfleet.org`
- Leave `SENDER_DOMAIN` = `notify.techfleet.org` (DKIM-signing subdomain — MUST stay)

For auth emails (signup, magic link, recovery, invite, email-change, reauthentication) use the same From — auth emails to a personal mailbox like `onboarding@` carry the strongest trust signal.

### 1.2 Add bulk-sender headers to every send

In the shared queue payload, add these to `customHeaders`/`headers` for every email:

- `List-Unsubscribe: <mailto:unsubscribe@techfleet.org?subject=unsubscribe>, <https://techfleet.network/unsubscribe?token={token}>`
- `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058 — Gmail/Yahoo bulk-sender requirement Feb 2024)
- `X-Entity-Ref-ID: {messageId}` (suppresses Gmail threading on transactional)
- `Precedence: bulk` ONLY on `project-blast`, `fleety-weekly-digest`, `announcement` templates — NOT on auth or 1:1 transactional
- `Auto-Submitted: auto-generated` on system notifications

Confirm `email_unsubscribe_tokens` row exists before render; we already generate one per recipient.

### 1.3 Plaintext alternative on every send

React Email renders HTML only today. Add:

```ts
import { render } from 'npm:@react-email/render@0.0.17'
const html = await render(component)
const text = await render(component, { plainText: true })
```

Pass both `html` and `text` into the Lovable email API payload. Missing plaintext alone can route to Promotions on Gmail.

### 1.4 Stable `Message-ID` + `Date` + `MIME-Version`

The provider sets these, but verify in `email_send_log` that each send has a unique `message_id`. If not, generate `crypto.randomUUID()@techfleet.org` before enqueue.

---

## Phase 2 — Content shape (turns "Promotions" into "Primary")

Apply to all 10 templates under `_shared/email-templates/` and `_shared/transactional-email-templates/`:

### 2.1 Subject lines
- Sentence case, ≤ 50 chars, no emojis, no `[brackets]`, no "!", no $ amounts
- Verb + object: "Confirm your email", "Your application was received", "Project update: Acme Discovery"
- No words flagged by spam classifiers: `free`, `urgent`, `winner`, `congratulations`, `discount`, `act now`, all-caps

Specific renames:
- `signup.tsx` → `Confirm your email`
- `recovery.tsx` → `Reset your Tech Fleet password`
- `magic-link.tsx` → `Sign in to Tech Fleet`
- `invite.tsx` → `{inviter} invited you to Tech Fleet`
- `email-change.tsx` → `Confirm your new email`
- `reauthentication.tsx` → `Verify it's you`
- `project-blast.tsx` → subject already coordinator-supplied; sanitize to strip emoji/exclamation/all-caps server-side
- `fleety-coach-digest.tsx` → `Fleety weekly digest`
- `announcement.tsx` → use announcement title verbatim, capped 50 chars

### 2.2 Preheader (`<Preview>`)
Every template gets a real 60–90 char preheader that complements the subject. Empty/duplicate preheaders are a Gmail Promotions signal.

### 2.3 One CTA per email
Audit each template; if it has 2+ buttons, demote secondary links to inline text links. Promotional pattern = multiple buttons.

### 2.4 Strip promotional visuals
- Remove hero gradients, decorative banners, marketing footers
- Drop any `<Img>` tags from auth/transactional templates entirely. Logo as plain text wordmark
- Keep brand color (`#0056A7`) only on a single small element (button or wordmark)
- Body bg stays `#ffffff` (already enforced)
- Single column, ≤ 600px, text-to-image ratio must be 100% text on auth emails

### 2.5 Copy framing
Rewrite body copy to "you did X → here's Y":
- Welcome email becomes a receipt: "You just created a Tech Fleet account with onboarding@…. Click below to confirm."
- No marketing taglines, no feature lists, no "Join thousands of…"

### 2.6 Footer hygiene
- Physical mailing address (CAN-SPAM requirement on any bulk email — required by Gmail bulk policy too). Add Tech Fleet's mailing address to all bulk templates (`project-blast`, `fleety-weekly-digest`, `announcement`)
- Plain text unsubscribe link (we already inject a styled one — keep that, but add a plaintext copy in the `text` alternative)
- "Why did I get this?" line tying back to the user's action
- Reply-to clarification: "Reply directly to this email to reach a human"

### 2.7 Run reading-level + brand-terms lint
Extend `scripts/brand/reading-level.mjs` to scan all 10 email templates; fail CI if any subject/preview/body exceeds 7th-grade reading level or contains banned terms.

---

## Phase 3 — Sender reputation: warm-up + throttling

### 3.1 Bulk send throttle
Migration: add `bulk_hourly_cap INT DEFAULT 50` and `bulk_warmup_started_at TIMESTAMPTZ` to `email_send_state`.

In `process-email-queue`:
- Read cap per cycle. If `template_name IN ('project-blast','fleety-weekly-digest','announcement')`, count past-hour sends from `email_send_log` and skip dispatch (re-queue with delay) if at cap.
- Day 0–14: cap = 50/hr. Day 15–30: 200/hr. Day 31+: unlimited.
- Cron job `bump-email-warmup` runs daily 00:05 UTC, increments cap on the schedule.

### 3.2 Per-recipient frequency cap
No recipient gets more than 1 bulk email per 24h. Skip + log `frequency_capped` in `email_send_log`.

### 3.3 Engagement-based pause
New table `email_domain_health`:
- columns: `window_start`, `sent`, `bounced`, `complained`, `complaint_rate`
- Cron rolls up `email_send_log` every 15 min over a 7-day window
- If `complaint_rate > 0.1%` or `bounce_rate > 2%` → set `email_send_state.bulk_paused = true` and notify admins via Discord + System Health Triage tab
- Auto-resume after 24h of clean window (manual override available)

### 3.4 Suppression list tightening
- Honor Gmail "soft bounce" twice → add to suppression
- Strip role-based addresses (`postmaster@`, `abuse@`, `noreply@`) from any recipient list before enqueue

---

## Phase 4 — Domain reputation signals

### 4.1 BIMI prep (logo in Gmail)
Once DMARC stays at `p=quarantine` for 30 days, add:
- `default._bimi.techfleet.org` TXT → `v=BIMI1; l=https://techfleet.network/brand/bimi-logo.svg; a=https://techfleet.network/brand/bimi-vmc.pem`
- Requires a $1.5k Verified Mark Certificate from DigiCert/Entrust — defer, but generate the SVG-Tiny-PS logo now (`scripts/gen-variants.mjs` task) so it's ready.

### 4.2 MTA-STS + TLS-RPT (Microsoft trust signal)
Add at registrar (we'll generate the content):
- `_mta-sts.techfleet.org` TXT → `v=STSv1; id={timestamp}`
- `mta-sts.techfleet.org` → publish policy file at `https://mta-sts.techfleet.org/.well-known/mta-sts.txt`
- `_smtp._tls.techfleet.org` TXT → `v=TLSRPTv1; rua=mailto:tls-rpt@techfleet.org`

Microsoft and Yahoo now weight MTA-STS into placement decisions.

### 4.3 Google Postmaster Tools + Yahoo Sender Hub
Manual step (we surface the instructions in a README + System Health onboarding card):
- Verify `techfleet.org` at postmaster.google.com → daily reputation graph
- Register at yahoo.com/sender-hub
- Pipe DMARC aggregate reports (`dmarc@techfleet.org`) into a free parser (Postmark DMARC Digests or dmarcian community)

### 4.4 ARC-Authentication-Results passthrough
Lovable's sender already signs ARC; verify in a test send to a Gmail account that `ARC: PASS` shows in headers. No code change unless missing.

---

## Phase 5 — Observability + auto-remediation

### 5.1 System Health → Email tab additions
Extend the existing Email tab:
- Card: 7-day rolling spam complaint rate, bounce rate, deliverability score (green/yellow/red)
- Card: warm-up progress (current cap, next bump date)
- Card: last 50 sends with `From`, `Subject`, status, message-id, `auth_results` (SPF/DKIM/DMARC pass/fail)
- Card: top 10 bounced/complained domains
- Action: "Send test email" → dispatches each of the 10 templates to an admin-supplied mailbox, then displays Gmail Show-Original parsed auth results

### 5.2 Discord + email alerts
- Complaint rate > 0.05% (warning) → Discord
- Complaint rate > 0.1% (critical) → Discord + email all admins, auto-pause bulk
- DMARC aggregate reports show alignment failures > 1% of volume → daily digest into Triage queue

### 5.3 `email_health_snapshot` materialized view
Pre-aggregate `email_send_log` rollups (15-min refresh) so the Email tab loads in <100ms even at 100k sends/week.

---

## Phase 6 — Auth hook hardening

### 6.1 Reduce auth-email volume = better reputation
- Add request-deduplication in `auth-email-hook`: if the same (`email`, `template`, `token_hash`) was sent in the last 60s, drop the duplicate. Currently a double-click on "Forgot password" sends two emails → spam classifier penalty.
- Idle-resend cooldown: 5 min between magic-link sends per email

### 6.2 Don't enqueue auth emails for suppressed addresses
Already done for transactional; mirror the same check in `auth-email-hook` before `enqueue_email`. Today a bounced address keeps generating auth sends that 5xx → quality score tank.

---

## Phase 7 — Site-side trust signals (Gmail crawls these)

### 7.1 Public sender pages
- `/contact` page must show `onboarding@techfleet.org` as plain text — Gmail's classifier checks whether the From address resolves to a contactable human on the website. Currently the contact info lives behind auth.
- Privacy + Cookie pages already public — confirm they mention the sender domain explicitly.

### 7.2 `security.txt` already published; add `mailto:onboarding@techfleet.org` as a secondary contact.

### 7.3 Sitemap + robots
Confirm `onboarding@techfleet.org` is mentioned on the homepage footer (plain text, mailto link) — this single change measurably moves Gmail placement.

---

## Phase 8 — Tests + BDD

### 8.1 New BDD scenarios → `bdd_scenarios` table

`EMAIL-DELIV-001..020`, all tri-layered [UI]/[DB]/[Code]:

- 001 From header is `Tech Fleet <onboarding@techfleet.org>` on every send
- 002 Reply-To is `onboarding@techfleet.org`
- 003 DKIM-Signature header signs `notify.techfleet.org`
- 004 List-Unsubscribe + List-Unsubscribe-Post headers present on bulk templates
- 005 Plaintext alternative present and non-empty on every send
- 006 Subject lines under 50 chars, sentence case, no banned terms
- 007 Single CTA button per template (lint check)
- 008 Preheader present, 40–110 chars
- 009 No `<img>` tags in auth templates
- 010 Bulk hourly cap enforced; cap respects warm-up schedule
- 011 Per-recipient 24h frequency cap blocks dup
- 012 Suppressed address never enqueued (auth + transactional)
- 013 Complaint rate > 0.1% auto-pauses bulk + alerts admins
- 014 DMARC alignment pass verified via test send to Gmail
- 015 SPF and DKIM both PASS via test send
- 016 Duplicate auth send within 60s dropped
- 017 Magic link 5-min cooldown enforced
- 018 Footer contains physical address on bulk templates
- 019 Project-blast subject sanitized server-side (strip emoji/!/all-caps)
- 020 Email health snapshot refreshes every 15 min and surfaces in Email tab

### 8.2 Smoke tests
Extend `src/test/smoke/email-queue-processing.smoke.test.ts` to assert presence of: List-Unsubscribe header, plaintext body, single CTA, subject length, From domain.

### 8.3 Live test harness
New admin-only `/admin/email-deliverability-test` page (Card view):
- "Run full deliverability test" button → enqueues one of each of the 10 templates to a configurable address (default: admin's own email + a Gmail test mailbox we own)
- Polls Postmark's free SpamCheck API + manual Gmail Show-Original parsing
- Renders per-template grade (SPF/DKIM/DMARC/spam score)

---

## Phase 9 — Rollout sequence (so nothing breaks)

| Day | Action |
|---|---|
| 0 | Ship Phase 1 (From/Reply-To/headers/plaintext) + Phase 2 (templates) + Phase 7 (homepage mention) + BDD 001–009, 018, 019 |
| 0 | Ship Phase 6 (auth dedup + cooldown) + BDD 012, 016, 017 |
| 1 | Ship Phase 3 warm-up cap at 50/hr + Phase 5 Email tab cards + BDD 010, 011, 013, 020 |
| 1 | Ship Phase 8 test harness; run baseline test against all 10 templates |
| 7 | Review DMARC aggregate reports; tune SPF if any 3rd-party forwarder needs include |
| 14 | DMARC `p=none` → `p=quarantine`. Bump bulk cap 50 → 200/hr |
| 30 | DMARC `p=quarantine` → `p=reject`. Bulk cap 200 → unlimited |
| 30 | Ship Phase 4.1 BIMI (logo + DNS) once VMC purchased |
| 30 | Ship Phase 4.2 MTA-STS + TLS-RPT |

---

## Files touched (full list)

**Edge functions (redeploy required):**
- `supabase/functions/send-transactional-email/index.ts`
- `supabase/functions/auth-email-hook/index.ts`
- `supabase/functions/process-email-queue/index.ts`
- `supabase/functions/_shared/transactional-email.ts`
- `supabase/functions/_shared/email-templates/*.tsx` (6 files)
- `supabase/functions/_shared/transactional-email-templates/*.tsx` (all templates)
- `supabase/functions/_shared/transactional-email-templates/registry.ts`
- New: `supabase/functions/bump-email-warmup/index.ts`
- New: `supabase/functions/refresh-email-health/index.ts`

**Migration:**
- Add `bulk_hourly_cap`, `bulk_warmup_started_at`, `bulk_paused` to `email_send_state`
- Add `frequency_capped` to `email_send_log` status enum
- New table `email_domain_health`
- New materialized view `email_health_snapshot` + 15-min refresh cron
- Insert 20 BDD scenarios

**Frontend:**
- `src/pages/SystemHealthPage.tsx` (Email tab additions)
- New: `src/pages/AdminEmailDeliverabilityTestPage.tsx` + route
- `src/components/AppFooter.tsx` (add plaintext mailto)
- `src/pages/LandingPage.tsx` (footer mention)
- `src/test/smoke/email-queue-processing.smoke.test.ts`
- `scripts/brand/reading-level.mjs` (extend to email templates)

**DNS — already done by user (Phase 0):** DMARC, SPF merge, MX confirmed.
**DNS — later phases:** BIMI (Phase 4.1), MTA-STS + TLS-RPT (Phase 4.2).

---

## Out of scope (explicit)
- Switching off Lovable Emails
- Marketing/newsletter sending (we send transactional + admin-triggered project-blast only)
- Buying a VMC for BIMI today (deferred to Day 30)
- Changing the site URL (`techfleet.network` stays)
