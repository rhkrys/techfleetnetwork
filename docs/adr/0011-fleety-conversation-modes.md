# ADR 0011 — Fleety conversation modes (Chat / Deliverables Review / Plan)

- Status: Accepted
- Date: 2026-08-18
- Deciders: TechFleet (owner)
- Related: ADR-0005 (LLM port), ADR-0010 (Figma extraction), `prompt.ts` (D-17 prompt SoT)

## Context

Members wanted Fleety to do more than converse: review a deliverable they've produced against the
SPF, and help them build a plan of action. The owner's chosen shape is a **UI mode switch, like
Claude's chat/plan modes** — not a separate form or a separate endpoint. A dedicated coach endpoint
(`fleety-review`) already exists but is unsurfaced and target-locked; a mode switch is lighter, reuses
the full chat pipeline (retrieval, streaming, the material fetcher, history, quotas), and meets the
"review this / plan this" need conversationally.

## Decision

Add a `mode ∈ {chat, review, plan}` to the chat request, defaulting to `chat`.

- **Prompt (`prompt.ts`, pure/CI-gated SoT):** two new contracts — `REVIEW_MODE_CONTRACT` and
  `PLAN_MODE_CONTRACT` — are injected **instead of** the practical contract in their modes. `chat`
  mode is byte-for-byte identical to the pre-mode prompt (guarded by the existing
  "assembly order is byte-for-byte faithful" test plus a new chat-equivalence test).
- **Handler (`techfleet-chat`):** `mode` is validated by the zod body schema (enum; unknown → 400),
  defaulted to `chat`, passed to `buildSystemPrompt`, and used to **bypass the L2/L3/canned caches**
  so a Review/Plan turn never replays a Chat-mode answer.
- **UI:** a single shared source of truth `src/lib/fleety/modes.ts` (ids, labels, placeholders) drives
  a radiogroup pill control in both `ChatPage` and `FleetyChatWidget`; both send the selected mode.
- **Coach consolidation:** `fleety-review` now fetches material via the shared `fetchMaterialText`
  (Figma-aware), removing the drift where it used its own plain fetch.

## Alternatives considered

- **A form + SPF target picker** calling `fleety-review`: richer (explicit target expectations) but
  needs a new member-facing SPF read path (this app has none) and is heavier UX. Rejected in favor of
  the owner's mode-switch shape; the target-locked coach remains available for a later enhancement.

## Consequences / security (owasp-secure-coding-bdd)

- `mode` is new untrusted input, but constrained to a 3-value enum server-side; unknown values 400.
- No change to auth, rate limiting, per-user quota, or the cost guard — modes ride the same gates.
- Mode contracts are **additive** to (never override) the base STRICT SCOPE + safety rules, so a
  mode cannot be used to escape Fleety's Tech-Fleet-only scope or reveal the system prompt.
- Material under review stays framed as untrusted data (prompt-injection defense), unchanged.
- Cache bypass on non-chat modes prevents cross-mode cache poisoning / stale replay.
- `@security` scenarios: `techfleet-chat/fleety-modes.feature`.

## Release safety (release-deployment-safety)

Additive and backward compatible: older clients omit `mode` → `chat` → unchanged behavior. No env,
no migration, no schema change. Rollback = revert the PR + redeploy; the UI degrades to Chat-only.
Observability: `mode` is available to per-turn logging alongside `intent`/`practical`.
