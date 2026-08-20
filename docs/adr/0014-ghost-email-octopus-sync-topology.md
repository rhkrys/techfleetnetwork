# ADR-0014: Ghost and Email Octopus sync topology

- **Status:** Accepted (2026-08-19)
- **Related:** [ADR-0013](0013-consent-ledger-source-of-truth.md) (the source of truth).
  Requirements: `docs/design/email-rearchitecture-requirements.md` §8.5. Threat model:
  `docs/security/email-rearchitecture-threat-model.md`.

## Context

The community team sends its newsletter from Ghost and the marketing team runs campaigns from Email
Octopus. Under the unified marketing model, both lists must always match one value in the platform
(`consent_current.marketing`). Every newsletter and campaign also carries its own unsubscribe link,
so people will unsubscribe inside the vendors, not only on the platform. A one-directional push
would therefore drift immediately.

## Decision

Hub-and-spoke, with the platform as the hub and both vendors as mirrors.

- **Outbound.** A consent change enqueues a job on the existing pgmq queue (with DLQ and replay)
  that upserts or unsubscribes the person in Ghost and Email Octopus by API. Idempotent, so a retry
  never double-adds. Rate-limited to each vendor's limits.
- **Inbound.** Two webhook receivers (Ghost `member.updated` and `member.deleted`, and Email
  Octopus unsubscribe). Each verifies the signature on the raw body, is replay-protected, and then
  writes a `consent_event`.
- **Reconcile.** A nightly job reads the actual state of both vendor lists, diffs against
  `consent_current`, and issues the API calls to make all three agree. It is also the backstop for
  the known Ghost behavior that CSV imports do not fire webhooks.
- **Loop prevention.** An external unsubscribe updates the platform, which then pushes the removal
  only to the other vendor, never back to the origin. Enforced by source tagging and by pushing
  only when the target state actually differs.
- **Drift policy.** Unsubscribes always win and propagate immediately. A vendor contact with no
  consent record is flagged for admin review, never auto-removed and never auto-trusted.

Reuses the queue, DLQ, replay, and cron the app already runs. No message bus, no new service.

## Alternatives considered

1. **One-directional push (platform to vendors only).** Rejected: it ignores in-vendor
   unsubscribes, so the platform would keep emailing people who opted out, a compliance failure.
2. **Let vendors sync directly to each other.** Rejected: neither can be the source of truth, and
   it produces update loops with no authoritative arbiter.
3. **A dedicated sync microservice or message bus.** Rejected as over-engineering for about 1,253
   users; the existing queue and cron are sufficient and already operated.
4. **Auto-remove any vendor contact lacking a consent record.** Rejected as the default: it would
   delete people a team added out-of-band with no human review. Flag-for-review is safer.

## Consequences

- **Easier:** the two lists stay matched to one truth automatically; an unsubscribe anywhere is
  honored everywhere; the teams keep their own sending tools.
- **Harder / accepted:** two webhook receivers with signature verification, a reconcile job, strict
  loop-prevention logic, and vendor secrets in Vault. The sync is eventually consistent (a few
  minutes), not instantaneous, which the SLOs account for.
