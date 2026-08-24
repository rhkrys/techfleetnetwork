# ADR-0013: Consent ledger as the single source of truth for marketing consent

- **Status:** Superseded by [ADR-0017](0017-email-octopus-marketing-source-of-truth.md) (2026-08-20).
  Email Octopus became the single marketing system and the source of truth; the platform-owned
  consent ledger described here is no longer built. Retained for history.
- **Related:** [ADR-0014](0014-ghost-email-octopus-sync-topology.md) (sync),
  [ADR-0018](0018-transactional-marketing-scope-separation.md) (scopes),
  [membership ledger re-architecture] (same event-sourced pattern). Requirements:
  `docs/design/email-rearchitecture-requirements.md` §7.

## Context

Marketing state lived in three hand-maintained places: the Ghost newsletter list, the Email
Octopus list, and, implicitly, the overloaded `notify_announcements` flag. There was no single
authoritative answer to "may we send this person marketing," no provable record of when and how
they consented, and no way to keep the two vendor lists in agreement. For a genuinely global
audience (86 countries, so GDPR, CCPA, and CASL apply), consent must be provable and honored
everywhere.

## Decision

The platform database holds the single source of truth, as an event-sourced pair:

- **`consent_event`** is append-only and immutable. Every opt-in and opt-out writes one row with
  subject, marketing state, timestamp, source (signup, preference center, Ghost or Email Octopus
  unsubscribe, admin, import), notice version, actor, and request IP. This is the permanent audit
  trail and the evidence of consent.
- **`consent_current`** is the projection every send and every sync reads. With the unified
  marketing model (ADR-0016 context), it holds one value per person: subscribed or unsubscribed.
- Channel is `email` now; an `sms` channel is reserved for a future, separate opt-in.

Writes go through SECURITY DEFINER RPCs that derive the subject from `auth.uid()`, with RLS
limiting members to their own rows. The server sets provenance fields; the client cannot.

## Alternatives considered

1. **A boolean column on `profiles`.** Rejected: no history, so no provable consent and no way to
   show when or how someone opted in, which the compliance bar requires.
2. **Let a vendor (Ghost or Email Octopus) be the source of truth.** Rejected: each vendor only
   knows its own list, neither ties consent to the account, and neither can drive the other.
3. **A current-state table with no event log.** Rejected: loses the audit trail that is the whole
   point for global compliance, and makes reconciliation and disputes unresolvable.

## Consequences

- **Easier:** one authoritative answer for every send and sync; provable consent with source and
  timestamp; deletion and export can locate all of a person's consent data in one place.
- **Harder / accepted:** an event table plus a projection to maintain, and the discipline that all
  writes go through the RPCs rather than ad hoc updates. This mirrors the membership ledger already
  proven in this codebase, so the pattern is familiar.
