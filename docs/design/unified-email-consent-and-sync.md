# Requirements Spec — Unified Email Consent & Cross-System Sync

- **Status:** Draft / for review
- **Owner:** mdenner
- **Date:** 2026-08-18
- **Skills applied:** compliance-data-lifecycle, enterprise-architecture-standards,
  architectural-decision-records, owasp-secure-coding-bdd, bdd-comprehensive-testing,
  release-deployment-safety, sre-operational-readiness
- **Spawns ADRs:** 0013 (consent system-of-record), 0014 (cross-system sync topology),
  0015 (transactional vs. marketing scope separation). Written when the plan is approved,
  per the repo convention (spec first → ADRs record each load-bearing decision).

---

## 1. Problem

Three email systems, no shared source of truth:

| System                   | Purpose                           | Owner          | Consent today                                                  |
| ------------------------ | --------------------------------- | -------------- | -------------------------------------------------------------- |
| **Resend** (TF platform) | Transactional / account email     | Platform       | `electronic_comms_consent_at` at signup + two profile booleans |
| **Ghost**                | Community newsletter (editorial)  | Community team | Manual list, manually synced                                   |
| **Email Octopus** (new)  | Marketing / promotional campaigns | Marketing team | Manual list, manually synced                                   |

Consequences of the split: consent state lives in three places and drifts; an unsubscribe in
one system doesn't reach the others (a real compliance exposure — you can keep emailing
someone who opted out); the marketing audience is maintained by hand; and there is **no
marketing opt-in at all in the platform today** (verified — greenfield).

## 2. Goal

**The platform is the single source of truth for who may be emailed, for what, on which
channel.** Every opt-in and every unsubscribe — wherever it physically happens — is recorded
on the platform and propagated to the other systems. One funnel, starting at signup.

## 3. Locked decisions (from owner Q&A, 2026-08-18)

1. **Keep both Ghost and Email Octopus.** They are distinct purposes run by distinct teams
   (Ghost = community newsletter; EO = marketing promos), not redundant. → 3-system sync is
   in scope.
2. **Per-channel consent**, not one blanket marketing toggle (see §4).
3. **Grandfather existing subscribers by email match** — match current Ghost/EO subscribers
   to platform users by normalized email and carry their existing consent forward.
4. **Backfill default = opted-out, except grandfathered matches.** Nobody is auto-subscribed;
   only people already on a list keep their subscription.
5. **Email only now; SMS is a later phase** — but the consent model is built with a `channel`
   (medium) axis so SMS is a new row, not a schema change.

## 4. The consent model (answers "what channels need to be separate for compliance?")

Consent has **two independent axes**. Conflating them is the classic compliance mistake.

### Axis A — Purpose (why you're emailing)

| Purpose                                                                | Lawful basis                   | Consent required?                                                                              | Maps to                                        |
| ---------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Transactional / account** (password reset, security, account alerts) | Contract / legitimate interest | **No** — cannot be unsubscribed from; you must be able to reach a user about their own account | Resend; existing `electronic_comms_consent_at` |
| **Community newsletter**                                               | Consent                        | **Yes** — explicit opt-in                                                                      | Ghost                                          |
| **Marketing / promotions**                                             | Consent                        | **Yes** — explicit opt-in, separate from newsletter                                            | Email Octopus                                  |

Why newsletter and promotions are **separate** consents (not one "marketing" toggle):
GDPR requires consent to be **granular per purpose** and objection to be honorable per
purpose — a user must be able to keep the community newsletter while dropping promos, or vice
versa. They're different senders, different teams, different content. Separate consent is both
the owner's choice and the more defensible posture. (Ref: GDPR Art. 5 purpose limitation +
granular-consent rule.)

### Axis B — Channel / medium (how you reach them)

| Channel        | Status                          | Note                                                                                                                                                                                        |
| -------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Email**      | Now                             | Governed by CAN-SPAM (US) + GDPR/consent                                                                                                                                                    |
| **SMS / text** | Later (designed-for, not built) | **Requires its own explicit opt-in** — US TCPA demands _prior express written consent_ for marketing texts; email consent never covers SMS. This is exactly why channel is a separate axis. |

**Net:** a consent record is keyed on `(subject, purpose, channel)`. Today that yields three
live consent scopes — `newsletter/email`, `promotions/email`, plus the non-consent
transactional scope — and reserves `*/sms` for later with zero rework.

### The critical separation rule

> A marketing unsubscribe (newsletter or promotions) **must never** suppress transactional
> email. Password resets and security notices still send.

The existing `suppressed_emails` table is a **global** address kill-switch — correct for hard
bounces and spam complaints (which _should_ stop everything), wrong for a marketing opt-out.
Marketing consent is withdrawn by clearing the per-purpose consent, **not** by adding a global
suppression row. (→ ADR-0015.)

## 5. System of record — data model

Platform holds consent as an **append-only event ledger + a current-state projection** — the
same pattern already proven in this codebase (membership ledger re-architecture). The ledger
_is_ the compliance audit trail the framework requires (consent given/withdrawn is an
explicitly auditable event).

```
consent_event  (append-only, immutable)          consent_current  (projection)
─────────────────────────────────────            ─────────────────────────────
id                                                subject_email  (normalized, lower)
subject_email  (normalized, lower)                purpose        (newsletter|promotions|…)
user_id        (nullable — see §7)                channel        (email|sms)
purpose                                           state          (subscribed|unsubscribed)
channel                                           updated_at
state          (subscribed|unsubscribed)          last_event_id
source         (platform_signup|profile|          source
                ghost_webhook|eo_webhook|
                migration|admin|dsar)
notice_version (which consent text was shown)
occurred_at
actor          (who caused it — user/admin/system)
request_ip
```

Each event records **who / what / when / where / source** — the audit-logging schema the
compliance skill mandates. The projection is what the app and sync workers read. RLS: a user
reads only their own rows; writes go through SECURITY DEFINER RPCs, never client-direct.

## 6. Sync architecture (hub-and-spoke, platform is the hub)

Because every Ghost/EO email carries its own unsubscribe link, sync is **bidirectional at the
edges but single-authority at the center**:

```
                    ┌──────────────────────────────┐
                    │   PLATFORM  = source of truth │
                    │   consent_event → projection   │
                    └───────┬───────────────▲───────┘
     outbound push (queue)  │               │  inbound webhooks (HMAC-verified)
              ┌─────────────┘               └──────────────┐
              ▼                                             ▼
        ┌───────────┐   nightly reconcile (cron)     ┌──────────────┐
        │   Ghost   │◄──────── diff + heal ─────────►│ Email Octopus│
        └───────────┘                                 └──────────────┘
```

**6a. Outbound** — a consent change enqueues a sync job (reuse the existing pgmq queue + DLQ +
replay infra; do **not** build new plumbing). A worker upserts/unsubscribes the member via the
Ghost Admin API and/or EO API. Idempotent (upsert by email; no-op if target already matches).

**6b. Inbound** — two edge-function webhook receivers:

- Ghost `member.updated` / `member.deleted` (fires on in-newsletter unsubscribe).
- Email Octopus unsubscribe events (**HMAC-SHA256** signature verified — EO provides this).

Each verifies signature → writes a `consent_event` with the right `source` → projection
updates.

**6c. Loop prevention (the golden rule).** External unsub → update platform → propagate to the
_other_ system only, **never echo back to the origin**. Enforced by (a) `source` tagging and
(b) idempotency: the outbound worker pushes only when the target's state actually differs.
Without this, Ghost→platform→Ghost would ping-pong.

**6d. Reconciliation cron (backstop).** Nightly full pull from Ghost + EO, diff against the
projection, heal drift. Covers missed/failed webhooks **and** the known Ghost gotcha:
_Ghost CSV imports do not fire member webhooks_, so any bulk change bypasses 6b and is only
caught here. (Ref confirmed in platform-API research.)

**Right-sizing note (enterprise-arch):** no message bus, no new microservice. This is edge
functions + the queue + cron the app already runs. Two ~hundred-row-at-a-time API clients and
a diff job — matched to ~767 users, not to imagined future scale.

## 7. Migration / backfill (grandfather)

One-time, run as a safe data migration (row counts, dry-run, reversible, audit-logged):

1. Export current Ghost members + EO contacts.
2. Normalize + match by email to platform users.
3. **Match found** → write `consent_event(source=migration, state=subscribed)` for that
   purpose/channel. Grandfathers prior consent (defensible: they were already subscribed).
4. **No platform match** → subscriber stays **platform-external** (managed outside the funnel).
   These are catalogued, not deleted; document the population and a path to fold them in
   (e.g. invite to the platform). This is the honest limit of "platform as source of truth":
   it can only govern people who are platform users.
5. Existing 767 users on **no** list → default opted-out. No auto-subscribe (CAN-SPAM/GDPR).

## 8. New funnel (target behavior)

1. **Sign up** → transactional consent captured as today (unchanged).
2. **Marketing opt-in at signup** → two optional, unticked checkboxes (newsletter, promotions).
   Opt-in only, never pre-checked (consent must be unambiguous).
   - Newsletter checked → subscribe in **Ghost**.
   - Promotions checked → subscribe in **Email Octopus**.
   - Neither → added to neither.
3. **Preference center** (extend the existing profile/notification settings surface) → user
   flips newsletter / promotions / (later) SMS any time; as-easy-to-withdraw-as-to-give.
4. **System-email preferences** → the existing `notify_announcements` /
   `notify_training_opportunities` booleans stay as the optional-transactional controls,
   surfaced at signup and in profile. (Security-critical mail is never toggleable.)

## 9. Data-subject rights (must stay executable)

- **Erasure / account deletion** → extend the existing `delete-account` edge function to also
  delete the member in Ghost and the contact in EO. Deletion must propagate everywhere.
- **Export / portability** → include full consent history (the ledger) in the user data export.
- **Objection / restriction** → a marketing toggle-off _is_ an objection; it must propagate
  promptly (via 6a) — SLO in §12.

## 10. Security (OWASP pass)

- Secrets in Supabase Vault: `GHOST_ADMIN_API_KEY`, `EMAILOCTOPUS_API_KEY`, plus a signing
  secret per inbound webhook. Never in code.
- **Webhook receivers verify signatures** (EO HMAC-SHA256; Ghost via a shared-secret path
  param + payload check) and reject on failure — untrusted inbound is the main attack surface.
- Consent-write RPCs are SECURITY DEFINER with `authenticated`-only grants; RLS keeps a user
  to their own rows. Run the mandatory **lockout / accidental-deletion check** before shipping
  the deletion-propagation and any grant change.
- **No PII in logs** — log a user id or a hashed email, never raw addresses, in sync/worker
  logs. (Audit ledger is the one place identity lives, and it's access-controlled.)
- Rate-limit / bulkhead the outbound API clients so a reconcile storm can't hammer Ghost/EO.

## 11. Testing (BDD + strategy)

`@compliance` / `@security` Gherkin wired into CI (this repo already runs a security gate).
Core scenarios:

```gherkin
@compliance
Scenario: Marketing unsubscribe does not stop account email
  Given a user has unsubscribed from promotions
  When the system sends a password-reset email
  Then the email is delivered

@compliance
Scenario: Unsubscribe in Email Octopus propagates to the platform and Ghost
  Given a user is subscribed to newsletter and promotions
  When Email Octopus reports them unsubscribed from promotions
  Then the platform records promotions=unsubscribed
  And Ghost newsletter subscription is unchanged

@compliance
Scenario: Consent is logged with source and timestamp
  When a user opts in to the newsletter at signup
  Then a consent_event records purpose=newsletter, channel=email, source=platform_signup, a timestamp, and the notice version

@security
Scenario: Webhook with a bad signature is rejected
  When an unsubscribe webhook arrives with an invalid HMAC
  Then it is rejected and no consent state changes

@data-lifecycle
Scenario: Grandfather migration preserves subscriber counts
  Given N matched subscribers across Ghost and EO
  When the backfill runs
  Then N consent_events with source=migration exist and no user was auto-subscribed
```

Plus: contract tests against Ghost/EO API client adapters, idempotency/loop-prevention unit
tests, and reconciliation drift tests.

## 12. Release safety & operational readiness

- **Expand/contract migration**: add `consent_event` + `consent_current` and backfill before
  any UI reads them; ship behind a **feature flag** (`unified_consent_sync`) so outbound sync
  can be dark-launched and flipped per environment.
- **Rollout order**: schema → backfill (dry-run first) → inbound webhooks (record-only) →
  outbound sync (flag on) → signup/profile UI. Each step independently reversible.
- **SLIs/SLOs**: consent-change → external-system propagation **p95 < 5 min**; webhook
  ingestion success rate > 99%; reconciliation drift count trends to ~0.
- **Alerts (symptom-based)**: DLQ depth > 0 for sync jobs; webhook signature-failure spike;
  reconciliation drift above threshold (a proxy for "we're emailing someone who opted out").
- **Runbook**: `docs/runbooks/email-consent-sync.md` — how to replay the DLQ, force a
  reconcile, rotate a webhook secret, and handle a Ghost/EO API outage (queue drains when it
  recovers; transactional email is unaffected).

## 13. Open decisions (need owner input before build)

1. **Double opt-in?** Platform-captured consent (checkbox + logged timestamp/IP/version) is
   defensible as single opt-in. Ghost/EO can _also_ send their own confirmation email. Do we
   want confirmation emails, or trust the platform record? (Deliverability vs. friction.)
2. **Non-user subscribers** — beyond "catalogue them," is there appetite to invite them to the
   platform, or leave those lists frozen and unmanaged?
3. **Consent-log retention** — the ledger should outlive the account (proof of past consent).
   Propose: retain consent events 24 months past account deletion (pseudonymized). Confirm.
4. **DPIA** — if there are EU/UK subscribers, a light DPIA is worth writing (large-scale
   consent processing). Any known EU audience?
5. **Which system "owns" a shared subscriber's identity fields** (name, tags) — platform
   pushes name/email; do the teams need Ghost/EO-side segments/tags synced too, or just
   subscribe-state?

## 14. Phasing (proposed)

- **Phase 0** — schema + consent ledger + projection + RPCs (dark, no UI).
- **Phase 1** — inbound webhooks in record-only mode + reconciliation cron (observe drift, no
  writes out).
- **Phase 2** — outbound sync behind flag + grandfather backfill (dry-run → live).
- **Phase 3** — signup checkboxes + preference center UI.
- **Phase 4** — deletion propagation + export wiring + runbook + alerts.
- **Later** — SMS channel (new rows on the existing axes; separate TCPA consent copy).

```

```
