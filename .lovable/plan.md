# Fix: announcements silently dropped by 24h bulk frequency cap

## Root cause
`supabase/functions/process-email-queue/index.ts` enforces a per-recipient "1 bulk email per 24h" cap on the template set `{project-blast, fleety-coach-digest, announcement}`. Announcements are explicit opt-in broadcasts and must never be subject to a frequency cap intended for solicited-but-promotional digests. They are also silently dropped (status `frequency_capped`, deleted from queue), so admins think the send succeeded.

## Changes

### 1. Remove `announcement` from the 24h per-recipient cap
- In `process-email-queue/index.ts`, split the bulk set:
  - `BULK_DELIVERABILITY_TEMPLATES = {project-blast, fleety-coach-digest}` — subject to per-recipient 24h cap.
  - `BROADCAST_TEMPLATES = {announcement}` — subject only to global hourly cap + pause switch + suppression list + unsubscribe, **never** per-recipient frequency cap.
- Update the hourly-cap query and the per-message gating to use the new split.
- Announcements still respect: `bulk_paused`, `bulk_hourly_cap`, `suppressed_emails`, unsubscribe tokens, RFC 8058 headers.

### 2. Make the cap configurable + overridable for the two remaining templates
- Add columns to `email_send_state`:
  - `per_recipient_bulk_window_hours int default 24`
  - `per_recipient_bulk_max int default 1`
- Allow the enqueue payload to set `bypass_frequency_cap: true` (e.g., for admin-forced resend) — checked in the gating block.

### 3. Make failure visible instead of silent
- When a message is frequency-capped, also:
  - Insert an `agent_fix_queue` row with fingerprint `email.frequency_capped.<template>` (deduped) so it surfaces in System Health → Triage.
  - Surface a count in the System Health → Email tab ("Capped last 24h" KPI + per-template breakdown).
- Keep the `email_send_log` status `frequency_capped` (already there) so the existing dashboard can filter it.

### 4. Backfill / replay the announcements that were dropped
- One-off admin RPC `replay_frequency_capped(template_name, since)` that re-enqueues rows where `status='frequency_capped'` for the announcement(s) the user is missing. Admin-only, audit-logged.

### 5. BDD scenarios (stored in `bdd_scenarios`)
- ANN-CAP-001 announcement to opted-in recipient who received another announcement <24h ago → delivered (UI shows sent, DB row sent, edge log no frequency_capped).
- ANN-CAP-002 project-blast to recipient who received another project-blast <24h ago → blocked + visible in Triage + Email tab KPI increments.
- ANN-CAP-003 admin replay of capped rows re-enqueues and delivers, audit row written.
- ANN-CAP-004 `bypass_frequency_cap=true` on project-blast sends even within window, audit-logged.
- ANN-CAP-005 suppression + unsubscribe still block announcements (cap removal does not bypass consent).

### 6. Files touched
- `supabase/functions/process-email-queue/index.ts` (gating logic split)
- `supabase/functions/_shared/transactional-email.ts` (forward optional bypass flag into queue payload; keep `Precedence: bulk` headers on announcements)
- New migration: add columns to `email_send_state`, `replay_frequency_capped` RPC, RLS.
- `src/components/system-health/EmailDeliverabilityCard.tsx` (capped KPI + per-template breakdown)
- New admin action in announcements admin page: "Replay capped recipients" (only enabled when capped rows exist for that announcement).
- New BDD scenarios + smoke test extending `src/test/smoke/email-deliverability.smoke.test.ts`.

## Out of scope
- Removing the global hourly cap or the bulk circuit breaker (those protect deliverability and stay).
- Switching announcements off the `bulk` precedence/header set (Gmail/Yahoo still classify N:many opt-in mail as bulk; that's correct).
- Marketing email features.

## Success criteria
- Two announcements published the same day reach every opted-in recipient.
- Project-blast and fleety-coach-digest still capped to 1/recipient/24h unless explicitly overridden.
- Any future cap event is visible in Triage + Email tab within 5 minutes (no silent drops).
- All BDD scenarios pass; pre/post migration hash diff shows only the intended schema changes.
