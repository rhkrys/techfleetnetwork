# 0009 — Fleety unified brain: internal-call seam for Discord /fleety (Fleety 2.1)

- Status: accepted
- Date: 2026-08-18
- Deciders: owner (mdenner), Claude
- Related: #232 (Fleety 2.0), #233 (Discord formatting), ADR-0005 (LLM capability port)

## Context

Fleety exists on two surfaces with **two different brains**. The web app (`techfleet-chat`)
is Fleety 2.0: DeepSeek answer model, the full weighted SPF relationship-graph retrieval,
grounding, determinism/caches, PII redaction, real public source links. The Discord `/fleety`
bot (`discord-interactions`) is the legacy brain: it dumps the whole `knowledge_base` into a
`google/gemini-3-flash-preview` call via the Lovable gateway with a hand-rolled system prompt and
only a thin regex injection check — no graph, no grounding, weaker safety, and (post-cutover) it
depends on `LOVABLE_API_KEY`, which is unset on the owned project.

We want one Fleety: Discord should answer with the exact 2.0 brain.

The obstacle is the interface. `techfleet-chat` was built for the browser: it requires an
**end-user JWT** (`auth.getUser()`), returns a **streamed SSE**, and meters a **per-user** quota.
A Discord bot is a trusted server-to-server caller with no Supabase user.

## Decision

Add a **trusted internal-caller seam** to `techfleet-chat` and make `discord-interactions` a thin
adapter that delegates to it.

- Auth becomes "valid end-user JWT **OR** a constant-time-verified `x-fleety-internal` shared
  secret" (`_shared/internal-auth.ts`, fail-closed, unit-tested). Internal turns run as a synthetic,
  non-personal system id — no `auth.users` row, no profile/roster context, never elevated.
- The **streaming/answer path is unchanged**; internal callers consume the same SSE. Only the
  per-**user** soft quota is skipped for internal turns; the **global** system rate-limit +
  cost-guard still bind them.
- `discord-interactions` deletes its Gemini/Lovable code and instead POSTs the question to
  `techfleet-chat` (fixed env-derived URL; service-role bearer for the gateway + the internal
  secret), consumes the SSE into one string, reads `X-Fleety-Sources` for the citation block, then
  applies the existing question-echo + PII/output sanitize + Discord chunking. A per-Discord-user
  rate limit bounds abuse before any 2.0 call.
- Config: `FLEETY_INTERNAL_SECRET` (≥32 chars) on the project; `LOVABLE_API_KEY` no longer needed
  by Discord. The Discord Interactions Endpoint URL is repointed to the owned project last.

## Consequences

**Positive:** one brain, one prompt, one safety posture; Discord inherits DeepSeek + SPF graph +
grounding + real links for free; the legacy Lovable dependency and the weaker Discord injection
gate are retired (a security upgrade); the seam is reusable for future server-to-server callers.

**Negative / risks:** a new trust boundary (a shared secret) — mitigated by constant-time compare,
a ≥32-char fail-closed floor, no-logging, and defense-in-depth (service-role bearer at the gateway).
Shared budget is now consumed by Discord too — mitigated by the retained global cost-guard +
system rate-limit and a per-Discord-user limit. Secret rotation is a single env var both functions
read (atomic per project).

## Alternatives considered

1. **Set `LOVABLE_API_KEY` and keep the legacy Discord brain.** Rejected — entrenches two brains
   and the weaker path; the opposite of the goal.
2. **Extract the whole 2.0 answer core into a shared module both functions import.** Rejected for
   now — `techfleet-chat` is tightly coupled to streaming/caches/cost-guard; a clean extraction is a
   large refactor with more regression surface than the thin internal-call seam.
3. **A persistent gateway bot for @mention.** Out of scope (owner deferred @mention); would need an
   always-on host + Message Content privileged intent.

## Security

Threat model + `@security` scenarios: `supabase/functions/discord-interactions/fleety-2.1-discord.feature`.
Seam unit tests: `supabase/functions/_shared/internal-auth.test.ts`.
