# Architecture Decision Records

Lightweight ADRs for significant, long-lived decisions (new bounded contexts, data-source
changes, contracts other code depends on). Format: **Status / Context / Decision /
Alternatives considered / Consequences**. Numbered, immutable — a superseded decision is
marked `Superseded by ADR-XXXX`, never deleted or rewritten.

| ADR                                               | Title                                                                              | Status   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | -------- |
| [0001](0001-spf-single-source-of-truth.md)        | SPF becomes the single source of truth for the framework data layer                | Accepted |
| [0002](0002-spf-ingestion-sync-subsystem.md)      | External SPF ingestion / sync subsystem                                            | Accepted |
| [0003](0003-framework-graph-rebuild-facade.md)    | Framework-graph rebuild behind a source facade                                     | Accepted |
| [0004](0004-handoff-pipeline-async.md)            | Hand-off generation as an async pipes-and-filters pipeline                         | Accepted |
| [0005](0005-llm-model-capability-port.md)         | LLM provider/model behind a capability port                                        | Accepted |
| [0006](0006-handoff-material-ingest.md)           | Hand-off material ingest — durable, checkpointed, hardened multi-format extraction | Accepted |
| [0007](0007-handoff-load-on-demand-extraction.md) | Load-on-demand extraction to bound hand-off worker memory                          | Accepted |

These ADRs cover the **Hand-Off Production System + SPF data-layer migration** work. The full
requirement specification (skills-vetted) lives in the approved plan; each ADR here records
one load-bearing decision from it.
