# ADR-0019: Blocking architecture gate (the four questions) with baselined debt

- **Status:** Accepted (2026-08-27)
- **Renumbered:** originally landed as ADR-0009, which collided with the existing `0009-fleety-unified-brain-internal-call-seam.md`; renumbered to 0019 and now guarded by `scripts/ci/check-adr-number-collision.mjs`.
- **Related:** `.github/workflows/ci.yml` (the required `gate`), `scripts/ci/arch-gate.mjs`, `arch-gate.config.json`, `arch-gate.waivers.json`, `decisions.md`, `.claude/skills/{judge-arch,arch-encode}`, `docs/architecture/audit-2026-08/`, ADR-0008 (sibling OWASP gate), ADR-0020 (migration-applied gate — first follow-on fix). Standard sourced from `techfleetworks/enterprise-software-AI-skills`. PRs techfleetnetwork#297 (adoption), #298 (made blocking).

## Context

Agents (and people under deadline) produce working code but make silent *structural* decisions. Unlike bugs, bad architecture doesn't announce itself — tests stay green, the feature works, and the cost arrives months later as "every fix breaks something else." TFN grew fast (~1,000 `src` files, ~130 edge functions) and accumulated recurring structural habits: UI reaching straight into the database, edge functions hand-rolling their own auth/CORS, failures that never reach operators, and facts mirrored in two places that drift. No mechanical check caught any of this; it only surfaced in code review, inconsistently. Approach adapted from the certificates.dev / TechFleet workshop *"Who's Designing Your System? You, or Your Agent?"* (https://www.youtube.com/live/b-Pom28zv7M).

## Decision

Adopt a **blocking architecture gate** with two halves — a mechanical check and a review — mirroring how ADR-0008 gates OWASP.

1. **Mechanical.** `scripts/ci/arch-gate.mjs` (dependency-free, Node built-ins only) checks structural rules declared in `arch-gate.config.json`: UI must not access the database directly; services must not import UI / touch web globals; exactly one Supabase client; edge functions must compose `_shared` for auth (no `SERVICE_ROLE_KEY` / raw `user_roles` in handlers) and for CORS/response; and duplicated-fact ("keep in sync") markers. Wired as `check:architecture` and as the `arch-gate` job folded into the required `ci / gate` aggregator (#298), so a new violation blocks merge → deploy. The `emptyCatch`/`swallowReturn` built-ins are **off**: TFN's documented graceful-degradation catches are a judgment call, delegated to the review.
2. **Review.** The `judge-arch` skill runs a change's diff through the **four questions** — boundary placement, data ownership, dependency direction, error handling — in fresh context, reporting findings (not fixes).
3. **Rules live in the repo.** Standing rules with ✅/❌ examples in `decisions.md`; scoped `CLAUDE.md` in `src/components`, `src/services`, `supabase/functions`; a newly-caught recurring pattern is encoded into a gate rule via the `arch-encode` skill.
4. **Ratchet, not big-bang.** `arch-gate.waivers.json` grandfathers the **313** pre-existing violations (across 220 files) so the gate is green today while blocking *new* drift. The waiver file shrinking to zero tracks the structural cleanup.

The standard is sourced from the org repo `techfleetworks/enterprise-software-AI-skills`; TFN is reference implementation #1.

## Rollout

"Ratchet + observe, then block" (owner decision). Landed additively as a standalone workflow (#297), baselined, and verified green on a real PR; then the job was folded into the required `gate` (#298) so it blocks merge. The only bypass is a dated, attributed waiver — never a self-declared "trivial."

## Consequences

- **Positive:** new structural drift cannot merge; the existing debt is enumerated and burning down (waivers → 0); the standard is shared org-wide and vendor-neutral; pairs with ADR-0008 under one required `gate`.
- **Negative / trade-offs:** `arch-gate` is now a merge blocker. The mechanical gate covers only greppable rules — error-handling and one-off logic issues are proven by tests, not the gate, so "waivers → 0" clears the structural debt but not the whole audit. The waiver file needs upkeep as debt is cleared, which is the point.
- **Follow-on:** a full architectural audit (2026-08, see `docs/architecture/audit-2026-08/`) found **837** verified findings now being remediated per the hardening plan there; each significant fix lands its own ADR (starting with ADR-0020, the migration-applied gate).
