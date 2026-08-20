# ADR-0016: Email tiering and retirement of `notify_announcements`

- **Status:** Accepted (2026-08-19)
- **Related:** [ADR-0015](0015-transactional-marketing-scope-separation.md) (suppression scopes),
  [ADR-0013](0013-consent-ledger-source-of-truth.md) (marketing consent). Requirements:
  `docs/design/email-rearchitecture-requirements.md`.

## Context

Every platform email was gated, or not, ad hoc in each sender. One profile flag,
`notify_announcements` (`NOT NULL DEFAULT false`), was overloaded across four jobs: it gated
marketing announcements and, at the same time, genuinely critical transactional email (interview
invitations, applicant status changes, observer grants, the training agreement offer). Because the
column defaults to false and only 163 of 1,253 accounts ever set it true, roughly 87 percent of
people never received that critical mail. The author intended the flag to default on, but the
column default made it a hard false and the safeguard never fired.

There was no single place that recorded what an email _is_, so there was no way to enforce the
rule "a critical email must never be gated by a preference."

## Decision

1. **Tier is a property of the email type, held in one central registry.**
   `supabase/functions/_shared/email/domain/email-tiers.ts` maps every template to a tier, lane,
   and unsubscribe bucket. Senders resolve tier from the registry; no sender hard-codes a
   preference read.
   - Tier 0 critical transactional: always send, no preference may gate it, only global
     suppression (hard bounce or spam complaint) can stop it.
   - Tier 1 service and opportunity: everyone by default, one opt-out ("opportunities").
   - Tier 2 marketing: opt-in only, recipients from the consent ledger (ADR-0013).
   - `ops`: internal staff email, no member preference.
   - `per-send`: the announcement composer classifies each send as Tier 1 (service) or Tier 2
     (marketing).
2. **`notify_announcements` is retired as a send gate**, everywhere. Tier 1 emails move to a single
   new "Opportunities and platform updates" opt-out (default on). The column is dropped after a
   bake-in (expand then contract).
3. **CI enforces the model.** `scripts/ci/check-email-tier-registry.mjs` (blocking) fails the build
   if any real template lacks a tier. A follow-on guard (PR 3) fails the build if any Tier-0 send
   path reads a member preference flag.

## Alternatives considered

1. **Keep one flag, flip its default to true.** Rejected: it leaves marketing and transactional
   fused under one control, which is the compliance problem, and a global default flip would opt
   everyone into marketing-flavored mail at once.
2. **A boolean per email type on the profile.** Rejected: dozens of columns, no shared invariant,
   and still no structural guarantee that a critical email cannot be gated.
3. **Decide tier per send at the call site.** Rejected: the same email would be classified
   differently by different callers. Tier belongs to the type, decided once. The one deliberate
   exception is the announcement, which is `per-send` by design.

## Consequences

- **Easier:** critical email reaches 100 percent of triggered users; the "can a preference suppress
  this?" question has one authoritative answer; adding an email forces a tier decision (CI blocks
  otherwise).
- **Harder / accepted:** a migration to add the Tier 1 preference and backfill it, a dual-read
  period while `notify_announcements` still exists, and a staged rollout (PRs 2, 3, 5) before the
  column can be dropped. The registry must be kept in step with new templates, which the CI guard
  enforces.
