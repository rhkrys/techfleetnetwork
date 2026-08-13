# Runbook — Groq / LLM provider outage (hand-off pipeline)

Skeleton (finalized in Phase B2). The hand-off writer/fact-extraction stages call Groq behind
the model port ([ADR-0005](../adr/0005-llm-model-capability-port.md)).

**Symptom:** `groq_fail` error metric rising; hand-off produce runs stalling in the LLM stages;
produce success SLO burning.

**Severity:** SEV2 if produce is broadly failing; SEV3 for isolated transient failures.

**Mitigate first:** the pipeline is queued and resumable — in-flight runs **hold** at the LLM
stage rather than failing/half-producing (graceful degradation). If Groq is hard-down, flip the
pipeline **kill switch** so new "Produce Hand-Offs" requests queue with a clear "held — LLM
provider unavailable" status instead of burning retries.

**Diagnose:**

1. Groq status + the request's correlation-id logs — auth error (secret) vs rate-limit (429) vs
   provider 5xx?
2. **Secret unset/expired** → the port fails fast; fix the Groq secret in the edge secret store.
3. **Rate-limit** → the per-run/per-user spend+iteration caps and worker concurrency should
   already bound this; check saturation (LLM rate-limit headroom signal).
4. **Provider 5xx** → circuit breaker opens; retries back off with jitter.

**Recover:** once Groq is healthy, clear the kill switch; held runs resume from their last
completed stage (idempotent — no double-write, no double-produce). Optional: switch the model
port to `gpt-oss-120b` or a documented fallback model if one tier is degraded.

_TODO (Phase B2): kill-switch location, queue table, resume command, fallback-model config._
