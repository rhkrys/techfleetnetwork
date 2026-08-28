# Architecture Audit & Hardening — August 2026

The permanent record of the full architectural audit of `main` and the plan to remediate it.
Committed so it survives across sessions and is visible to the whole team.

## What's here
| File | Contents |
|---|---|
| [`hardening-plan.md`](hardening-plan.md) | **The remediation plan (v2)** — phased, critical → tidy‑up, with triage, codemods, the auth track, and exit criteria. |
| [`findings.md`](findings.md) | **All 837 verified findings**, by section — each with *where / what breaks / smallest fix*. |
| [`findings-high.md`](findings-high.md) | The **179 High‑severity** findings, grouped by section. |
| [`../../adr/0019-architecture-gate.md`](../../adr/0019-architecture-gate.md) | The foundational decision: the blocking architecture gate. |

## The numbers
- **837 findings** across **46 sections** (current `main`, `9d772cd`): **179 High · 430 Medium · 228 Low**.
- Confidence: **752 CONFIRMED · 85 PLAUSIBLE** (adversarially re‑checked). Only the 85 need a verify‑or‑dismiss pass before fixing.
- Dominant categories: **error‑handling (265)**, **security (129)**, under‑engineering (129), ownership (108), boundary (75).

## Two "done" signals (both this release)
1. `arch-gate.waivers.json` → **0** — the ~313 structural findings, proven by the gate.
2. All **837** resolved (fixed **or** dismissed‑with‑rationale), the rest proven by tests.

## Interactive / shareable views (claude.ai artifacts)
- Interactive, filterable report of all 837: https://claude.ai/code/artifact/6d64f2a9-2a4d-4e1b-b85c-f24afa5afa44
- Plain‑English guide to what it means: https://claude.ai/code/artifact/3c3b1335-2a7e-4bf0-979c-ee7d3d00b0a8
- The plan (visual): https://claude.ai/code/artifact/96f602ac-4a9f-4828-82dc-ec822366d4f5

_Audit method: 46 read‑only architect agents (one per section) audited every page, component, hook, service, lib module, and all ~130 edge functions against the four questions — boundary placement, data ownership, dependency direction, error handling — then a second adversarial pass re‑checked each finding against the code. Approach from the certificates.dev / TechFleet workshop "Who's Designing Your System?"._
