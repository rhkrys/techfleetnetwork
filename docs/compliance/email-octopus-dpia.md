# DPIA — Email Octopus marketing sync (contact data to a marketing ESP)

Status: PR 6 governance artifact. A lightweight DPIA is warranted because the feature introduces a
**new international transfer of personal data to a third-party processor** for a global audience.
Design: [ADR-0017](../adr/0017-email-octopus-marketing-source-of-truth.md). Companion to
`docs/compliance/privacy-runbook.md`.

## 1. Processing described

When a member opts in to marketing (at signup or in profile → notification settings), the platform
sends their contact record to **Email Octopus (EO)**, the marketing email service and the source of
truth for the marketing list. On opt-out, the platform tells EO to unsubscribe; on account deletion,
to delete the contact (PR 8). All EO calls are **server-side only** (edge function; the API key never
reaches the browser) and go through a **durable retry queue** — never a synchronous call on the user
path.

- **Data subjects:** Tech Fleet members who opt in to marketing. Global audience (~86 countries).
- **Personal data sent to EO:** email address; first name (optional personalization); subscription
  status (subscribed / unsubscribed). No special-category data. No behavioral or profile data beyond
  these fields.
- **New processing:** first transfer of member contact data to EO → the DPIA trigger.

## 2. Necessity & proportionality

- **Lawful basis:** consent — GDPR Art. 6(1)(a); CASL express consent; CCPA service-provider (not a
  sale). Consent is an explicit opt-in (default OFF), captured at signup or in the profile, and is
  freely withdrawable at any time (in-app toggle or any EO email footer).
- **Minimization:** only email + first name + subscription status leave the platform. Custom fields are
  sent only if a field tag is configured. No local marketing state is stored on `profiles` (EO is the
  SoT); the only local artifact is the outbox row required to guarantee delivery of an opt-out.
- **Purpose limitation:** the data is used to send Tech Fleet's newsletter/marketing only. It is not
  repurposed. Service (Tier-1) and account (Tier-0) email do NOT go through EO.

## 3. International transfer

Email Octopus Ltd is **UK-based** (EO processes contact data in the UK/EU). Sending a global audience's
contact data there is a cross-border transfer.

- **Mechanism:** EO acts as a **processor**; the transfer relies on EO's Data Processing Agreement and
  its standard transfer terms (UK IDTA / EU SCCs as applicable). **Owner action:** accept/sign EO's DPA
  and confirm the transfer terms before enabling the sync in production.
- **UK adequacy:** the EU↔UK adequacy decision covers EU→UK flows; for US/other-origin members, EO's DPA
  transfer terms apply.

## 4. Risks & mitigations

| Risk                                                                                            | Likelihood | Impact | Mitigation                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An opt-out is dropped (EO down) → member still marketed to after opting out (compliance breach) | Med        | High   | **Durable retry queue** (never fire-and-forget); an unsubscribe is retried to completion; the un-synced-opt-out backlog is a **paged** SRE signal (`get_eo_sync_health`, [runbook](../runbooks/email-octopus-sync.md)) |
| API key leaked → attacker reads/edits the list                                                  | Low        | High   | Key is **server-side only** (Vault/edge secret), never in the browser; a member can act only on their own email (`auth.uid()`); rotation runbook                                                                       |
| A member acts on someone else's subscription                                                    | Low        | Med    | `set_my_marketing_subscription` is self-only (no email parameter; reads the caller's own email via `auth.uid()`); the sync table is deny-all RLS                                                                       |
| Over-collection / scope creep of fields sent to EO                                              | Low        | Med    | Only email + first name + status; custom fields gated behind explicit config; documented here                                                                                                                          |
| Transfer to a processor without a lawful basis                                                  | Low        | Med    | EO DPA + UK/EU transfer terms (owner action, §3); consent basis (§2)                                                                                                                                                   |
| Erasure not honored at EO                                                                       | Low        | Med    | Account deletion enqueues an EO contact **delete** (PR 8); the delete path is idempotent (404 = already gone = done)                                                                                                   |

## 5. Data-subject rights

- **Withdraw consent / unsubscribe:** in-app toggle (writes the desired state, synced to EO) or any EO
  email footer (handled by EO directly). Durable queue guarantees propagation.
- **Erasure:** account deletion removes the EO contact (PR 8) — the sync marks `desired_status='deleted'`
  and the worker calls EO `DELETE`. No local marketing receipt remains to clear.
- **Access/export:** the member's subscription status is EO's record; export tooling surfaces it. There
  is no separate local marketing profile to export.

## 6. Subprocessor register entry (for the privacy notice)

| Subprocessor      | Purpose                                                 | Personal data                                  | Location | Transfer basis                                |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------- | -------- | --------------------------------------------- |
| Email Octopus Ltd | Marketing/newsletter email delivery and list management | Email address, first name, subscription status | UK / EU  | EO DPA + UK IDTA / EU SCCs (owner to confirm) |

**Owner action:** add Email Octopus to the public subprocessor list / privacy notice before the sync is
enabled in production.

## 7. Residual risk & decision

With server-side-only calls, the durable retry queue (opt-outs never lost) + paged backlog, minimal
fields, consent basis, and the EO DPA in place, residual risk is **acceptable** for launch. **Blocking
owner actions before go-live:** (1) accept/sign the EO DPA and confirm transfer terms; (2) add EO to the
subprocessor list / privacy notice; (3) set the EO secrets in Vault. Re-assess if the fields sent to EO
expand or if EO's processing location changes.
