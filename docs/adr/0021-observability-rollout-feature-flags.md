# ADR 0021 — Observability rollout: feature flags + a gated error-reporting ramp

- Status: Accepted
- Date: 2026-08-27
- Deciders: TechFleet (owner)
- Related: `supabase/migrations/20260827120000_feature_flags.sql`, `src/services/feature-flags.service.ts`, `src/hooks/use-feature-flag.ts`, `supabase/functions/_shared/feature-flags.ts`; the ramp target `src/services/logger.service.ts` + `src/services/error-reporter.service.ts`; the existing throttle it complements (`audit_event_policy`, `get_audit_policy()`, `system_health_state.metadata.audit_pressure`, `_shared/audit.ts`); ADR-0019 (arch gate), ADR-0020 (migration-applied gate — verifies this table reaches prod). Redaction findings audit-2026-08/findings.md:2227 (High), :2232 (Med). Phase 0b of `docs/architecture/audit-2026-08/hardening-plan.md`.

## Context

Phase 0b was scoped in the hardening plan as "before global error reporting flips on for 767 users, build report sampling, loop-guards, a rollout flag, and page-vs-log triage." A deep read of the reporting internals changed that scope: **most of it already exists and is mature.**

- **Sampling / dedup / pressure — already built.** Client `error-reporter.service.ts` (60s dedup, 10/min cap, 0.1–1× pressure multiplier, overflow aggregation, fingerprint normalization); edge `_shared/audit.ts` (30/min + 30s dedup); `logger.service.ts` (5/key/10s). Runtime-tunable via `audit_event_policy` + `get_audit_policy()` + `system_health_state.metadata.audit_pressure`.
- **Loop-guards — already built.** Every telemetry write is wrapped "must never throw"; `NON_ACTIONABLE_EVENT_TYPES` blocks recursive re-entry.
- **Page-vs-log triage — already built.** `audit_log` is a deliberately narrow failure-only ledger (chatty CRUD triggers were dropped); only `agent_fix_queue` severity=error pages admins (capped 3/hr); CI failures page Discord.

What is **actually** missing / blocking:

1. **No rollout flag and no true kill-switch.** `audit_pressure` only dampens to 10%; it cannot target a cohort or fully stop a behavior. There is no feature-flag mechanism at all (no table, hook, or env toggle).
2. **`logger.error(...)` is console-only** (`logger.service.ts:125`) — the hundreds of service catch-blocks that use it never reach `audit_log`. Wiring it to the reporter clears most of the 265 error-handling findings, but it is the **one** change that introduces real new write volume across 767 users.
3. **A redaction defect blocks the ramp.** `error-reporter` writes raw messages/stacks to `audit_log` with no redaction despite claiming otherwise (finding :2227, High; logger :2232, Med). Ramping `logger.error → report` before fixing this would write **unredacted PII** at volume.

## Decision

1. **Build a feature-flag mechanism** — `public.feature_flags` (a single-owner table: `enabled` kill-switch + `rollout_percent` dial, admin-managed RLS mirroring `audit_event_policy`), an anon-readable `get_feature_flags()` accessor (SECURITY DEFINER with an **explicit** `REVOKE … FROM PUBLIC` + `GRANT EXECUTE TO anon, authenticated` — never the implicit PUBLIC grant that advisor 0028/0029 flags; this deliberately diverges from `get_audit_policy()`, which is authenticated-only, because flags are non-secret and the signed-out reporter must read them), a client service + `useFeatureFlag` hook, and an edge `_shared/feature-flags.ts` helper. **Safe default is OFF**: a missing/failed/unloaded flag resolves to `false`, so a flag can only ever _enable_ new behavior. Per-user bucketing is deterministic (a user stays in/out as the dial moves).
2. **Reuse, do not rebuild, the existing guards.** The sampling/dedup/pressure/loop-guard/triage above are verified in place and are the sampling+loop-guard+page-vs-log design 0b called for; the new `logger` volume flows through them.
3. **Gate the volume change.** Wire `logger.emit()` error-level → the reporter **only behind** `logger_error_reporting`, and **only after** the redaction fixes (:2227/:2232) land. Ramp 0 → 10 → 50 → 100 by an admin editing the flag — no deploy. `enabled=false` is the instant kill-switch; `audit_pressure` remains the emergency global dampener beneath it.
4. **Make "risky rollout ⇒ behind a flag" a gate-checked convention** (via `arch-encode`), so new risky behavior can't merge unflagged — the same "encode the rule, let the gate enforce it" pattern as ADR-0019/0020.

## Rollout

Staged, reversible PRs (Phase 0b):

- **(A) Mechanism — this PR.** Table + RPC + client service/hook + edge helper + tests. Seeded flag `logger_error_reporting` is OFF, so merging changes nothing at runtime. ADR-0020's migration-applied gate will confirm the table actually reaches prod.
- **(B) Redaction fix.** Redact messages/`extraFields` in `error-reporter` and the free-text `message` in `logger` before any write; failing test first.
- **(C) Gated ramp.** `logger.error → report` behind `logger_error_reporting`; boot loads the flag snapshot; ramp via the dial.
- **(D) Cleanup + convention.** Finish `withAuditWrapper` on the ~41 unwrapped edge functions; add the flag-required gate rule; record guard verification.

## Consequences

- **Positive:** the volume change ships behind a dial + true kill-switch, ramped and instantly reversible; flags have one owner (clean data ownership); the mechanism is reusable for every future risky rollout; the mature existing guards are kept, not duplicated (anti-drift). PII risk is removed _before_ the ramp, not after.
- **Negative / trade-offs:** a new table and a hand-added `types.ts` entry (until the next Supabase type codegen). The sync `isFeatureEnabled()` reads a cached snapshot, so a ramp/kill is eventually-consistent on the client (~1 min) — acceptable for telemetry; the edge helper reads live. The bucket hash is duplicated client/edge by necessity (separate runtimes), covered by matching tests.
