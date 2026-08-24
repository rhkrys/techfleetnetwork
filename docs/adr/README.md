# Architecture Decision Records

Lightweight ADRs for significant, long-lived decisions (new bounded contexts, data-source
changes, contracts other code depends on). Format: **Status / Context / Decision /
Alternatives considered / Consequences**. Numbered, immutable — a superseded decision is
marked `Superseded by ADR-XXXX`, never deleted or rewritten.

| ADR                                                               | Title                                                                              | Status             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------ |
| [0001](0001-spf-single-source-of-truth.md)                        | SPF becomes the single source of truth for the framework data layer                | Accepted           |
| [0002](0002-spf-ingestion-sync-subsystem.md)                      | External SPF ingestion / sync subsystem                                            | Accepted           |
| [0003](0003-framework-graph-rebuild-facade.md)                    | Framework-graph rebuild behind a source facade                                     | Accepted           |
| [0004](0004-handoff-pipeline-async.md)                            | Hand-off generation as an async pipes-and-filters pipeline                         | Accepted           |
| [0005](0005-llm-model-capability-port.md)                         | LLM provider/model behind a capability port                                        | Accepted           |
| [0006](0006-handoff-material-ingest.md)                           | Hand-off material ingest — durable, checkpointed, hardened multi-format extraction | Accepted           |
| [0007](0007-handoff-load-on-demand-extraction.md)                 | Load-on-demand extraction to bound hand-off worker memory                          | Accepted           |
| [0013](0013-consent-ledger-source-of-truth.md)                    | Consent ledger as the single source of truth for marketing consent                 | Superseded by 0017 |
| [0014](0014-ghost-email-octopus-sync-topology.md)                 | Ghost and Email Octopus sync topology                                              | Superseded by 0017 |
| [0015](0015-mui-owned-design-system-layer.md)                     | TechFleet Design System as an owned layer on MUI Core (not a fork)                 | Proposed           |
| [0016](0016-email-tiering-and-notify-announcements-retirement.md) | Email tiering and retirement of `notify_announcements`                             | Accepted           |
| [0017](0017-email-octopus-marketing-source-of-truth.md)           | Email Octopus is the marketing source of truth (Ghost blog-only)                   | Accepted           |
| [0018](0018-transactional-marketing-scope-separation.md)          | Transactional/marketing scope separation and independent suppression scopes        | Accepted           |

The first block of ADRs covers the **Hand-Off Production System + SPF data-layer migration** work
(0008 to 0012 exist in this directory as well). **0015** is the design-system ADR (MUI-owned layer).
ADRs **0013, 0014, 0016, 0017, 0018** cover the **email rearchitecture**; its full skills-vetted
requirements live in `docs/design/email-rearchitecture-requirements.md`. **Revision 2 (2026-08-20):**
Email Octopus became the marketing source of truth, so 0013 and 0014 are superseded by 0017. (The
scope-separation ADR was renumbered 0015 → 0018 to resolve a collision with the design-system ADR.)
