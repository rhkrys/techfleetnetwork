# Email Rearchitecture: Requirements Document

- **Status:** Approved design, ready to build
- **Owner:** mdenner
- **Date:** 2026-08-19
- **Applies to:** Tech Fleet Network platform (Vite + React + Supabase), Ghost, Email Octopus
- **Skills applied:** enterprise-architecture-standards, compliance-data-lifecycle,
  owasp-secure-coding-bdd, bdd-comprehensive-testing, comprehensive-test-strategy,
  release-deployment-safety, sre-operational-readiness, architectural-decision-records

This is the single authoritative requirements document. It consolidates and supersedes the
working files (master spec, consent and sync spec, tiering spec, decision table, UX build
standard, threat model). Where this document and any earlier file disagree, this document wins.

---

## 1. Purpose

Give Tech Fleet one clean, compliant email system with a single source of truth for who may be
emailed, for what, on which channel. Fix the live problems that are silently dropping critical
mail today, and unify three disconnected systems (Resend transactional, Ghost newsletter, Email
Octopus marketing) behind one consent record on the platform.

## 2. Problem statement (evidence-backed, verified 2026-08-18)

1. **Critical email reaches only about 13 percent of people.** Interview invitations, application
   status changes, observer role grants, and the training agreement offer are gated on the profile
   flag `notify_announcements`, which is `NOT NULL DEFAULT false`. Only 163 of 1,253 accounts have
   it on. The author intended it to default on, but the column default makes it a hard false, so
   the safeguard never fires and time-critical mail is dropped for roughly 87 percent of people.
2. **One flag does four jobs.** `notify_announcements` gates both marketing announcements and
   genuinely transactional email, which is why de-overloading it is the core of this work.
3. **Two emails have been delivering nothing since July.** `project_opening_alert` and
   `feedback_alert` are emitted only by database triggers that still enqueue onto the retired raw
   `enqueue_email` queue, which has no consumer after the July v2 cutover.
4. **No real marketing consent exists.** There is no marketing opt-in anywhere today, and
   "announcements" mixes operational and promotional content under one flag.
5. **Three systems, no shared truth.** Ghost and Email Octopus lists are maintained by hand and
   synced manually, so consent drifts and an unsubscribe in one place does not reach the others.

## 3. Goals and non-goals

**Goals**

- Every active account always receives critical transactional email. No preference can suppress
  it. Only a hard bounce or spam complaint can.
- A clean three-tier model where the purpose of an email decides its routing.
- One unified marketing opt-in, with the platform as the single source of truth, mirrored to both
  Ghost and Email Octopus and kept in sync automatically.
- A defensible, auditable, global-compliant consent posture.
- Scale cleanly to 100,000 users. Zero regressions over time.

**Non-goals (this release)**

- SMS or any non-email channel. The data model reserves room for it, but nothing is built.
- Changing how the community or marketing teams author or send their emails. We sync audience
  membership, not content. The teams keep Ghost and Email Octopus as their sending tools.
- Rebuilding the Resend transactional subsystem, which is mature and stays.

## 4. Locked decisions

**Send model**

- Three tiers, where tier is a property of the email type held in a central registry, not decided
  per send.
- `notify_announcements` is retired entirely and dropped after a bake-in.

**Marketing consent**

- One unified opt-in, "Marketing and news." Opting in adds the person to both Ghost and Email
  Octopus. Unsubscribing anywhere removes them from both.
- Ghost runs a single newsletter and sends nothing else, so all of Ghost is the one marketing
  bucket.
- Source of truth is `consent_current.marketing` in the platform database. Ghost and Email Octopus
  are mirrors, driven by API on every change and reconciled nightly.

**Compliance**

- Global bar (GDPR, CCPA and CPRA, and CASL as the strictest). Marketing is express opt-in,
  consent is provable, and every Tier 1 and Tier 2 email carries a working one-click unsubscribe,
  a `List-Unsubscribe` header, and a physical postal address.
- A short DPIA is written because the audience is genuinely global.

**Migration**

- The 163 current announcement opt-ins are grandfathered into the unified marketing consent, so
  onto both lists.
- Existing Ghost and Email Octopus subscribers are grandfathered by email match to platform users.
  Unmatched subscribers are catalogued as platform-external.
- Everyone else defaults to marketing opted-out. No auto-subscribe.
- The Tier 1 preference defaults on and is backfilled on for all existing users.

**Reconcile drift policy**

- Unsubscribes always win and propagate instantly to all systems.
- Additions only count as consent when they come from a real opt-in. A vendor contact with no
  consent record is flagged for admin review, never auto-removed and never auto-trusted.

**Rollout**

- Tier 0 fixes reach every triggered user immediately, since that is the urgent bug. The first
  all-member service send is ramped in batches with bounce and complaint monitoring, and the auth
  lane stays isolated so a marketing or service complaint spike can never throttle password resets.

## 5. Users and stakeholders

- **Members** (about 1,253 accounts, 887 active in 90 days, from 86 countries). They receive
  email and control their own preferences.
- **Community team.** Authors and sends the newsletter in Ghost.
- **Marketing team.** Runs campaigns in Email Octopus.
- **Admins and coordinators.** Send announcements, receive ops alerts, handle support.
- **Compliance and the organization.** Need provable consent and honored unsubscribes globally.

## 6. The three-tier model and full email inventory

| Tier                      | Meaning                                       | Who receives                         | Member control                         |
| ------------------------- | --------------------------------------------- | ------------------------------------ | -------------------------------------- |
| 0 Critical transactional  | About the person's own account or application | The specific user, always            | None. Only global suppression stops it |
| 1 Service and opportunity | Useful platform and opportunity updates       | All active members minus opt-outs    | One opt-out toggle, on by default      |
| 2 Marketing               | The unified "Marketing and news"              | Opt-in only, from the consent ledger | The marketing opt-in                   |
| Ops                       | Staff and admin internal                      | Staff recipient lists                | Not member-facing                      |

### 6.1 Full inventory, code-verified

**Tier 0, always send, no preference gate**

- Auth: signup confirm, invite, magic link, password recovery, email change, reauthentication
- Unconfirmed signup reminder, plus the safety-net resend
- General application submitted, project application submitted
- Support ticket reply
- Teacher role confirmation, admin role confirmation (both render inline HTML today)
- Class status change. Teacher (owner) + admins only (curriculum authoring workflow). The
  "notify enrolled trainees" idea was dropped (2026-08-20): learners enrol in cohorts
  (`cohort_registrations`), not classes, so class-status transitions are authoring-only and have
  no enrolled learners to notify.
- Interview invitation, applicant status change, observer role granted, community and training
  agreement offer. These four currently carry the `notify_announcements` gate and must have it
  removed. This is the core bug fix.
- Resume application reminder. Owner decision: Tier 0.
- Project blast. Owner decision: Tier 0.

**Tier 1, everyone by default, single opt-out**

- Project opening alert. Interest filter removed this release, so every active user gets it. Must
  be migrated off the dead queue.
- Quest re-engagement nudge
- Service announcement (the announcement composer's "service" choice)

**Tier 2, marketing, opt-in only**

- Promotional announcement (the composer's "marketing" choice), recipients from the consent ledger
- Community newsletter (Ghost, single newsletter)
- Marketing campaigns (Email Octopus)

**Ops, staff only**

- Admin member status alert. Already targets the project coordinator, with a fallback to the
  inviting admin. Keep.
- New feedback admin alert. Goes to all admins. Must be migrated off the dead queue.
- Fleety Coach weekly digest. Goes to all admins. Keep.
- Daily error triage digest. Owner decision: remove the whole feature, email, Discord post, and
  cron builder.

### 6.2 Cleanups riding along

- C1 Remove the dead `signup-confirmation-reminder` template (no caller).
- C2 Fix old-domain unsubscribe links to `techfleet.network`, and wire the one-click unsubscribe to
  set the correct preference.
- C3, C5, C6, C7 Eradicate the retired raw `enqueue_email` queue: the two dead senders, the
  reconciler, both DLQ replay paths, and the announcement legacy fallback.
- C8 Bring the inline-HTML templates (`admin_promotion`, `teacher_promotion`, `announcement`) into
  the template registry so tooling and the tier registry cannot skip them.
- C4 Drop the `notify_announcements` column after the bake-in.

## 7. Consent model and source of truth

The single source of truth is the platform database. Ghost and Email Octopus are mirrors.

- **`consent_event`** is an append-only log. Every opt-in and opt-out writes one row: subject, the
  marketing state, when, the source (signup, preference center, Ghost unsubscribe, Email Octopus
  unsubscribe, admin, import), the notice version, the actor, and the request IP. Nothing is ever
  edited or deleted. This is the permanent, provable history and the compliance audit trail.
- **`consent_current`** is the fast projection every send and every sync reads. With the unified
  model it holds one marketing value per person: subscribed or unsubscribed.
- Channel is `email` now, with `sms` reserved for a future opt-in.

## 8. Functional requirements

### 8.1 Signup

- Two required consents remain: account and service notices, and agreement to the terms.
- One optional, unticked checkbox: "Marketing and news." Nothing is pre-checked.
- Opting in writes a marketing consent event and syncs the person to both vendors.

### 8.2 Preference center (new page under the profile)

- Section one, "Account and essential emails," shows the Tier 0 categories as read-only rows,
  each marked "Always on" with a lock icon, for transparency. They cannot be turned off.
- Section two, "Opportunities and platform updates," is a single toggle, on by default.
- Section three, "Marketing and news," is a single toggle, off by default, that writes to the
  consent ledger and syncs to both vendors.
- Changes are logged. Saving uses the existing autosave pattern.

### 8.3 Unsubscribe: three buckets

Every unsubscribe belongs to exactly one bucket.

1. **Marketing and news.** Off in the platform, removed from both Ghost and Email Octopus by API.
2. **Opportunities and platform updates.** Sets the Tier 1 opt-out only. Does not touch marketing
   or account email.
3. **Critical account email.** No unsubscribe exists. Only a hard bounce or spam complaint stops it.

One-click unsubscribe requirements:

- Uses an opaque per-person, per-bucket token, never the email address, and never PII in the URL.
- Implements RFC 8058: a GET shows a confirmation page and changes nothing, and the state change
  happens only on POST, so mail scanners and link prefetchers cannot silently unsubscribe people.
- Is idempotent and rate-limited.

### 8.4 Announcement composer (admin)

- The admin must pick a purpose. There is no default that silently sends marketing to everyone.
- "Service update" reaches everyone minus the Tier 1 opt-outs.
- "Marketing" reaches only people whose `consent_current.marketing` is subscribed, derived
  server-side. The composer cannot supply its own recipient list.
- The resolved audience and count are shown before send.
- The purpose choice, the actor, and the time are written to the audit log.
- Subject lines are stripped of CR and LF to prevent header injection. Body content is sanitized.

### 8.5 Cross-system sync

- **Outbound.** A consent change enqueues a job on the existing pgmq queue, with DLQ and replay,
  that upserts or unsubscribes the person in Ghost and Email Octopus by API. Idempotent, so a retry
  never double-adds. Rate-limited to each vendor's limits.
- **Inbound.** Two webhook receivers, for Ghost `member.updated` and `member.deleted`, and for
  Email Octopus unsubscribe events. Each verifies the signature on the raw body, rejects on
  mismatch, and is replay-protected before writing a consent event.
- **Reconcile.** A nightly job reads the actual state of both vendor lists, compares them to
  `consent_current`, and issues the API calls needed so all three agree. It applies the drift
  policy in section 4.
- **Loop prevention.** An external unsubscribe updates the platform, which then pushes the removal
  only to the other vendor, never back to the origin. Enforced by source tagging and by pushing
  only when the target state actually differs.

### 8.6 Migration and backfill

- Runs as a safe data migration: dry-run first, row counts recorded, reversible, audit-logged.
- Grandfather the 163 into the unified marketing consent.
- Match existing Ghost and Email Octopus subscribers to platform users by normalized email and
  write consent events for the matches. Catalogue unmatched subscribers as platform-external.
- Everyone else defaults to marketing opted-out.
- The Tier 1 preference is backfilled on for all existing users.

### 8.7 Data-subject rights

- Deletion propagates: deleting an account also removes the person from Ghost and Email Octopus.
- Export includes the person's consent history.
- Objection is honored: turning off a marketing or opportunities toggle propagates promptly.

## 9. Data model

- `consent_event` and `consent_current` as described in section 7. Projection indexed on
  `(marketing, ...)` and by user for set-based recipient resolution.
- A new Tier 1 preference on the profile, "Opportunities and platform updates," default on.
- The email-type to tier registry: one central map keyed by template name holding tier, purpose,
  lane, and unsubscribe behavior.
- `notify_announcements` retained through the expand phase (dual-read), then dropped.

## 10. Architecture

- **Tier registry** is the one place tier is decided. Every sender resolves its tier from the
  registry. No sender hard-codes a preference read.
- **Consent ledger** is the source of truth, projected for fast reads, driving the vendors.
- **Sync topology** is hub-and-spoke with the platform as the hub. It reuses the existing queue,
  DLQ, replay, and cron. No new services, no message bus. This is sized for about 1,253 users, not
  imagined scale, but the set-based recipient resolution and indexed projection are what make it
  hold at 100,000.
- **Suppression scopes** are independent: global (hard bounce and complaint, applies to all tiers
  and always wins), Tier 1 opt-out, and the marketing consent. A marketing or opportunity opt-out
  never writes a global suppression row.
- **Sends** stay one-per-recipient through the v2 outbox and dispatcher, which are already batched
  and idempotent. The bulk lane is throttled and the auth lane is physically isolated.

## 11. Security requirements

Full detail is in the threat model. The requirements:

- One-click unsubscribe uses opaque scoped tokens, RFC 8058 POST semantics, no PII in URLs, rate
  limiting, and idempotency.
- Inbound webhooks verify the signature on the raw body with a constant-time compare, reject on
  mismatch, and are replay-protected.
- Consent and preference RPCs derive the subject from `auth.uid()`, never a client-supplied id, so
  a member cannot change another member's consent. RLS limits rows to the owner. The server sets
  provenance fields; the client cannot.
- SECURITY DEFINER RPCs are `authenticated`-only, verified by pgTAP. No anon execute.
- The announcement composer enforces server-side admin authorization and derives marketing
  recipients only from consent.
- No raw email addresses in worker or sync logs. Use a user id or a hash.
- Outbound clients validate the vendor host, use https only, do not follow redirects, and keep
  secrets out of logs and errors.
- The unsigned-JWT service_role bypass is already fixed in code (audit C1). This release adds a CI
  regression guard that fails the build if any function reintroduces the pattern.
- The lockout and accidental-deletion safety check applies before any deletion or permission
  change: DSAR propagation, dropping `notify_announcements`, reconcile removals, and new grants.
  No bulk removal without a bounded, dry-run-verified set and an override for anything above a
  threshold.

## 12. Compliance requirements

- Lawful basis per tier: Tier 0 contract or legitimate interest, Tier 1 legitimate interest with
  opt-out, Tier 2 consent.
- Consent is provable: every opt-in and opt-out is a ledger event with timestamp, source, notice
  version, actor, and IP.
- Unsubscribe is honored across all systems promptly.
- Retention: consent events are retained 24 months past account deletion, pseudonymized, as proof
  of prior consent. To be confirmed in the DPIA.
- A DPIA is written this release.

## 13. Testing requirements

- Behavioral `@compliance`, `@security`, and `@critical` Gherkin scenarios wired into the existing
  CI gate, covering: Tier 0 always sends with all preferences off; a marketing opt-out never stops
  account email; an external unsubscribe propagates to the other vendor only, with no loop; a bad
  webhook signature is rejected; the grandfather migration preserves counts with no auto-subscribe;
  the announcement purpose picker is mandatory and audited; the unsubscribe link cannot be
  triggered by a prefetch.
- Structural fitness tests that fail the build if a Tier 0 email reads a preference, if any code
  enqueues to the retired queue, if a template lacks a registry entry, or if a function
  reintroduces the unsigned-role-claim auth pattern.
- Contract tests for the Ghost and Email Octopus adapters. Idempotency and loop-prevention unit
  tests. A reconciliation drift test.
- A before-and-after send-log check proving Tier 0 reach goes from about 163 to 100 percent of
  triggered users, and a reach-parity check that the Tier 1 audience equals active members minus
  opt-outs.

## 14. Release plan

Expand, migrate, contract. Each PR is independently shippable, reversible, and gated by its tests.
PRs 1 through 3 are the urgent core and can land first. Later PRs stack behind the
`unified_consent_sync` flag.

| PR  | Title                                                                                                                                                      | Wave |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | ADRs 0013 to 0016, the tier registry, CI fitness tests (including the service-role regression guard)                                                       | 0    |
| 2   | Eradicate the retired raw queue: repoint the two dead senders, the reconciler, both DLQ replays, and the announcement fallback to v2; fix old-domain links | 0    |
| 3   | Remove the Tier 0 preference gates, add the always-send invariant test                                                                                     | 0    |
| 4   | Tier 1 preference, default on, backfill, profile UI, one-click unsubscribe to opt-out wiring, dual-read                                                    | 1    |
| 5   | Re-gate Tier 1 emails to the toggle (project openings to all users, quest nudge, service announcement)                                                     | 1    |
| 6   | Consent ledger, projection, RPCs, RLS, pgTAP, dark                                                                                                         | 2    |
| 7   | Grandfather backfill, dry-run then live                                                                                                                    | 2    |
| 8   | Outbound sync, Ghost and Email Octopus adapters, queue, idempotent, loop prevention, Vault secrets                                                         | 3    |
| 9   | Inbound webhooks with signature verification, and the reconcile cron                                                                                       | 3    |
| 10  | Signup marketing checkbox and the preference center, writing to the ledger                                                                                 | 4    |
| 11  | Announcement purpose picker and Tier 2 routing from consent, with audience preview and audit                                                               | 4    |
| 12  | DSAR: deletion and export propagation, and the DPIA                                                                                                        | 5    |
| 13  | Remove the triage digest feature, bring inline templates into the registry, remove the dead template                                                       | 5    |
| 14  | Observability, runbook, deliverability ramp, then drop `notify_announcements` after bake-in                                                                | 5    |

Work happens in the isolated `feat/email-rearchitecture` branch, one worktree per PR.

## 15. Observability and operational readiness

- SLIs and SLOs: Tier 0 send success near 100 percent minus global suppression; consent change to
  external propagation p95 under 5 minutes; webhook ingestion above 99 percent; reconciliation
  drift trending to zero.
- Symptom-based alerts: any Tier 0 template appearing suppressed by a preference, which should be
  impossible and pages; sync DLQ depth above zero; webhook signature-failure spikes; complaint-rate
  breach on the bulk lane; reconciliation drift above threshold.
- A runbook at `docs/runbooks/email-consent-sync.md` covers service versus marketing sends,
  audience-preview verification, DLQ replay, forcing a reconcile, rotating a webhook secret,
  handling a Ghost or Email Octopus outage, and the deliverability ramp checklist.

## 16. Deliverability

- The reach fix lifts triggered Tier 0 volume from about 13 percent to 100 percent of triggered
  users. Triggered emails are event-driven and low steady volume, so this is safe to ship at once.
- The first all-member service announcement, about 1,253 people, is sent in throttled batches with
  bounce and complaint monitoring before widening.
- The auth lane stays isolated so a service or marketing complaint spike cannot throttle password
  resets.

## 17. UX and voice standard

Full detail is in the UX build standard. Requirements: reuse the existing components (`Switch`,
`Checkbox`, `RadioGroup`, `Card`, `Button`, `Badge`, `Alert`, `Separator`). Sentence case
everywhere, no em dashes, buttons are verb plus noun, no internal tooling names in member copy
(members never see "Ghost" or "Email Octopus"), and empathetic system states. Meet WCAG 2.2 AA,
including never relying on color alone and full keyboard operability. The signup screen change ships
with the full auth regression suite green because it touches the frozen auth area.

## 18. Architecture Decision Records

- ADR-0013 Consent ledger as the source of truth
- ADR-0014 Ghost and Email Octopus sync topology
- ADR-0015 Transactional and marketing scope separation and suppression scopes
- ADR-0016 Email tiering and the retirement of `notify_announcements`

Written as PR 1's first commits, per the repo convention.

## 19. Secrets and configuration

Set as Supabase Edge Function secrets, needed only at the sync wave (PRs 8 and 9):

- Email Octopus: `EMAILOCTOPUS_API_KEY`, `EMAILOCTOPUS_LIST_ID`, `EMAILOCTOPUS_WEBHOOK_SECRET`
- Ghost: `GHOST_ADMIN_API_URL`, `GHOST_ADMIN_API_KEY`, `GHOST_WEBHOOK_SECRET`

The build fails closed if a secret is missing and surfaces it in the environment-readiness check.
The owner sets these. Migrations are applied by hand to production, not auto-deployed.

## 20. Acceptance criteria

- Tier 0 reach proven to go from about 163 to 100 percent of triggered users, by BDD and a
  before-and-after send-log check.
- No sender reads `notify_announcements`, no code enqueues the raw queue, the registry is complete,
  and all fitness tests pass.
- `project_opening_alert` and `feedback_alert` deliver again, verified in the send log.
- The Tier 1 toggle exists, defaults on, is backfilled, and Tier 1 emails are re-gated to it.
- The consent ledger is live, the 163 are grandfathered, Ghost and Email Octopus subscribers are
  matched, and there is no auto-subscribe.
- Two-way sync is live, loop prevention and reconcile are proven, and DSAR propagation works.
- The announcement purpose picker is enforced and audited, and marketing routes only from consent.
- The triage digest is removed, inline templates are in the registry, the dead template is gone,
  and links are fixed.
- The DPIA is written, the global-compliance BDD is green, and the deliverability ramp completes
  without a bounce or complaint breach.
- `notify_announcements` is dropped after the bake-in.

## 21. Open items

1. Confirm the reconcile drift policy is flag-for-review, as recommended.
2. Confirm the CI regression guard for the service-role pattern goes into PR 1.
3. The go-ahead to start PR 1.
4. Ghost and Email Octopus secrets, needed only when the sync wave begins.

## 22. Glossary

- **Tier 0, 1, 2** The three send tiers by purpose.
- **Bucket** A thing a person can unsubscribe from: marketing, opportunities, or none for critical.
- **Consent ledger** The append-only `consent_event` table plus the `consent_current` projection.
- **Source of truth** The platform's `consent_current.marketing` value for a person.
- **Mirror** Ghost or Email Octopus, kept matched to the source of truth by API.
- **Dead queue** The retired raw `enqueue_email` pgmq queue with no consumer after the July cutover.
