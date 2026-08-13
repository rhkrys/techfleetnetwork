# DPIA — Hand-Off Production System (AI processing of personal data)

Status: Phase 0 governance artifact. A Data Protection Impact Assessment is **required** here
because the feature is high-risk processing under the privacy skill's trigger: _large-scale
processing of personal data by new technology (a multi-agent LLM pipeline)_. Companion to
`spf-handoff-data-classification.md` and `docs/compliance/privacy-runbook.md`.

## 1. Processing described

Active project teammates upload deliverables (files + ≤10k text) that can contain personal
data — teammate names, client/constituent names, stakeholder feedback, meeting-recording
links. A multi-agent LLM pipeline — served via **OpenRouter**, using **Anthropic Claude Opus 4.8**
for the audience writers and **DeepSeek v4** for fact extraction and source mapping — parses this,
extracts a fact base, and writes four
audience narrative documents, stored in private Storage and readable in-app by active members
of that project. **No automated distribution in this build** (email deferred).

- **Data subjects:** Tech Fleet teammates on the project; named clients/constituents and
  stakeholders appearing in uploaded materials (third parties who did not sign up).
- **Personal data categories:** names, roles, professional opinions/feedback, work product
  attributable to individuals. No special-category data is _required_; free-text uploads could
  contain it incidentally (mitigation below).
- **New technology:** LLM multi-agent generation → the DPIA trigger.

## 2. Necessity & proportionality

- **Lawful basis:** legitimate interest — a team producing a hand-off of _its own_ project work
  for onboarding/case-study/leadership purposes. Purpose is limited to that; the data is not
  repurposed.
- **Minimization:** the thin-projection of SPF workshops/deliverables; ≤10k text cap per
  component; only active-project members can read outputs. (Org Case Study pseudonymization —
  roles rather than names where identity isn't needed — is planned, not yet implemented.)
- **Third-party data:** client/stakeholder personal data enters via teammate uploads. Mitigation:
  purpose limitation, access restricted to the project team, retention window, and the ability
  to delete on request.

## 3. Risks & mitigations

| Risk                                                                           | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection in an uploaded file steers the LLM (LLM01)                    | Med        | High   | System vs untrusted-content separation; constrained tools (writers have **no** tools); output validation; no secrets in prompts                                                                                                                                                                                                                                                                                                                       |
| Cross-project leak of a hand-off (IDOR)                                        | Low        | High   | Deny-by-default RLS; ownership re-check on every access; short-lived project-scoped signed URLs                                                                                                                                                                                                                                                                                                                                                       |
| Sensitive data incidentally in uploads reaches the LLM sub-processors          | Med        | Med    | Data-minimization guidance in the UI; DPA with the LLM sub-processors (OpenRouter, Anthropic, DeepSeek); DLP scrub of model OUTPUT (input-side scrub + name redaction planned); classification = Restricted                                                                                                                                                                                                                                           |
| Generated narrative fabricates/among-mixes personal facts (LLM08 overreliance) | Med        | Med    | Grounding in the fact base; **email/auto-distribution deferred** — a human reads outputs in-app before any external use                                                                                                                                                                                                                                                                                                                               |
| Stale/poisoned SPF grounding misdescribes the work                             | Low        | Med    | SPF schema validation + provenance + atomic swap ([ADR-0002](../adr/0002-spf-ingestion-sync-subsystem.md))                                                                                                                                                                                                                                                                                                                                            |
| Cross-border transfer of personal data to a non-adequate country               | Low        | Med    | RESOLVED in code: the DeepSeek mechanical model (which reads raw uploads) is pinned to **US** OpenRouter providers (CoreWeave/Together/Fireworks/DeepInfra/BaseTen) in `_shared/llm/port.ts`; Anthropic writer is US. No China processing. Standard US-vendor DPAs remain an owner action                                                                                                                                                             |
| Right-to-erasure not honored across derived stores                             | Low        | Med    | IMPLEMENTED for the personal-data store: account deletion (`handle_user_deletion`) erases the departing user's hand-off submissions + their blobs; `prune_handoff_productions` caps retention of superseded versions. Generated hand-offs are shared project work product — retained; the erased user's `triggered_by` becomes a dangling UUID (de facto pseudonymized). Fact-base/vector propagation lands with the RAG re-embed work (Workstream A) |

## 4. Data-subject rights

**Erasure** now reaches the hand-off personal-data store: account deletion — the single erasure
entrypoint (`BEFORE DELETE ON auth.users → handle_user_deletion`) — deletes the departing user's
hand-off submissions and best-effort removes their `handoff-deliverables` blobs, and
`prune_handoff_productions` enforces a retention window on superseded versions (both covered by
`supabase/tests/handoff_erasure_retention_test.sql`). The generated hand-offs are shared project
work product (many people's data) and are retained; the erased user's `triggered_by` becomes a
dangling UUID once auth.users + profiles are gone (de facto pseudonymized), and their
`project_applications` membership is deleted in the same trigger. **Still to land:** access/export
tooling, propagation into the RAG re-embed vectors (Workstream A), and DSAR receipt/fulfilment
audit entries. Owner sign-off still required before real personal data flows at scale.

## 5. Residual risk & decision

With the mitigations above — and with **auto-distribution deferred** (removing the LLM06/LLM08
auto-send risk for this build) — residual risk is assessed **acceptable for launch of the
in-app (produce → store → view) MVP**. Re-assess this DPIA before building the distribution
phase (email fanout + any review/release gate), which reintroduces the high-impact auto-send
risk. Owner sign-off required before Phase B3 ships to production.
