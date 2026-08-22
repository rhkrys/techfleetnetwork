# Master Spec — Email Rearchitecture (one release, stacked PRs)

- **Status:** Draft for approval → build
- **Owner:** mdenner · **Date:** 2026-08-18
- **Bar:** 0 bugs, 0 regressions over time, scalable to 100,000 users, globally compliant.
- **Skills applied (all):** enterprise-architecture-standards, compliance-data-lifecycle,
  owasp-secure-coding-bdd, bdd-comprehensive-testing, comprehensive-test-strategy,
  release-deployment-safety, sre-operational-readiness, architectural-decision-records.
- **This document is authoritative.** It combines and supersedes the four working docs:
  - `unified-email-consent-and-sync.md` (marketing SoT + Ghost/EO sync)
  - `platform-email-tiering-and-notify-flag-cleanup.md` (transactional tiering)
  - `email-cleanup-HANDOFF-and-tracker.md` (investigation + reach findings)
  - `email-audit-decision-table.md` (the owner-populated per-email decisions)
- **Spawns ADRs:** 0013 consent ledger (SoR), 0014 Ghost/EO sync topology, 0015
  transactional/marketing separation & suppression scopes, 0016 email tiering & retirement of
  `notify_announcements`. Written as PR-1's first commits, per repo convention.

---

## 1. What we're solving (one paragraph)

Three disconnected email systems (Resend transactional, Ghost newsletter, Email Octopus
marketing) with no shared source of truth; a single overloaded profile flag
(`notify_announcements`, default `false`) that silently suppresses **critical** transactional
mail for ~87% of users; two email types (`project_opening_alert`, `feedback_alert`) that have
been **delivering nothing since July** because they sit on a retired queue; and no real,
provable, per-purpose marketing consent for a genuinely global (86-country) userbase. We fix all
of it in one release: a clean three-tier send model, a per-purpose consent ledger as the single
source of truth, and live two-way sync to Ghost + Email Octopus.

## 2. Locked decisions (complete)

**Send model**

- **Three tiers**, tier is a property of the **email type** in a central registry:
  - **Tier 0 — Critical transactional:** always send; no preference can suppress it; only global
    suppression (hard bounce / spam complaint) stops it.
  - **Tier 1 — Service / opportunity:** everyone by default, with **one** "Opportunities &
    platform updates" opt-out (default ON). One-click unsubscribe writes this opt-out.
  - **Tier 2 — Marketing:** express **opt-in only**, recipients drawn only from the consent
    ledger, per purpose.
- **`notify_announcements` is retired** entirely (drop after bake-in). Supersedes the consent
  doc's §8.4.

**Compliance / consent**

- **Global bar** (GDPR + CCPA/CPRA + **CASL** as the strictest): marketing is express opt-in,
  consent is provable (timestamp + source + notice version), every Tier 1 & 2 email carries a
  working one-click unsubscribe + `List-Unsubscribe` header + physical postal address.
- **A short DPIA is written** (truly global, large-scale consent processing).
- **Unified marketing consent** (owner decision 2026-08-18, supersedes the earlier per-channel
  split). One opt-in, "Marketing and news", one value per person: `consent_current.marketing`
  (channel `email` now; `sms` reserved for later as a separate opt-in). Opting in adds the person
  to **both** Ghost and Email Octopus; unsubscribing anywhere removes them from both.
- **Marketing/opportunity opt-out must NEVER add a global `suppressed_emails` row.** Scopes are
  independent; a marketing unsubscribe must not stop a password reset. Global suppression applies
  to all tiers and always wins.
- **Three unsubscribe buckets**, and every unsubscribe belongs to exactly one:
  1. **Marketing and news** (Ghost + EO) — off in the platform, removed from both real lists by API.
  2. **Opportunities and platform updates** (Tier 1 "system" email) — sets the Tier-1 opt-out only.
  3. **Critical account email** (Tier 0) — no unsubscribe; only a hard bounce/complaint stops it.

**Marketing platforms**

- **Keep both** Ghost and Email Octopus. Ghost runs a **single newsletter** and sends nothing but
  that newsletter, so all of Ghost is the one marketing bucket. Both vendors go **live this
  release** (API keys ready → Vault).
- **Platform is the single source of truth** (`consent_current.marketing`). Ghost and EO are
  **mirrors**, driven by API on every change; sync is hub-and-spoke with webhook write-back and a
  nightly reconcile that forces both real lists to match the platform. Strict loop-prevention.

**Migration**

- **The 163** current announcement opt-ins → grandfathered into the unified **marketing** consent
  (so onto both Ghost and EO) as consent events.
- **Existing Ghost/EO subscribers** → grandfathered by **email match** to platform users; matched
  → consent events; unmatched → catalogued as platform-external.
- **Everyone else** → marketing opted-out by default (no auto-subscribe).
- **Tier-1 preference** → default ON, backfilled ON for all existing users.

**Rollout**

- Tier-0 fixes reach every triggered user **immediately** (urgent bug). The first **all-member**
  service blast is **ramped in batches** with bounce/complaint monitoring; the **auth lane stays
  isolated** so a service/marketing complaint spike can never throttle password resets.

## 3. Final email inventory → tier map (code-verified 2026-08-18)

| Email (template)                                                                       | Lane today | **Tier**           | Recipients                                            | Member control                                      |
| -------------------------------------------------------------------------------------- | ---------- | ------------------ | ----------------------------------------------------- | --------------------------------------------------- |
| Auth: signup/invite/magic-link/recovery/email-change/reauth                            | auth       | **0**              | the user                                              | none                                                |
| Unconfirmed-signup reminder (`signup`) + safety-net resend                             | auth       | **0**              | the user                                              | none                                                |
| General-application submitted                                                          | transac    | **0**              | applicant                                             | none                                                |
| Project-application submitted                                                          | transac    | **0**              | applicant                                             | none                                                |
| Support-ticket reply                                                                   | transac    | **0**              | requester                                             | none                                                |
| Teacher / Admin role confirmation (`teacher_promotion`/`admin_promotion`, inline HTML) | transac    | **0**              | the user                                              | none                                                |
| Class status change (`class-status-change`)                                            | transac    | **0**              | teacher (owner) + admins (trainee idea dropped)       | none                                                |
| Interview invitation                                                                   | transac    | **0**              | applicant                                             | none — **remove `notify_announcements` gate (BUG)** |
| Applicant status change                                                                | transac    | **0**              | applicant                                             | none — **remove gate (BUG)**                        |
| Observer role granted                                                                  | transac    | **0**              | the user                                              | none — **remove gate (BUG)**                        |
| Community/training agreement offer                                                     | transac    | **0**              | the user                                              | none — **remove gate (BUG)**                        |
| Resume-application reminder (`resume-application`)                                     | transac    | **0** (owner call) | the user                                              | none                                                |
| **Project blast** (`project-blast`)                                                    | bulk       | **0** (owner call) | project's completed applicants                        | none                                                |
| Project opening alert (`project_opening_alert`) 🔴 dead queue                          | _raw→v2_   | **1**              | **all active** (interest filter REMOVED this release) | Tier-1 opt-out                                      |
| Quest re-engagement nudge (`quest-nudge`)                                              | transac    | **1**              | targeted segment                                      | Tier-1 opt-out                                      |
| Service announcement (`announcement`, service-tagged)                                  | bulk       | **1**              | all active − opt-out                                  | Tier-1 opt-out                                      |
| Promotional announcement (`announcement`, marketing-tagged)                            | bulk       | **2**              | consent ledger (`marketing`)                          | unified marketing opt-in                            |
| Community newsletter (Ghost, single newsletter)                                        | external   | **2**              | consent ledger (`marketing`)                          | unified marketing opt-in                            |
| Marketing campaigns (Email Octopus)                                                    | external   | **2**              | consent ledger (`marketing`)                          | unified marketing opt-in                            |
| Admin member-status alert (`admin-member-alert`)                                       | transac    | **Ops**            | project **coordinator** (already so)                  | n/a                                                 |
| New-feedback admin alert (`feedback_alert`) 🔴 dead queue                              | _raw→v2_   | **Ops**            | all admins                                            | n/a                                                 |
| Fleety Coach weekly digest (`fleety-coach-digest`)                                     | bulk       | **Ops**            | all admins                                            | n/a                                                 |
| ~~Daily error-triage digest (`triage-digest`)~~                                        | transac    | **REMOVED**        | —                                                     | **whole feature deleted (email + Discord + cron)**  |

**Cleanups riding along:** C1 remove dead `signup-confirmation-reminder` template · C2 fix
old-domain unsubscribe links → `techfleet.network` **and** wire one-click unsubscribe to set the
Tier-1 opt-out · C3+C5+C6+C7 eradicate the retired raw `enqueue_email` queue (2 senders +
reconciler + 2 DLQ-replay paths + announcement fallback) · C8 bring inline-HTML templates
(`admin_promotion`, `teacher_promotion`, `announcement`) into the registry · C4 drop
`notify_announcements` after bake-in.

## 4. Architecture (enterprise-arch; built for 100k)

**4.1 Email-type → tier registry.** One central map (`tier`, `purpose`, `lane`, `unsub_behavior`)
keyed by template name. Every sender resolves its tier from the registry; no sender hard-codes a
preference read. A CI **fitness test** fails the build if (a) a Tier-0 path reads any member
preference, or (b) any code enqueues to the retired raw queue, or (c) a template exists without a
registry entry.

**4.2 Consent ledger = source of truth (ADR-0013).** Append-only `consent_event` →
`consent_current` projection, keyed `(subject_email, purpose, channel)`; carries
`source, notice_version, actor, request_ip, occurred_at`. The ledger _is_ the compliance audit
trail. Projection is indexed on `(purpose, channel, state)` and `(user_id)` for set-based
recipient resolution (never per-user loops) — this is the 100k-scale hinge.

**4.3 Sync topology (ADR-0014).** Hub-and-spoke, platform is the hub:

- _Outbound:_ consent change → job on the existing pgmq queue (+ DLQ + replay) → idempotent
  upsert/unsubscribe via Ghost Admin API / EO API adapters; rate-limited to each vendor's limits.
- _Inbound:_ HMAC-verified webhooks (Ghost `member.updated`/`member.deleted`; EO unsubscribe) →
  write consent events.
- _Backstop:_ nightly reconcile pulls both platforms, diffs the projection, heals drift; catches
  missed webhooks **and** the Ghost-CSV-import-no-webhook gap.
- _Loop-prevention:_ external unsub → update platform → propagate to the **other** system only,
  never echo to origin; enforced by `source` tagging + push-only-if-state-differs.

**4.4 Suppression scopes (ADR-0015).** Three independent scopes: global (`suppressed_emails`;
all tiers; always wins), Tier-1 opt-out (profile pref), Tier-2 per-purpose consent. A test
asserts a marketing/opportunity opt-out never writes a global suppression row.

**4.5 Recipient resolution & sending at scale.** All broadcast recipient sets resolve via
set-based SQL over indexed columns; sends remain 1:1 through the v2 outbox + dispatcher (already
batched, idempotent by key). Bulk lane is throttled; auth lane is physically isolated.

## 5. Compliance (compliance-data-lifecycle)

- **Lawful basis per tier:** Tier 0 contract/legitimate-interest; Tier 1 legitimate-interest with
  opt-out; Tier 2 consent. Documented in the DPIA.
- **Data-subject rights, executable:** deletion propagates to Ghost + EO (extend `delete-account`);
  data export includes the consent history; objection = a toggle-off that propagates promptly.
- **Consent provability:** every opt-in/out is a ledger event with timestamp, source, notice
  version, actor, IP.
- **Retention:** consent events retained 24 months past account deletion (pseudonymized) as proof
  of prior consent — _confirm in DPIA_.
- **DPIA** written this release (`docs/compliance/email-consent-dpia.md`).

## 6. Security (owasp-secure-coding-bdd)

- Secrets in Vault: `GHOST_ADMIN_API_KEY`, `EMAILOCTOPUS_API_KEY`, per-webhook signing secrets.
- Inbound webhooks verify signature (EO HMAC-SHA256; Ghost shared-secret) and reject on failure.
- Consent writes via SECURITY DEFINER RPCs, `authenticated`-only, RLS to own-rows; run the
  mandatory **lockout / accidental-deletion safety check** before the deletion-propagation and any
  grant change.
- No PII in worker/sync logs (user id or hashed email only); the ledger is the sole identity store
  and is access-controlled.
- Rate-limit/bulkhead the outbound vendor clients so a reconcile storm can't hammer Ghost/EO.

## 7. Testing (bdd-comprehensive-testing + comprehensive-test-strategy)

**Behavioral (@compliance/@security/@critical, wired into the existing CI gate):** every scenario
from the two sub-specs, plus: Tier-0-always-send with all prefs off; marketing opt-out doesn't
stop account mail; external unsub propagates to the _other_ platform only (no loop); webhook bad
signature rejected; grandfather migration preserves counts with no auto-subscribe; announcement
purpose-picker mandatory + audited.

**Structural:** fitness tests (§4.1) — no Tier-0 pref read, no raw-queue enqueue, registry
completeness. Contract tests for Ghost/EO adapters. Idempotency + loop-prevention unit tests.
Reconciliation drift test. A **reach-parity** acceptance check (Tier-1 audience ≈ active − opt-outs)
and a **before/after send-log** check proving Tier-0 reach goes from ~163 to 100% of triggered
users.

## 8. Release plan — stacked PRs (release-deployment-safety)

Expand → migrate → contract. Each PR is independently shippable, reversible, and gated by its
tests. Waves 0–1 are the urgent remediation and can land first; later waves stack behind the
`unified_consent_sync` flag.

| PR     | Title                                                                                                                                            | Wave | Depends on | Reversible via                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---------- | -------------------------------- |
| **1**  | ADRs 0013–0016 + email-type→tier **registry** + CI fitness tests                                                                                 | 0    | —          | revert (docs+test only)          |
| **2**  | **Eradicate the retired raw queue**: repoint the 2 dead senders + reconciler + 2 DLQ replays + announcement fallback to v2; fix old-domain links | 0    | 1          | flag/revert; restores lost mail  |
| **3**  | **Tier-0 gate removal** (interview/status/observer/agreement/class→trainee/resume/project-blast) + always-send invariant test                    | 0    | 1          | per-template flag                |
| **4**  | Tier-1 preference (default ON) + backfill + profile UI + one-click-unsub→opt-out wiring; dual-read                                               | 1    | 1          | drop column; dual-read safe      |
| **5**  | Re-gate Tier-1 emails (project-opening=all users, quest nudge, service announcement) to the toggle                                               | 1    | 4          | revert to prior gate             |
| **6**  | Consent **ledger + projection + RPCs + RLS + pgTAP** (dark)                                                                                      | 2    | 1          | additive; unused until wired     |
| **7**  | **Grandfather backfill** (163→promotions; Ghost/EO match) — dry-run → live                                                                       | 2    | 6          | events reversible; audit-logged  |
| **8**  | **Outbound sync** (Ghost + EO adapters, queue, idempotent, loop-prevention, Vault secrets)                                                       | 3    | 6          | flag off = no external writes    |
| **9**  | **Inbound webhooks** (HMAC) + **reconcile cron**                                                                                                 | 3    | 6,8        | flag off; record-only mode first |
| **10** | Signup marketing checkboxes + **preference center** (per-purpose) → ledger                                                                       | 4    | 6          | flag-gated UI                    |
| **11** | Announcement **purpose-picker** (Service→all−optout / Marketing→ledger) + audience preview + audit                                               | 4    | 5,6        | revert to current composer       |
| **12** | **DSAR**: deletion propagation to Ghost/EO + consent history in export + **DPIA**                                                                | 5    | 8          | additive                         |
| **13** | Remove **triage-digest** feature (email+Discord+cron); C8 inline→registry; C1 dead template                                                      | 5    | 1          | revert                           |
| **14** | **Observability + runbook + deliverability ramp**; then **contract: drop `notify_announcements`** after bake-in (C4)                             | 5    | all        | drop is last, post-soak          |

Total ~14 PRs; 1–3 are the urgent, independently-valuable core. I'll open each in its own
worktree off a shared `feat/email-rearchitecture` integration branch (repo convention — never two
agents in one dir).

## 9. Deliverability & operational readiness (sre-operational-readiness)

- **Auth-lane isolation** preserved throughout; verified by a test that a bulk-lane complaint spike
  can't affect the auth lane.
- **Ramp:** first all-member service blast sent in throttled batches; monitor bounce + complaint
  rate against thresholds before widening.
- **SLIs/SLOs:** Tier-0 send success ≈100% (minus global suppression); consent→external
  propagation p95 < 5 min; webhook ingest > 99%; reconciliation drift → ~0.
- **Symptom alerts:** any Tier-0 template suppressed-by-preference (impossible → page); sync DLQ
  depth > 0; webhook signature-failure spike; complaint-rate breach on the bulk lane; drift above
  threshold (proxy for "emailing someone who opted out").
- **Runbook:** `docs/runbooks/email-consent-sync.md` — service vs marketing send, audience-preview
  verification, DLQ replay, force-reconcile, webhook-secret rotation, Ghost/EO outage handling,
  deliverability-ramp checklist.

## 10. Definition of Done

- [ ] Tier-0 reach proven ~163 → 100% of triggered users (BDD + before/after send-log).
- [ ] No sender reads `notify_announcements`; no code enqueues the raw queue; registry complete
      (all three fitness tests green).
- [ ] `project_opening_alert` + `feedback_alert` delivering again (verified in send-log).
- [ ] Tier-1 toggle default ON + backfilled; Tier-1 emails re-gated; one-click unsub sets it.
- [ ] Consent ledger live; 163 grandfathered to promotions; Ghost/EO matched; no auto-subscribe.
- [ ] Ghost + EO two-way sync live; loop-prevention + reconcile proven; DSAR propagation works.
- [ ] Announcement purpose-picker enforced + audited; marketing routes only from the ledger.
- [ ] triage-digest removed; inline templates in registry; dead template gone; links fixed.
- [ ] DPIA written; global-compliance BDD green; deliverability ramp completed with no breach.
- [ ] `notify_announcements` dropped after bake-in; both sub-docs reconciled to this master.
