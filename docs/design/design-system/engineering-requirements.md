# TFDS Engineering Requirements (skills-derived)

These are the engineering requirements the TFDS migration must meet, derived from the six engineering
skills and **right-sized** for a front-end design-system layer (no new runtime service, no personal data).
Each requirement is a checkbox in the [Definition of Done](#definition-of-done). Where a skill has little or
no surface here, it is marked **N/A with a reason** rather than performed as theater (per the SPF
engineering-skills governance rule: right-size, don't over-engineer).

## 1. Enterprise architecture standards → requirements

- **R-A1 Layering.** Code lives in `src/design-system/{theme,components/{atoms,molecules,organisms},provider}`;
  the dependency rule (pages→templates→organisms→molecules→atoms→theme) is never inverted.
- **R-A2 Single import surface.** The app imports UI only from `@/design-system`. Enforced by ESLint
  `no-restricted-imports` banning `@mui/material*` (and `@/components/ui/*` once retired) outside the layer.
- **R-A3 ADR.** Every load-bearing decision is recorded — [ADR 0015](../../adr/0015-mui-owned-design-system-layer.md)
  covers the top-level choice; material sub-decisions (e.g. token-bridge strategy) are appended or get their own ADR.
- **R-A4 Coding principles.** Wrappers stay thin (SOLID/DRY/KISS); no speculative abstraction. A wrapper that
  only re-exports a MUI component with theme defaults is preferred over a bespoke re-implementation.
- **R-A5 No over-engineering.** No message bus, no micro-frontends, no runtime theme service. The theme is a
  static object; brand traits are `styleOverrides`.

## 2. Comprehensive test strategy → requirements

- **R-T1 Unit tests (Vitest + Testing Library).** Every atom/molecule/organism we build or wrap has unit tests
  asserting: each variant renders, each interactive state (hover/disabled/error/loading) behaves, `ref`
  forwarding, and prop pass-through. Lowest level that catches the bug.
- **R-T2 Visual regression (Playwright).** The real risk in a theming migration is _visual_ drift. Every built
  component gets a story on the **DS showcase page** captured by the existing `npm run test:visual`
  (`e2e/visual`, `PLAYWRIGHT_VISUAL=1`) in **both light and dark**. A migrated page gets a before/after snapshot.
- **R-T3 Accessibility.** `eslint-plugin-jsx-a11y` stays green; the showcase page is scanned with the existing
  `@axe-core/playwright` harness — no new serious/critical violations vs the shadcn baseline.
- **R-T4 Coverage gate.** Changed code under `src/design-system/**` meets the repo coverage threshold; new
  components are not merged with 0% coverage.
- **R-T5 Flaky hygiene.** No knowingly-flaky test is added; visual snapshots are deterministic (fonts loaded,
  animations disabled in the snapshot config).
- **N/A — contract testing:** no service boundary or API contract is introduced (pure client UI).
- **N/A — load / stress / soak / spike:** no server hot path. Client perf is covered by R-S1 (bundle budget).
- **N/A — chaos/fault injection:** no runtime dependency to fail.

## 3. BDD comprehensive testing → requirements (right-sized)

The repo tests with **Vitest + Playwright**, not Cucumber. Rather than stand up a parallel Gherkin runner for
pure UI (which would be over-engineering), behavior scenarios are:

- **R-B1 Enumerated per component** in its component doc (`components/<layer>/<Name>.md`): happy path (default
  render), plus non-happy states — disabled, error/invalid, loading, empty, long-content/overflow, RTL if
  applicable, keyboard-only interaction.
- **R-B2 Implemented as named tests** — each scenario maps to a Vitest/Playwright test whose name reads as the
  behavior ("Button renders the `hero` variant with asymmetric radius", "TextField shows helperText and
  `aria-invalid` when in error"). Given/When/Then phrasing in the test body where it aids clarity.
- **R-B3 Bug-as-scenario.** Any bug found during migration becomes a regression test so it can't return.
- If a future component _does_ introduce real business logic (unlikely for UI), it gets full Gherkin per the
  BDD skill. Flag it then.

## 4. Release & deployment safety → requirements

- **R-R1 Dark launch / additive.** Phase 0 adds the DS layer + a showcase route only; **shadcn/Tailwind are
  untouched**. Nothing user-facing changes until a page is deliberately migrated.
- **R-R2 Backward-compatible coexistence (expand/contract).** MUI and shadcn run side-by-side; a shadcn
  component + its band-aid CSS (e.g. the `.tf-card` global retrofit) is deleted only in the same phase it is
  fully replaced (the "contract" step).
- **R-R3 Feature-flaggable page migrations.** From Phase 3 on, a migrated page/area is switchable
  old↔new (route-level flag or env), so a bad migration is a flip, not a redeploy.
- **R-R4 Reversible per phase.** Every phase can be reverted in minutes (revert the area's imports; the shadcn
  component still exists until its delete step). No destructive change.
- **R-R5 No DB/data migration.** This work touches no schema or data — the highest-risk deploy class is absent
  by construction.
- **R-R6 Release-safety scenarios.** Add `@release-safety`-style tests proving coexistence: a page importing
  both a MUI atom and a shadcn atom renders correctly; the theme mode-bridge follows the app's light/dark.
- **R-R7 Auth last.** Auth sign-in/up/reset/MFA UI migrates in the final phase only, with the full auth
  regression suite green (per `06-auth-flow-lockdown`).

## 5. OWASP secure coding & supply chain → requirements (light-touch)

- **R-O1 Supply chain.** New deps (`@mui/material`, `@emotion/react`, `@emotion/styled`, `@mui/icons-material`)
  are **version-pinned**; `npm audit` (and the repo's `npm run sbom` / `audit:signatures`) show no new
  high/critical advisories introduced. `eslint-plugin-security` stays green.
- **R-O2 No unsafe rendering.** No `dangerouslySetInnerHTML` in DS components; user content renders through
  React escaping. Any rich-text surface continues to sanitize via the existing `dompurify`.
- **R-O3 No secrets / no data.** DS components handle no credentials, tokens, or PII.
- **N/A — Step 0 lockout/deletion check:** Phase 0–N add no permission/credential/deletion change. Re-evaluate
  only if a migrated admin surface changes an access control (it won't — UI-only swaps).

## 6. SRE operational readiness → requirements (right-sized)

- **R-S1 Bundle budget.** The existing `size-limit` budgets (**350 KB** main gz, **1600 KB** total initial gz)
  **must stay green**. MUI/Emotion are added tree-shaken (named imports, `@mui/icons-material` per-icon
  imports); the bundle delta is measured at Phase 0 and again after teardown (removing Tailwind + ~35 Radix
  packages should offset much of it). If a phase would breach the budget, it doesn't ship until addressed.
- **N/A — SLIs/SLOs/alerts/on-call/runbooks:** no new runtime service or failure mode to operate.

## 7. Compliance & data lifecycle → N/A

- A design-system layer stores/transmits **no personal or regulated data**. No consent, retention, DSAR, or
  audit-log surface is introduced. (Consistent with the app's standing "public/non-personal data" posture.)

## Definition of Done

**Per component** (built or wrapped):

- [ ] Lives in the correct atomic folder; imported only via `@/design-system` (R-A1/A2)
- [ ] Thin wrapper, no over-engineering (R-A4/A5)
- [ ] Unit tests: all variants + states + ref/props (R-T1, R-B1/B2)
- [ ] Visual-regression story on the showcase page, light + dark (R-T2)
- [ ] a11y: jsx-a11y green, no new axe serious/critical (R-T3)
- [ ] Coverage gate met (R-T4)
- [ ] Component doc written (API, deviation-from-stock-MUI, replaces, usage) — same PR (docs-as-deliverable)
- [ ] Build-log row in the README flipped to `done`

**Per phase:**

- [ ] `npm run test`, typecheck, `npm run lint` all green; no new warnings (repo DoD)
- [ ] `npm run size` within budget (R-S1)
- [ ] `npm audit` / SBOM clean for any new deps (R-O1)
- [ ] Reversible; shadcn band-aids deleted only for fully-replaced components (R-R2/R4)
- [ ] ADR/spec updated if a decision changed
- [ ] Summary: cause → change → proof (repo DoD)
