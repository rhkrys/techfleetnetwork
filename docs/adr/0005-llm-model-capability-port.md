# ADR-0005: LLM provider/model behind a capability port

- **Status:** Accepted (2026-08-10); **Amended (2026-08-12)** — see "Amendment" below
- **Related:** [ADR-0004](0004-handoff-pipeline-async.md)

## Amendment (2026-08-12) — adapter, models, and US data residency

The port shape is unchanged; the default adapter and model IDs are updated to match what
ships. The single adapter now targets **OpenRouter** (`https://openrouter.ai/api/v1`,
OpenAI-compatible, same forced-tool-call contract), with two capability roles as **code
defaults, env-overridable** (`supabase/functions/_shared/llm/port.ts`):

- **Writer** (all four hand-off audiences): `anthropic/claude-opus-4.8` — chosen on output
  quality after A/B against alternatives; runs at temperature 0 for reproducibility.
- **Mechanical** (fact extraction, source mapping, stage-3.5 dedup): `deepseek/deepseek-v4-flash-0731`.

**Data residency (the reason this amendment is architecturally significant):** the mechanical
model reads raw uploaded deliverables, which contain personal data. DeepSeek is a China
company, so to keep that processing under US jurisdiction the port **pins any `deepseek/*`
model to US inference providers** via OpenRouter routing —
`provider: { only: US_INFERENCE_PROVIDERS, allow_fallbacks: true }` where
`US_INFERENCE_PROVIDERS = [together, fireworks, deepinfra, baseten, coreweave]`. The allow-list
is a hardcoded const (no env read) so the residency guarantee cannot be silently widened by a
misconfigured env var, and it never contains DeepSeek's own (China) endpoint. Verified: a live
call served from **CoreWeave (US)**. Anthropic (writer) is already US. Non-DeepSeek models
carry no provider pin. See `docs/compliance/spf-handoff-data-classification.md`.

## Context

The hand-off writer/fact-extraction stages need a reasoning-capable LLM with structured
(JSON / tool-call) output. The repo already calls Groq's OpenAI-compatible API from
`supabase/functions/techfleet-chat` (`GROQ_MODEL = "openai/gpt-oss-20b"`;
`llama-3.3-70b-versatile` is deprecated 2026-08-16). The requirements doc names capability
requirements (reasoning-capable, tool/function calling, large context, structured JSON I/O)
and a default of `gpt-oss-120b` for writers / `gpt-oss-20b` for mechanical stages, but keeps
functional requirements **model-agnostic**. Provider swap is a real, stated requirement.

## Decision

Access the LLM through a **single hexagonal port** (`generateStructured(input) -> JSON`) with
Groq as the default adapter, reusing the existing `techfleet-chat` idioms: OpenAI-compatible
`chat/completions`, **forced tool-call** for structured JSON, cost metering via
`fleety_record_cost`, and the existing `applyWaf` + `withAuditWrapper` + `dlpScrub` +
prompt-injection/output-sanitization wrappers. Model IDs are configuration, not code: default
`gpt-oss-20b` (verified available), with `gpt-oss-120b` selectable for writer agents once
availability is confirmed on the account. The port stays **minimal** — one interface, one
real adapter — justified by the genuine provider-swap requirement, not a speculative plugin
framework.

Prompt-safety is a first-class part of the port: system instructions are kept separate from
uploaded/retrieved (untrusted) content; tools are constrained, not merely instructed against;
model output is validated/sanitized before use; no secrets are placed in prompts.

## Alternatives considered

1. **Call Groq inline in each stage.** Duplicates auth/cost/safety wrapping across stages and
   hard-codes the provider; a later swap touches many call sites. Rejected.
2. **A generic multi-provider abstraction layer now.** Over-engineered (YAGNI) for one real
   adapter; a single port with config-selectable model IDs meets the requirement. Rejected.

## Resilience posture — why there is no auto-tripping circuit breaker (deliberate)

The requirements survey lists a circuit breaker on the LLM among the resilience patterns. We
deliberately do **not** implement a per-provider auto-tripping breaker, and record that here so
the omission is a decision, not a gap:

- **What the port DOES have:** an explicit timeout on every call; bounded retry with jittered
  backoff that is capped by a total wall-clock **deadline** (a hung provider cannot be amplified);
  and **fail-fast on terminal errors** (4xx / truncation / refusal are never retried). A per-arc
  writer failure degrades to an honest "_Awaiting content._" placeholder and is now counted as a
  run `gap_count` rather than silently shipped.
- **The outage control is the kill switch, not a breaker.** `HANDOFF_PRODUCE_DISABLED` (see the
  Groq/LLM-outage runbook) lets an operator "queue and hold" during a provider outage: the front
  door stops new runs and the worker holds queued ones, so nothing hammers a down provider. This
  is the manual equivalent of an open circuit, and it is auditable and reversible without a deploy.
- **Why not the automatic version:** at ~5–10 hand-off runs/month the per-provider request rate is
  far too low for a breaker's failure-window statistics to be meaningful, and an auto-open breaker
  would add shared mutable state to otherwise-stateless edge invocations for no real protection
  (YAGNI, matching this ADR's "no speculative framework" stance). Revisit if hand-off volume or a
  shared always-on service (not per-invocation edge functions) changes that calculus.

## Consequences

- **Easier:** provider/model is a config change; safety + cost controls are enforced in one
  place; stages depend on a stable JSON contract, not on Groq specifics.
- **Harder / accepted:** the port must define a provider-neutral structured-output contract and
  map provider-specific tool-call shapes into it; `gpt-oss-120b` availability remains an open
  config item (design is unaffected either way). There is no automatic circuit breaker — the
  manual kill switch covers the outage case (see "Resilience posture" above).
