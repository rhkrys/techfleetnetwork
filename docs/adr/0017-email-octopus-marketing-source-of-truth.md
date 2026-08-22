# ADR-0017: Email Octopus is the marketing source of truth

- **Status:** Accepted (2026-08-20)
- **Supersedes:** [ADR-0013](0013-consent-ledger-source-of-truth.md) (platform consent ledger),
  [ADR-0014](0014-ghost-email-octopus-sync-topology.md) (Ghost + Email Octopus two-way sync).
- **Related (still in force):** [ADR-0015](0015-transactional-marketing-scope-separation.md)
  (suppression scopes), [ADR-0016](0016-email-tiering-and-notify-announcements-retirement.md)
  (tiering). Requirements: `docs/design/email-rearchitecture-requirements.md` (Revision 2).

## Context

ADR-0013 and ADR-0014 designed the marketing side around a **platform-owned consent ledger** that
was synced two-way to **both Ghost and Email Octopus**, with a nightly reconcile and loop-prevention.
That machinery existed for one reason: to keep _two_ independent mailing systems in agreement.

Owner decision (2026-08-20): **stop sending email through Ghost.** Ghost becomes the blog/site only.
**Email Octopus becomes the single marketing email system.** With one downstream list there is
nothing to reconcile, so the entire hub-and-spoke design is unjustified complexity.

## Decision

**Email Octopus is the source of truth for the marketing list.** The platform does not own
authoritative marketing subscription state.

1. **The platform is the front door, EO is the record.** Members opt in at signup and manage their
   subscription in the profile's notification settings. Those controls call the EO API
   (subscribe / unsubscribe) on the member's own email. EO holds the truth; the platform's toggle
   reflects EO.
2. **Ghost sends no email.** No Ghost integration exists.
3. **Marketing unsubscribe is EO's.** EO's own unsubscribe link handles unsubscribes from marketing
   emails; an optional EO → platform webhook keeps the profile toggle's display fresh. The platform
   builds no marketing unsubscribe endpoint. (The platform's _own_ Tier-1 service email keeps its
   own scope-aware unsubscribe, per ADR-0015.)
4. **The EO sync is durable, not fire-and-forget.** Every add/remove is enqueued (existing pgmq /
   outbox pattern) and retried with backoff by a worker; it is never a synchronous call on the user
   path. Signup and profile-save commit locally and **fail open** if EO is down. A dropped opt-out
   is a compliance breach, so the queue guarantees eventual delivery and its backlog is a paged SRE
   signal.
5. **EO calls are server-side only** (edge function); the API key never reaches the browser; a member
   can act only on their own email (`auth.uid()`). Behind an `email_octopus_sync` feature flag.
6. **Minimal local receipt** (`profiles.marketing_opt_in_at` + source): compliance proof + retry
   support only, not a source of truth, not read to gate any send. (Optional; owner may drop it.)
7. **EO is a named subprocessor** in the privacy notice and DPIA, with the UK/EU international-transfer
   basis documented.

## Alternatives considered

1. **Keep the platform consent ledger + two-way sync (ADR-0013/0014).** Rejected: it was justified
   only by having two mailing systems. With Ghost dropped as a sender, it is pure over-engineering,
   a whole subsystem to maintain for no benefit.
2. **Platform is the source of truth, one-way push to EO only.** Rejected: still duplicates
   subscription state and unsubscribe handling that EO already owns, and creates a drift problem
   (in-EO unsubscribes) for no gain.
3. **Fire-and-forget EO API calls from the request handler.** Rejected: an EO outage would then block
   signup, or silently drop an opt-out (a live compliance breach). The durable queue (decision 4) is
   required.

## Consequences

- **Easier:** deletes the consent ledger, the two-way sync workers, the nightly reconcile +
  loop-prevention, all Ghost integration, and the custom marketing unsubscribe. Roughly four PRs of
  the hardest machinery, gone. Far smaller attack and maintenance surface.
- **Harder / accepted:** EO is now a subprocessor (privacy/DPIA/international-transfer work), and the
  platform depends on EO for marketing (mitigated by the durable retry queue and fail-open user path).
  The marketing consent record lives in EO. Leaving EO later means exporting that list first.

## Amendments (2026-08-22, during PR 6 build)

1. **No local marketing receipt (decision 6 dropped).** Owner decision: do not store marketing state
   on `profiles` at all — EO is the single source of truth. The only local artifact is the durable
   sync row (`email_octopus_contact_sync`), which is an outbox/retry queue, not a parallel state
   store; once synced it mirrors EO and also drives the preference toggle's displayed value (read via
   the self-only `get_my_marketing_subscription()` RPC). Consent origin/timing is evidenced by EO's
   own record plus the sync row's timestamps/`attempt_history`. The `profiles.marketing_opt_in_at` /
   `marketing_opt_in_source` columns from the first PR-6a draft were removed before merge.
2. **Display freshness via a live per-user read, not a webhook (decision 3 changed).** To reflect a
   member's true EO state — including subscribes/unsubscribes made outside the platform (e.g. a blog
   newsletter signup) — the preference page does a **live, self-only read of that one contact from EO**
   on load (`eo-contact-status` edge function; email derived from the caller's identity, EO called
   server-side). This is a _pull_ for one person on demand. We deliberately did **not** subscribe to
   EO's Created/Updated webhooks: that is a _push_ of every contact change for the whole list, which
   would recreate the marketing list in our DB (the thing this ADR avoids) and add noise. The live read
   also covers the EO-side unsubscribe case, so the unsubscribe webhook is unnecessary and was dropped.
   When EO is unavailable or disabled, the toggle falls back to the cached mirror
   (`get_my_marketing_subscription`).
