# Email Audit → Decision Table (populate the "YOUR IDEAL UX" column)

- **Purpose:** one row per email the platform can send. You describe the ideal end-state UX
  for each; I turn your answers into the tier map + routing that the build implements.
- **Date:** 2026-08-18 · **Owner:** mdenner
- **Status:** ✅ inventory code-verified (2026-08-18 sweep). Corrections from verification are
  folded in below and marked _(verified)_.

## How to fill this in

For each row, edit the **✍️ YOUR IDEAL UX** cell. My recommendation is pre-filled — just write
`✓` if you agree, or describe what you want instead. The three things I need to know per email:

- **Who gets it?** → _Everyone active_ · _Filtered audience_ · _Opt-in only_ · _Staff only_
- **Can the user turn it off?** → _No (critical)_ · _Yes, on by default_ · _Opt-in only (off by default)_
- **Anything about the experience** — timing, channel (email / in-app / Discord), copy, grouping.

### Tier legend (my proposed model)

| Tier                           | Meaning                                                                | Who receives                             | Opt-out                                               |
| ------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| **0 — Critical transactional** | About _your own_ account/application; legally sendable without consent | The specific user, always                | **None** — only a hard bounce/spam-complaint stops it |
| **1 — Service / opportunity**  | Useful platform/opportunity updates                                    | All active members, minus opt-out        | One toggle, **on by default**                         |
| **2 — Marketing**              | Newsletter / promos                                                    | **Opt-in only**, from the consent ledger | Per-purpose opt-in (off by default)                   |
| **Ops**                        | Staff/admin internal                                                   | Staff recipient list                     | N/A (not member-facing)                               |

### Global-compliance note (you said 86 countries)

Marketing (Tier 2) is **express opt-in only**, everywhere. Every Tier 1 & 2 email carries a
working one-click unsubscribe + `List-Unsubscribe` header + a physical postal address (CAN-SPAM),
and consent is logged with timestamp/source/version (GDPR/CASL). Canada's CASL is the strictest
bar and drives the "opt-in only + provable consent" default. Tier 0 is never opt-out-able.

---

## Tier 0 — Critical transactional (recommend: always send, no preference gate)

| #   | Email (template)                                                                                                  | What triggers it                 | Today                                                                                                   | My reco                                                                     | ✍️ YOUR IDEAL UX            |
| --- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------- |
| 1   | **Auth emails** — signup confirm, invite, magic-link, password recovery, email-change, reauth (`auth-email-hook`) | GoTrue auth events               | Always (auth lane)                                                                                      | Everyone · no opt-out · keep as-is                                          | _pre-filled: ✓ always send_ |
| 2   | **Unconfirmed-signup reminder** (`signup`)                                                                        | Signup not confirmed after N     | Always                                                                                                  | Everyone · no opt-out                                                       |                             |
| 3   | **General-application submitted** (`general-application-submitted`)                                               | User submits general application | Always                                                                                                  | The applicant · no opt-out                                                  |                             |
| 4   | **Project-application submitted** (`project-application-submitted`)                                               | User applies to a project        | Always                                                                                                  | The applicant · no opt-out                                                  |                             |
| 5   | **Support-ticket reply** (`support-ticket-reply`)                                                                 | Agent replies to their ticket    | Always                                                                                                  | The requester · no opt-out                                                  |                             |
| 6   | **Teacher role confirmation** (`teacher_promotion`)                                                               | Granted teacher role             | Always (suppression only)                                                                               | The user · no opt-out                                                       |                             |
| 7   | **Admin role confirmation** (`admin_promotion`)                                                                   | Granted admin role               | Always (suppression only)                                                                               | The user · no opt-out                                                       |                             |
| 8   | **Class status change** (`class-status-change`)                                                                   | A class opens/changes/cancels    | _(verified)_ Always → **teacher (owner) + all admins**; ⚠️ **enrolled trainees are NOT notified today** | No opt-out · **decide: should the enrolled trainees also get it?** (see Q3) |                             |
| 9   | ⛔ **Interview invitation** (`interview-invite`)                                                                  | Admin invites them to interview  | **Gated on `notify_announcements` → ~87% never get it (BUG)**                                           | Everyone invited · no opt-out · **remove gate**                             |                             |
| 10  | ⛔ **Applicant status change** (`applicant-status-change`)                                                        | Their application status changes | **Gated (BUG)**                                                                                         | The applicant · no opt-out · **remove gate**                                |                             |
| 11  | ⛔ **Observer role granted** (`observer-role-granted`)                                                            | Granted observer role            | **Gated (BUG)**                                                                                         | The user · no opt-out · **remove gate**                                     |                             |
| 12  | ⛔ **Community/training agreement offer** (`community-agreement-request`)                                         | Offered a place they earned      | **Gated on training/announcements (BUG)**                                                               | The offered user · no opt-out · **remove gate**                             |                             |

---

## Tier 1 — Service / opportunity (recommend: everyone, single opt-out toggle default ON)

| #   | Email (template)                                                | What triggers it                              | Today                                                                                                                 | My reco                                                                                              | ✍️ YOUR IDEAL UX |
| --- | --------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------- |
| 13  | 🔴 **Project opening alert** (`project_opening_alert`)          | A project opening matches them                | Gated on training_opps **+ announcements**; _(verified)_ **on the retired raw queue → delivering NOTHING since July** | All active · **relevance-filtered** by interest · Tier-1 opt-out · **migrate to v2 + fix delivery**  |                  |
| 14  | **Quest re-engagement nudge** (`quest-nudge`)                   | Inactivity / incomplete quest                 | Gated on `notify_announcements`                                                                                       | All active · Tier-1 opt-out                                                                          |                  |
| 15  | **Resume-your-application reminder** (`resume-application`)     | Started but didn't finish applying            | Gated on `notify_announcements`                                                                                       | The user · Tier-1 opt-out (arguably Tier 0 — your call)                                              |                  |
| 16  | **Service announcement** (`announcement`, service-tagged)       | Admin sends an operational update             | Gated on `notify_announcements`                                                                                       | All active minus Tier-1 opt-out (composer picks "Service")                                           |                  |
| 16b | **Project blast** (`project-blast`) — _(added by verification)_ | Admin blasts a project's completed applicants | _(verified)_ No preference gate; suppression only; bulk lane                                                          | Audience = that project's applicants · about _their_ application, so likely Tier 0/1 · **your call** |                  |

---

## Tier 2 — Marketing (recommend: opt-in only, from consent ledger)

| #   | Email (template)                                                | What triggers it         | Today                           | My reco                                                                | ✍️ YOUR IDEAL UX |
| --- | --------------------------------------------------------------- | ------------------------ | ------------------------------- | ---------------------------------------------------------------------- | ---------------- |
| 17  | **Promotional announcement** (`announcement`, marketing-tagged) | Admin sends a promo      | Gated on `notify_announcements` | **Opt-in list only** (promotions purpose) · composer picks "Marketing" |                  |
| 18  | **Community newsletter** (Ghost)                                | Community team publishes | External/manual today           | **Opt-in only** (newsletter purpose) · synced from platform consent    |                  |
| 19  | **Promotional campaigns** (Email Octopus)                       | Marketing team sends     | External/manual today           | **Opt-in only** (promotions purpose) · synced from platform consent    |                  |

---

## Ops — Internal / staff (recommend: move off member flags to a staff list)

| #   | Email (template)                                       | What triggers it                                | Today                                                                                                   | My reco                                                              | ✍️ YOUR IDEAL UX |
| --- | ------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------- |
| 20  | **Admin member-status alert** (`admin-member-alert`)   | Member hits a status (e.g. interview scheduled) | Bypasses opt-out (intentional)                                                                          | Staff · keep                                                         |                  |
| 21  | 🔴 **New-feedback admin alert** (`feedback_alert`)     | User submits feedback                           | Per-admin `notify_announcements`; _(verified)_ **on retired raw queue → delivering NOTHING since July** | **Staff ops list**, not a member flag · migrate to v2 + fix delivery |                  |
| 22  | **Daily error-triage digest** (`triage-digest`)        | Cron                                            | Owner address                                                                                           | Staff · keep                                                         |                  |
| 23  | **Fleety Coach weekly digest** (`fleety-coach-digest`) | Cron                                            | Admin recipients                                                                                        | Staff · keep                                                         |                  |

---

## Known cleanups riding along (confirm you want these in this release)

| #   | Item                                                                                                                                                      | Recommendation                                                       | ✍️ YOUR CALL |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------ |
| C1  | ⚠️ Dead template `signup-confirmation-reminder` (no caller)                                                                                               | Remove                                                               |              |
| C2  | ⚠️ Project-opening unsubscribe link → `techfleetnetwork.lovable.app` (old domain)                                                                         | Fix to `techfleet.network`                                           |              |
| C3  | Stranded legacy `enqueue_email` senders (project-opening, feedback)                                                                                       | Migrate to v2 outbox                                                 |              |
| C4  | Retire `notify_announcements` column entirely (after bake-in)                                                                                             | Drop it                                                              |              |
| C5  | _(verified)_ Reconciler `reconcile_stuck_emails()` re-enqueues onto the **retired raw queue**                                                             | Repoint to v2 outbox                                                 |              |
| C6  | _(verified)_ DLQ replay paths (`replay-email-dlq`, `replay-dlq-emails`) re-enqueue onto retired raw queue                                                 | Repoint to v2                                                        |              |
| C7  | _(verified)_ `announcement` broadcast has a legacy `enqueue_email` fallback that strands the whole send if the bulk v2 flag is off                        | Remove fallback; guarantee v2                                        |              |
| C8  | _(verified)_ `admin_promotion`, `teacher_promotion`, `announcement` render **inline HTML** (not registry templates) — invisible to registry-based tooling | Bring into the template registry so the tiering work can't skip them |              |

---

## Two questions embedded in the table (call them out when you fill it)

1. **Row 15 (resume-application reminder)** — is a "you didn't finish applying" nudge _critical
   transactional_ (Tier 0, always) or _service_ (Tier 1, opt-out-able)? I lean Tier 1, but it's
   about their own application, so you may want Tier 0.
2. **Row 13 (project opening alert)** — keep the current interest-tag relevance filter, or
   broaden project openings to all active trainees (still opt-out-able)?
3. **Row 8 (class status change)** — today only the teacher + admins are emailed. Should the
   **enrolled trainees** also be notified when their class opens/changes/cancels? (I'd say yes —
   it's about a class they're in.)
4. **Row 16b (project blast)** — is this Tier 0 (about their own application outcome, always
   send) or Tier 1 (service, opt-out-able)?
