# Email Rearchitecture: Requirements & Plan (Revision 2)

- **Status:** Active build. Revision 2 (2026-08-20) reflects a major architecture simplification.
- **Owner:** mdenner
- **Applies to:** Tech Fleet Network platform (Vite + React + Supabase), Email Octopus, Resend.

## Revision 2, what changed and why

The original design kept a marketing **consent ledger inside the platform** and synced it two-way to
**both Ghost and Email Octopus**. That machinery existed only to keep _two_ mailing systems in
agreement.

**Owner decision (2026-08-20):** stop sending email through Ghost. **Ghost becomes the blog/site
only.** **Email Octopus (EO) is the one and only marketing email system, and the source of truth
for the marketing list.** The platform no longer owns marketing subscription state; it just tells
EO who opted in or out.

With one downstream system there is nothing to reconcile, so this deletes a large amount of planned
work (see §11). The transactional half of the program (PRs 1–3, already shipped) is unaffected.

Superseded ADRs: **0013** (consent ledger as source of truth) and **0014** (Ghost/EO two-way sync)
are superseded by a new **ADR-0017** (Email Octopus as the marketing source of truth) to be written
with the next build step.

---

## 1. The two halves

1. **Transactional / service email — the platform (Resend).** Account, application, opportunity,
   and service email the platform sends itself. Governed by the tier model. **This half is built.**
2. **Marketing email — Email Octopus.** All marketing/newsletter ("Marketing and news"). EO owns
   the list, sends the email, and handles its own unsubscribes. The platform only calls EO's API to
   add/remove a contact when someone opts in or out on the platform.

## 2. Goals

- Every active account always receives critical transactional email; no preference can suppress it.
- A clean three-tier model for platform email, purpose decides routing.
- One marketing opt-in that adds/removes the person in Email Octopus. EO is the source of truth.
- Ghost is blog-only; the platform never sends email through Ghost.
- Defensible global-compliance posture (GDPR / CCPA / CASL) with the least machinery.
- Scale cleanly to 100,000 users, zero regressions.

## 3. Locked decisions

**Send model (platform email)**

- Three tiers, tier is a property of the email type in a central registry.
  - **Tier 0 Critical transactional** — always send, no preference gate, only global suppression
    (hard bounce / spam complaint) stops it.
  - **Tier 1 Service / opportunity** — everyone by default, one opt-out (`notify_opportunities`).
  - **Tier 2 Marketing** — not sent by the platform at all; handled by Email Octopus.
- `notify_announcements` is retired as a gate and dropped after a bake-in.

**Marketing (Email Octopus)**

- One unified opt-in, "Marketing and news."
- **Email Octopus is the source of truth for the marketing list.** The platform writes to EO (add /
  remove contact) on opt-in/out; it does not hold authoritative marketing state.
- Marketing unsubscribes are handled by EO's own unsubscribe link and list management. Nothing to
  build in the platform for the marketing unsubscribe.
- Ghost sends no email.

**Consent receipt (recommended default, easily removed)**

- The platform keeps a **minimal local receipt** of the marketing opt-in: a `marketing_opt_in_at`
  timestamp + source on the profile. It is **not** a source of truth and is **not** read to gate
  any send. It exists only as (a) provable evidence of consent for global compliance, and (b) a
  durable record so a failed EO API call can be retried. If the owner prefers to trust EO fully,
  this is a one-column drop.

**Compliance**

- Marketing is express opt-in. EO provides the unsubscribe link, `List-Unsubscribe` header, physical
  address, and consent/subscription records. The local receipt (above) is supplementary proof.
- A short DPIA is still written (global audience), now much shorter, EO is a documented subprocessor.

**Rollout**

- Tier-0 fixes reached every triggered user immediately (shipped). Any first large service send
  ramps in batches; the auth lane stays isolated.

## 4. Users and stakeholders

- **Members** (~1,253 accounts, from 86 countries). Receive email; control their own preferences.
- **Marketing team.** Runs campaigns in Email Octopus (the only marketing tool now).
- **Community/site.** Ghost hosts the blog; no email.
- **Admins/coordinators.** Send service announcements, receive ops alerts, handle support.

## 5. Email inventory → tiers (platform email; code-verified 2026-08-18)

Unchanged from Revision 1 except that **Tier 2 marketing is no longer a platform send**.

**Tier 0, always send, no preference gate** — auth (signup/invite/magic-link/recovery/email-change/
reauth), unconfirmed-signup reminder, both application-submitted, support-ticket reply, teacher/admin
role confirmation, class status change (teacher + admins), interview invitation, applicant status
change, observer role granted, community/training agreement offer, resume-application reminder,
project blast. _(The four gated Tier-0 emails had their `notify_announcements` gate removed in PR 3.)_

**Tier 1, everyone by default, single opt-out (`notify_opportunities`)** — project opening alert,
quest re-engagement nudge, service announcement.

**Tier 2, marketing** — handled entirely by **Email Octopus**. The platform does not send it.

**Ops, staff only** — admin member-status alert (project coordinator), new-feedback admin alert (all
admins), Fleety Coach weekly digest (all admins). _(Triage digest removed, PR 9.)_

## 6. Marketing architecture (Email Octopus)

- **Source of truth:** the EO list. A person is "subscribed to marketing" if and only if they are a
  subscribed contact in EO.
- **Signup:** the "Marketing and news" checkbox, when ticked, records the local receipt (§3) and
  **enqueues** an EO add. See resilience below — signup never blocks on EO.
- **Profile preference:** a "Marketing and news" toggle. On → enqueue EO subscribe; off → enqueue EO
  unsubscribe. Current state is read from EO (or reflected from a lightweight EO unsubscribe webhook,
  for display freshness).
- **Unsubscribe from a marketing email:** handled by EO's own unsubscribe. An optional EO → platform
  webhook updates the profile toggle's displayed state. No platform suppression is involved.
- **No consent ledger, no two-way sync, no reconcile, no Ghost integration.**

**Resilience — the EO sync is durable, not fire-and-forget (enterprise-arch, release-safety, SRE,
compliance).** Every EO add/remove is written as a job (reuse the existing pgmq/outbox pattern) and
processed by a worker with retry + backoff; it is NOT a synchronous call inside the request.

- **Signup and profile-save must succeed even if EO is down.** The user's action commits locally (the
  receipt / toggle state), the EO call is enqueued and retried. An EO outage can never block account
  creation or a preference change (fail-open on the user path).
- **A dropped opt-OUT is a compliance breach**, so the queue must guarantee eventual delivery of
  unsubscribes; the retry-queue backlog is a paged SRE signal (§9).
- **Idempotent** (add/remove by email); safe to retry. **Server-side only:** all EO calls run in an
  edge function; the `EMAILOCTOPUS_API_KEY` never reaches the browser. A member can only subscribe or
  unsubscribe **their own** email (derived from `auth.uid()`), never an arbitrary address.
- Behind a **feature flag** (`email_octopus_sync`) for a safe rollout.

## 7. Functional requirements

### 7.1 Signup

- Required account-notices consent (unchanged).
- One optional, unticked "Marketing and news" checkbox. On submit, if ticked: call EO add-contact +
  write the local receipt. If the EO call fails, the receipt lets a retry job complete it.

### 7.2 Preference center (profile → notification settings)

The member manages everything from the platform (opt in AND unsubscribe); they never log into Email
Octopus. This lives in the profile's notification settings.

- **Account and essential emails** (Tier 0) shown read-only, "Always on."
- **Opportunities and platform updates** (Tier 1) — single toggle, on by default, writes
  `notify_opportunities`.
- **Marketing and news** (Tier 2) — single toggle. Turning it on calls Email Octopus (subscribe);
  turning it off calls Email Octopus (unsubscribe). This is the in-platform way to unsubscribe from
  marketing. Its displayed state reflects EO (via read-on-load or the optional EO unsubscribe
  webhook), so it never disagrees with EO even if the person also used the unsubscribe link in an EO
  email.

### 7.3 Unsubscribe (platform service email only)

- Applies to Tier 1 opportunity email the platform sends via Resend.
- One-click, RFC 8058 (GET validates, POST performs), scope-aware: sets `notify_opportunities = false`
  and, during the expand phase, dual-writes `notify_announcements = false`. **Never** writes a global
  `suppressed_emails` row (that is reserved for hard bounce / spam complaint via the Resend webhook).
- Fixes the live bug where unsubscribing from any email globally suppressed the address and blocked
  critical account email (verified: `enqueue-email.ts:32` suppresses all lanes, auth included).
- Old-domain `lovable.app` links are replaced with `techfleet.network`.
- **Marketing unsubscribe is not a platform concern** — EO handles it.

### 7.4 Announcement composer (admin)

- The platform composer sends **service announcements only** (Tier 1), to all active members minus the
  opportunities opt-out. There is no audience or purpose picker; marketing announcements are composed
  and sent in Email Octopus by the marketing team.
- Before sending, the admin must tick a **required confirmation**: _"I confirm this is not marketing,
  and that any marketing is sent through the marketing platform (Email Octopus)."_ The send is blocked
  until it is ticked. The attestation (admin + timestamp) is written to the **audit log** — the
  evidence that the platform's all-member channel was not used for marketing. This replaces routing
  logic with a human guardrail, so the platform never needs a "marketing" concept.
- Only admins see this control (it lives in the admin composer, on create and edit).

### 7.5 Data-subject rights

- Account deletion removes the person's EO contact (one API call) and clears the local receipt.
- Export includes the local receipt (opt-in timestamp/source). The EO subscription record is EO's.

## 8. Data model (platform)

- **`profiles.notify_opportunities boolean NOT NULL DEFAULT true`** — the Tier-1 opt-out. **(Shipped
  as migration 4a.)**
- **Minimal marketing receipt** (recommended): `profiles.marketing_opt_in_at timestamptz`,
  `profiles.marketing_opt_in_source text`. Not authoritative; proof + retry only.
- The email-type → tier registry (`_shared/email/domain/email-tiers.ts`). **(Shipped, PR 1.)**
- `notify_announcements` retained through the expand phase (dual-read), dropped in the last PR.
- **No consent ledger tables.**

## 9. Architecture & security (platform)

- **Tier registry** decides tier; CI guards enforce it (shipped): registry completeness, no Tier-0
  preference read, no raw-queue enqueue, no unsigned-JWT auth.
- **EO API client:** secrets in Vault (`EMAILOCTOPUS_API_KEY`, `EMAILOCTOPUS_LIST_ID`); server-side
  only. Fails closed if missing; surfaced in environment-readiness. Rate-limited, idempotent, and
  **durably queued with retry** (§6), never a synchronous call on the user path.
- **Optional EO webhook** (unsubscribe) verified by HMAC (`EMAILOCTOPUS_WEBHOOK_SECRET`) for display
  freshness only.
- **Suppression scopes:** global (bounce/complaint, all tiers), Tier-1 opt-out (`notify_opportunities`).
  A Tier-1 opt-out never writes global suppression.
- No PII in worker logs (user id or hash). No Ghost secrets. Much smaller attack surface than Rev 1.

**Operational readiness (SRE).**

- **SLIs/SLOs:** EO sync success rate > 99%; opt-out → EO propagation p95 < 5 min; retry-queue depth
  trends to ~0.
- **Alerts (symptom-based):** the **EO sync retry-queue backlog** pages — a backlog of un-synced
  **unsubscribes** means people are still being marketed to after opting out (a compliance breach in
  progress). Also alert on an EO API error-rate spike and webhook signature-failure spikes.
- **Runbook** (`docs/runbooks/email-octopus-sync.md`): replay failed EO syncs, handle an EO outage
  (queue drains on recovery; user path stays up), rotate the EO key/webhook secret, and reconcile the
  displayed toggle if it drifts from EO.

**Compliance (data lifecycle).**

- **Email Octopus is a named subprocessor.** It must appear in the privacy notice and the DPIA, with
  the data shared listed (email address, first name, subscription state).
- **International transfer:** EO is UK/EU-hosted, so sending a global (86-country) audience's contact
  data there is a cross-border transfer; the DPIA documents the lawful mechanism.
- **Consent proof:** the local receipt (§3) plus EO's own subscription record.
- **Unsubscribe propagation** is guaranteed by the durable retry queue (§6), so an opt-out is honored
  even across an EO outage.

## 10. Testing

- Structural CI guards (shipped). BDD `@compliance`/`@critical`: Tier-0 always sends with all prefs
  off; a marketing/opportunity opt-out never stops account email; unsubscribe cannot be triggered by
  a prefetch; EO add/remove is enqueued on opt-in/out; the announcement composer sends only to the
  opportunities audience and requires the "not marketing" attestation. pgTAP for the Tier-1
  preference + unsubscribe RPCs.
- **Resilience / contract tests (comprehensive-test-strategy):** a consumer-driven contract test
  against a mocked EO API (add/remove/error shapes); a **chaos test** proving that when EO is down,
  signup still succeeds and the enqueued opt-in/opt-out is retried to completion (an opt-out is never
  lost); idempotency test (re-running an EO sync job does not double-apply).

## 11. Release plan (Revision 2)

**BUILD STATUS (2026-08-23): PRs 1–9 are BUILT and committed on `feat/email-rearchitecture` (not
merged). PR 10 is the post-launch phase — its substantive parts (DPIA, deliverability ramp via the
bulk lane, the `get_eo_sync_health` RPC + runbook) are done; the paged backlog alert and the
`notify_announcements` drop are deliberately deferred to post-bake (they must not ship before the new
senders bake in / would false-alarm on rollout). The full go-live + post-bake sequence is in
[docs/runbooks/email-rearchitecture-cutover.md](../runbooks/email-rearchitecture-cutover.md). Note: PR
6 replaced the EO unsubscribe webhook with a live per-user EO read (`eo-contact-status`), and the
minimal local receipt was dropped (EO is the sole source of truth) — see ADR-0017 amendments.**

**Shipped (committed on `feat/email-rearchitecture`, not pushed):**

| PR  | Title                                                                           | State        |
| --- | ------------------------------------------------------------------------------- | ------------ |
| 1   | Tier registry + CI fitness tests + ADRs 0013–0016                               | ✅ committed |
| 2   | Route all raw `enqueue_email` callers to the v2 outbox (restores 2 dead emails) | ✅ committed |
| 3   | Remove `notify_announcements` gate from Tier-0 critical email (the ~87% bug)    | ✅ committed |
| —   | Drop class-status trainee notification (doesn't apply)                          | ✅ committed |

**In progress / remaining (Revision 2 — simplified):**

| PR  | Title                                                                                                                                                                                                                                                                    | Notes                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 4   | Tier-1 `notify_opportunities` preference (4a ✅ written) + scope-aware one-click unsubscribe for platform service email (4b) + preference-center UI (4c)                                                                                                                 | 4b now covers only the platform service email; marketing unsub is EO's. 4c's marketing toggle calls EO. |
| 5   | Re-gate the Tier-1 senders (project openings, quest nudge, service announcement) to `notify_opportunities`                                                                                                                                                               | Removes their last `notify_announcements` reads.                                                        |
| 6   | **Email Octopus integration** — server-side EO client behind a durable **retry queue** + feature flag; signup checkbox and profile toggle enqueue EO add/remove (fail-open, never block the user); minimal receipt; optional EO unsubscribe webhook; SLOs/alerts/runbook | Replaces old PRs 6–9 (ledger + two-way sync). Live (EO API ready).                                      |
| 7   | Announcement composer → service-only + a required admin "not marketing" attestation checkbox (audited)                                                                                                                                                                   | Simplified from the old purpose-picker PR.                                                              |
| 8   | DSAR: account deletion removes the EO contact + clears the receipt                                                                                                                                                                                                       | Simplified (EO only, no Ghost).                                                                         |
| 9   | Transactional cleanup: remove triage-digest feature, inline templates → registry, dead template                                                                                                                                                                          | Unchanged.                                                                                              |
| 10  | Observability + deliverability ramp; then drop `notify_announcements` after bake-in; short DPIA                                                                                                                                                                          | Unchanged in spirit; DPIA now shorter.                                                                  |

**Documentation, alongside the build:** **ADR-0017** ("Email Octopus as the marketing source of
truth," superseding 0013 and 0014) is written before PR 6. The **DPIA + privacy-notice subprocessor
update** (EO named, data shared, UK transfer basis) lands with PR 6, when EO first receives member
data.

**One-time (not code):** import the current Ghost newsletter subscribers into Email Octopus (so EO is
the complete list), and add the 163 platform announcement opt-ins to EO. Done in EO's own import UI.

**Deleted from Revision 1** (no longer built): the consent ledger (`consent_event`/`consent_current`),
the two-way sync workers, the nightly reconcile + loop-prevention, all Ghost integration, and the
custom marketing unsubscribe endpoint/token. The scope-aware unsubscribe survives only for the
platform's own service email.

## 12. Acceptance criteria

- Tier-0 reach 100% of triggered users (shipped, PR 3) — proven by guard + before/after send-log.
- No sender reads `notify_announcements`; no raw-queue enqueue; registry complete (guards green).
- The two dead emails deliver again (shipped, PR 2).
- Tier-1 toggle exists (default on) and its senders are re-gated to it; unsubscribe is scope-aware and
  never globally suppresses.
- Signup + profile call Email Octopus; EO is the marketing source of truth; Ghost sends no email.
- Account deletion removes the EO contact.
- Triage digest removed; dead template gone; links fixed; `notify_announcements` dropped after bake-in;
  DPIA written.

## 13. Open items

1. Confirm the minimal marketing receipt (recommended) vs trust EO fully (drop the two columns).
2. Email Octopus API is READY (owner, 2026-08-20). Put the secrets (`EMAILOCTOPUS_API_KEY`,
   `EMAILOCTOPUS_LIST_ID`, and `EMAILOCTOPUS_WEBHOOK_SECRET` if using the display webhook) in Supabase
   Vault at PR 6 — PR 6 goes live, not dark.
3. Commit 4a (written) and continue PR 4 (4b unsubscribe, 4c preference center).
