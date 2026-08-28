# TechFleet Hardening Plan (v2)

Remediation of all **837** verified architecture findings from the 2026‑08 audit (current `main`),
sequenced from critical to tidy‑up, with every fix proven before it ships. This v2 folds in an
adversarial re‑review of v1 (see "What changed from v1").

- **Companion docs:** `findings.md` (all 837), `findings-high.md` (179 High), `README.md` (index);
  interactive report + plain‑English guide linked in the README. Foundational decision: `docs/adr/0019-architecture-gate.md`.
- **Skills:** every PR runs its finding‑type skills (matrix below) + `judge-arch` review; decisions recorded as ADRs (0010+).

## The two "done" signals (both land this release)
1. `arch-gate.waivers.json` → **0** — the ~313 *structural* findings, proven green by the gate.
2. All **837** audit findings **resolved** — including the ~265 error‑handling + one‑off logic bugs, proven by tests. *Resolved = fixed **or** dismissed-with-rationale (see triage).*

## The strategy
**Fix patterns, not items — but do both.** A handful of repeating habits generate most findings.
A few central changes clear whole batches (Category ①); the rest need the pattern built **and**
every instance migrated (Category ②); a minority are one‑offs (③). The gate blocks *new* drift
while we burn down the old, so we move fast without regressing.

| Category | Meaning | Examples | ~Count | Tooling |
|---|---|---|---|---|
| ① Fix‑once | one shared runtime path → one change fixes all | `logger→reportError`, RQ global `onError`, `withAuditWrapper` | slice of 265 error‑handling | hand (small) |
| ② Pattern + every instance | build target + gate rule, then migrate each site | UI→DB 135, raw‑invoke 43, edge auth ~96+31, inline CORS ~90 | ~500 | **codemods** |
| ③ One‑off | unique bug, no shared pattern | ThirdSteps revert, specific ownership | remainder | hand |

## Credit protection: triage before fixing (the false‑positive gate)
The audit already adversarially verified findings, so **752 are CONFIRMED (172 High / 381 Med / 199 Low)**
and only **85 are PLAUSIBLE (7 High / 49 Med / 29 Low)**. We do **not** blind‑fix 837:

1. **CONFIRMED (752)** → high confidence; go straight to the fix flow.
2. **PLAUSIBLE (85)** → a cheap **verify‑or‑dismiss** pass *before* any fix effort. The filter is the
   test: if you cannot write a test that **fails** on the current code, the finding is **not a real
   bug** → close it as **"verified correct"** with a one‑line rationale (recorded in the findings
   tracker; a gate‑relevant one becomes a permanent waiver with `reason`). No wasted fix.
3. **Batch dismissals** — PLAUSIBLE findings cluster by pattern; if one instance is a false positive,
   its siblings usually are too → dismiss the batch in one pass.

**"Resolve all 837" ≠ "change 837 files."** Some resolutions are dismissals. This is what stops us
burning credits (and risking new bugs) fixing code that was already correct.

## The error‑handling category, fixed at the plumbing (not 265 UI edits)
The biggest group is fixed at ~4 central chokepoints, guarded by the SRE rollout work in Phase 0:
- `logger.emit` forwards `error`‑level to `reportError` — one file, hundreds of existing catches now report.
- Flip `no-raw-functions-invoke` / `no-legacy-email-send` lint rules `warn`→`error`; route the 43 raw calls through `invokeEdge` (reports + retries).
- React Query's global `onError` already reports — moving UI data into hooks/services makes failures auto‑report.
- Extend `withAuditWrapper` to the ~40 edge functions missing it.

---

## The phases

### Phase 0 — Foundations (do BEFORE any fixing)
De‑risks everything after. None of the later phases are safe without these.
- **0a · Migrations into CI.** DB migrations are hand‑applied (`supabase db push`) and *not* CI‑verified — the cause of the Discord PGRST202 outage. Add a **migration‑applied verification gate** (assert every committed migration is applied to the target; fail CI otherwise) + pgTAP proof runs. *No ownership/RLS fix ships until this exists — otherwise a "fixed" migration can silently never reach prod.* Skills: `release-deployment-safety`, `compliance-data-lifecycle`, `comprehensive-test-strategy`. ADR‑0010.
- **0b · Observability rollout design (SRE).** Before global reporting flips on for 767 users: **report sampling** (don't write `audit_log` on every failure), **loop‑guards** (the reporter must never report its own failures → storm), a **rollout flag** (ramp, instant off), and a **page‑vs‑log triage** — define which failures page a human vs just log, with SLOs/thresholds so we don't create alert fatigue. Skills: `sre-operational-readiness`. ADR‑0011.
- **0c · Codemod toolkit.** Stand up `ts-morph`/`jscodeshift` with transforms for the Category‑② mechanical migrations (UI→service, raw‑invoke→wrapper, inline‑CORS→shared helpers). Each codemod is reviewed once, then applied consistently across hundreds of sites; the gate + tests verify the result. Skills: `enterprise-architecture-standards`, `comprehensive-test-strategy`.
- **0d · Infra prerequisites.** Confirm (or build) a **feature‑flag mechanism** and an **expand/contract migration convention** — both are assumed by later phases; build them if absent. Skills: `release-deployment-safety`.
- **0e · Triage the 85 PLAUSIBLE.** Verify‑or‑dismiss pass (above); produces the real fix backlog and records dismissals. Cheap, and it protects the whole budget.

### Phase 1 — Central plumbing (the fix‑once wins) — *guarded by 0b*
`logger→reportError`, flip the lint rules (staged: clear in‑flight raw‑invoke sites first so we don't block the team overnight), React‑Query global `onError`, extend `withAuditWrapper`. Clears most of the 265 error‑handling findings at the source. Skills: `sre-operational-readiness`, `comprehensive-test-strategy`, `bdd-comprehensive-testing`, `arch-encode`.

### Phase 2 — Security (High) — OWASP
Route all `profiles` writes through `ProfileService` (codemod where mechanical); converge the ~96 `SERVICE_ROLE_KEY` / 31 raw `user_roles` checks onto `_shared/request-auth` + `getAdminClient`; fix CORS preflight drift. Proven by `@security` Gherkin + new gate rules. **Excludes frozen‑auth files → Phase 2‑AUTH.** Skills: `owasp-secure-coding-bdd`, `comprehensive-test-strategy`, `release-deployment-safety`, `architectural-decision-records`, `arch-encode`.

### Phase 2‑AUTH — Auth special track (frozen area, highest care)
The auth‑feature / edge‑auth / MFA / route‑guard High findings touch the frozen layer
(`06-auth-flow-lockdown`). Non‑negotiable proof plan for **every** auth PR:
1. **Full auth regression suite green before and after** (mandatory gate — no merge without it).
2. **Owner‑gated** — explicit human sign‑off on the diff (not agent‑autonomous).
3. **Contract tests** — exercise the auth feature's existing `ports`/`adapters` contract suite; a fix must keep every port contract green.
4. **pgTAP** for any auth RLS / `SECURITY DEFINER` change (privilege‑escalation check).
5. **Feature‑flagged rollout** with instant rollback; one auth concern per PR (smallest blast radius).
6. `owasp-secure-coding-bdd` + `judge-arch` on each. ADR per change.
Runs in parallel with Phase 2 but on its own slower, gated cadence. Skills: `owasp-secure-coding-bdd`, `comprehensive-test-strategy`, `release-deployment-safety`, `architectural-decision-records`.

### Phase 3 — Boundary & ownership (High)
Extract `project`/`client`/`user-admin`/`storage`/`edge` services; **codemod** the 135 UI→DB sites through hooks/services (auto‑fixes many error‑handling findings via React Query). Single‑writer ownership fixes (`freescout_customer_id`, Discord identity, network‑stats RPC) as **expand/contract migrations** — now safe because 0a verifies they're applied. ADR per fact's owner; pgTAP for RLS. Skills: `enterprise-architecture-standards`, `compliance-data-lifecycle`, `release-deployment-safety`, `architectural-decision-records`, `bdd-comprehensive-testing`, `judge-arch`.

### Phase 4 — Edge consolidation
**Codemod** inline CORS/response/client → `_shared` helpers across the ~90 functions; de‑twin `promote-*`/`confirm-*`; unify the two email pipelines + one DLQ replayer; pin one `supabase-js`/zod. Proven by `deno-check` + new gate rules. Skills: `enterprise-architecture-standards`, `comprehensive-test-strategy`, `release-deployment-safety`, `sre-operational-readiness`, `arch-encode`.

### Phase 5 — Medium (430)
Worked in ~12–16 batches. **Mixed batching:** pattern‑batches (codemod, across files) *and* file‑holistic batches for hot files (e.g. `ProjectFormPage`, which has boundary + error‑handling + `as any` findings — fix it once, completely, rather than re‑touching it in three phases → fewer conflicts, one review). Each batch removes its waivers. Skills: `enterprise-architecture-standards`, `owasp-secure-coding-bdd`, `comprehensive-test-strategy`, `compliance-data-lifecycle`, `universal-accessibility-wcag`, `judge-arch`.

### Phase 6 — Low & hygiene (228)
Burn down `as any` (start `ProjectFormPage` ×29), delete `main.tsx` boot band‑aids as their real fixes land, collapse single‑use abstractions, finish `t()`, and the small **perf** items surfaced (e.g. the unfiltered realtime‑invalidation storm). Skills: `enterprise-architecture-standards`, `comprehensive-test-strategy`, `universal-browser-device-support`, `usability-ux-universal-design`, `judge-arch`.

### Phase 7 — Release hardening & exit
Big refactors add debt while removing it, so we prove the end state:
- **Final full `judge-arch` re‑audit on `main`** — confirm the refactor introduced **no new** findings.
- **Full regression** (unit + e2e) + **security re‑scan** (`security-owasp`) + **`arch-gate.waivers.json` = 0** verified.
- **Out‑of‑scope, named explicitly** (not silently assumed done): a **performance/scale** deep‑dive and an **accessibility / UX / browser‑support** audit are separate future passes — this release covers the 837 *architecture* findings only.

---

## Which enterprise skill builds each fix
| Finding type | Skills |
|---|---|
| Security (auth, input, permissions) | `owasp-secure-coding-bdd` + `comprehensive-test-strategy` + `bdd-comprehensive-testing` |
| Error handling / observability | `sre-operational-readiness` + `comprehensive-test-strategy` |
| Data ownership (mirrors, migrations, PII) | `compliance-data-lifecycle` + `release-deployment-safety` + `architectural-decision-records` |
| Boundary / dependency / structure | `enterprise-architecture-standards` + `judge-arch` + `arch-encode` |
| Any UI change | `universal-accessibility-wcag` + `usability-ux-universal-design` + `universal-browser-device-support` |
| Every PR | `bdd-comprehensive-testing` (proof) · `release-deployment-safety` (safe ship) · `judge-arch` (review) · `arch-encode` (recurring fix → permanent rule) |

## How every push is proven
- **Structural fix** → fix it, delete its `waivers.json` line → **arch‑gate green**.
- **Behavior fix** → **failing test first**, then fix → test passes.
- **False positive** → can't write a failing test → **dismiss with rationale** (recorded).
Every architecturally‑significant decision → an **ADR** (0010+). Ship via small, reversible, flagged PRs; expand/contract for data; the gate + tests are the guardrail.

## What changed from v1 (the adversarial re‑review)
1. **New Phase 0 Foundations** — migrations‑in‑CI (the known outage risk), SRE reporting‑rollout design (sampling/loop‑guards/flag/alert‑triage), codemod toolkit, infra prerequisites, PLAUSIBLE triage — all *before* fixing.
2. **Auth special track** (Phase 2‑AUTH) for the frozen layer.
3. **Codemods** for the ~500 mechanical migrations (was hand‑migration).
4. **Explicit false‑positive triage** (752 CONFIRMED vs 85 PLAUSIBLE) so credits go only to real bugs.
5. **Mixed file/pattern batching** to stop re‑touching hot files across phases.
6. **Phase 7 exit criteria** + a final re‑audit; **perf and a11y named out‑of‑scope**, not assumed.
