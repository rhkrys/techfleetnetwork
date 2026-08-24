# Runbook — Email rearchitecture cutover & post-bake

The ordered go-live sequence for the email rearchitecture (PRs 1–10 on `feat/email-rearchitecture`).
Migrations here are HAND-APPLIED (edge functions + frontend deploy on merge to `main`). Do the steps
in order. Design: [ADR-0016](../adr/0016-email-tiering-and-notify-announcements-retirement.md),
[ADR-0017](0017-email-octopus-marketing-source-of-truth.md).

## Phase 0 — before merge (safe to do early)

1. **EO account:** accept/sign the Email Octopus DPA; add EO to the privacy-notice subprocessor list
   ([DPIA](../compliance/email-octopus-dpia.md)).
2. **Secrets (Supabase → Edge Functions):** set `EMAILOCTOPUS_API_KEY`, `EMAILOCTOPUS_LIST_ID`
   (optional `EMAILOCTOPUS_FIRSTNAME_FIELD` only if the list has that field tag). The webhook was
   dropped — no `EMAILOCTOPUS_WEBHOOK_SECRET` needed.
3. **One-time import into EO:** import the current Ghost newsletter subscribers and the ~163 existing
   platform announcement opt-ins, so EO is the complete marketing list.

## Phase 1 — merge & deploy

4. Merge `feat/email-rearchitecture` → `main`. Cloudflare Pages deploys the frontend; the edge-function
   workflow deploys the functions (including `email-octopus-sync`, `eo-contact-status`, the re-gated
   `send-announcement-email`).
5. **Apply the migrations** (in version order) via `_apply_migrations.mjs` (or the SQL editor). The
   deploy-time set that was held back during testing:
   - `20260820130000` notify_opportunities column (if not already applied for testing)
   - `20260820140000` scope-aware unsubscribe RPC
   - `20260820150000` quest-nudge re-gate
   - `20260820160000` project-opening fanout re-gate
   - `20260822120000` EO sync data layer (if not already applied for testing)
   - `20260822130000` EO worker reclaim + cron
   - `20260822140000` announcement attestation columns
   - `20260822150000` EO contact-delete trigger
   - `20260822160000` triage-digest removal
     Order matters: `20260820150000` must land with its edge-function code (it changes the quest-nudge
     RPC shape); `20260822130000` schedules the EO worker cron that pokes the now-deployed function.

## Phase 2 — verify (first hour)

6. **EO sync working:** toggle marketing in `/settings/notifications`; within ~2 min a
   `email_octopus_contact_sync` row goes `pending → synced` and the contact appears/updates in EO.
   `select * from public.get_eo_sync_health();` — backlog should trend to ~0.
7. **Announcement reach:** the next announcement requires the "not marketing" attestation and now
   reaches the `notify_opportunities` audience (~1200). It drains through the bulk lane at ~≤25/min
   over ~48 min — this is intended pacing, not a stall. Watch the first send's outbox
   (`_check_announcement_reach.mjs`) and Resend for bounce/complaint spikes.
8. **Tier-0 reach:** confirm sign-in/interview/applicant emails still send to 100% (guard-enforced).

## Phase 3 — post-bake cleanup (after ~1–2 weeks of healthy operation)

Only after the new senders have baked in and EO sync is healthy:

9. **Wire the paged backlog alert.** `get_eo_sync_health().pending_optout` / `.dlq_optout` above a
   baseline threshold = un-synced opt-outs = a compliance breach in progress. Add it to the System
   Health / config-preflight surface now that a normal baseline is known (wiring it before go-live
   would false-alarm on the initial drain). See [email-octopus-sync.md](email-octopus-sync.md).
10. **Drop `notify_announcements`.** Only when nothing reads or writes it any more. Remaining
    references to remove FIRST (all currently harmless dual-writes / legacy):
    - `set_email_opportunities_unsubscribed` RPC dual-writes `notify_announcements = false`
      (20260820140000) — drop that write.
    - `ProfileSetupPage` still carries `notify_announcements` in its form/schema (writes its default) —
      remove from the form + `profileSchema`.
    - `scope_aware_unsubscribe_test.sql` asserts the dual-write — update.
      Then a final migration: `ALTER TABLE public.profiles DROP COLUMN notify_announcements;` and remove
      it from `src/integrations/supabase/types.ts`. Do NOT do this before the deployed senders have moved
      off it (they did, at Phase 1 merge) AND the above references are gone.
