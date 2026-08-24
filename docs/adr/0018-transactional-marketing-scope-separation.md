# ADR-0018: Transactional and marketing scope separation, and independent suppression scopes

- **Status:** Accepted (2026-08-19)
- **Related:** [ADR-0016](0016-email-tiering-and-notify-announcements-retirement.md) (tiers),
  [ADR-0013](0013-consent-ledger-source-of-truth.md) (consent). Requirements:
  `docs/design/email-rearchitecture-requirements.md` §4, §10.

## Context

The existing `suppressed_emails` table is a single global kill-switch keyed by address, used for
hard bounces and spam complaints. Once marketing consent and a Tier 1 opt-out exist, a real risk
appears: treating a marketing or opportunity opt-out as a global suppression would also stop the
person's password resets and application updates. A marketing unsubscribe must never break account
email. Conversely, a hard bounce or complaint must stop everything, including critical mail.

## Decision

Three independent suppression scopes, evaluated together:

1. **Global suppression** (`suppressed_emails`: hard bounce, spam complaint). Applies to all tiers
   and always wins.
2. **Tier 1 opt-out** (the "Opportunities and platform updates" preference). Gates only Tier 1.
3. **Marketing consent** (`consent_current.marketing`, ADR-0013). Gates only Tier 2.

Rules:

- A Tier 1 opt-out or a Tier 2 unsubscribe writes to its own scope. It must NEVER add a global
  `suppressed_emails` row.
- Tier 0 reads no member preference at all (enforced by ADR-0016 and its CI guards). Only global
  suppression can stop a Tier 0 send.

## Alternatives considered

1. **One global suppression list for everything.** Rejected: a marketing opt-out would silently
   suppress account email, locking people out of their own applications and password resets.
2. **Per-tier boolean columns with no distinction from global suppression.** Rejected: blurs the
   "hard bounce stops everything" rule with the "opt-out stops only this tier" rule, which is
   exactly the confusion that caused the original overloaded flag.

## Consequences

- **Easier:** a marketing or opportunity opt-out can never break account email; a bounce or
  complaint still stops all tiers; each control has one clear meaning.
- **Harder / accepted:** send paths evaluate the correct scope per tier, and a `@compliance` test
  asserts that a marketing opt-out does not add a global suppression row and does not stop a
  password reset. The three scopes must be documented so future senders honor them.
