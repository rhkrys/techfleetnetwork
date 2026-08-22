# ADR 0015 — TechFleet Design System as an owned layer on MUI Core

- Status: Proposed
- Date: 2026-08-22
- Deciders: TechFleet (owner)
- Related: `components.json` (shadcn config, to be retired), `tailwind.config.ts` + `src/index.css` (token source), `src/components/ThemeProvider.tsx` (light/dark source of truth, retained), `docs/brand/brand-identity-guide.md`, `06-auth-flow-lockdown.skill.md` (auth UI migrates last), `docs/design/design-system/` (spec + audit)

## Context

The app's UI is built on **shadcn/ui (63 files in `src/components/ui/`) on Radix primitives + Tailwind**, consumed by **231 files across ~758 import sites** (~60% of `.tsx` files). The owner wants a **single component library that is consistently used and centrally customizable**, driven by four goals: inconsistent UI today, missing components, faster building, and better docs/governance. The chosen library is **Material UI Community (MUI Core), which is MIT-licensed and free**; the paid **MUI X** (Data Grid Pro, range pickers, advanced charts) is explicitly **out of scope** — AG Grid stays for all tables and recharts for charts.

Two findings shape the decision (evidence in `docs/design/design-system/component-audit.md`):

1. **The current components are a heavy custom brand skin, not stock shadcn.** `Button` has 9 variants (incl. `hero`/`hero-outline`/`success`) and a signature **asymmetric corner radius**; `Card` is a bespoke `.tf-card` with 40px asymmetric radius and inset-glow shadows and Futura headings.
2. **The brand is encoded in Tailwind utility classes and global attribute-selector CSS.** `src/index.css` contains a global auto-retrofit rule that rewrites any element with `bg-card`/`rounded-*` Tailwind classes into a `.tf-card`, plus `--tf-btn-*` variables and validation-state selectors. **None of this applies to MUI-rendered markup**, because MUI does not emit those Tailwind classes.

Therefore the migration is not a component find-and-replace; it is **re-expressing the Tech Fleet brand from "Tailwind classes + global CSS" into an MUI theme object** (`styleOverrides` + custom variants via module augmentation), consumed through one owned layer.

The owner initially asked to **fork the MUI Community repository**. A literal source fork means owning ~100k+ lines of MUI/Emotion internals and manually merging every upstream security and bug fix in perpetuity — a maintenance burden that works against "faster building" and "consistency." The MIT license permits it, but it is the wrong tool for the stated goals.

## Decision

Adopt MUI Core as a **pinned dependency** and build the **TechFleet Design System (TFDS)** as an **owned layer in this repo** — not a fork. Concretely:

- New directory **`src/design-system/`** is the only module the app imports UI from (barrel export `@/design-system`). It contains: the MUI `theme/`, owned component wrappers, and the handful of custom components MUI lacks.
- **The brand is centralized in one MUI theme.** The theme references the **existing HSL CSS variables in `src/index.css`** (e.g. `palette.primary.main = 'hsl(var(--primary))'`) so `index.css` remains the single source of truth for color and light/dark switching keeps working through the `.dark` class cascade. Signature traits (asymmetric radii, `--tf-btn-*` shadows, disabled ripple, the 9 button variants, the type scale) live in `theme.components.*` `styleOverrides` and custom `variants`, with TypeScript module augmentation for the custom variant names.
- **Missing components are built by us, in the same owned layer** (no MUI X, no Pro). The genuine build-ourselves set is small (~6–7 custom composites); most current primitives map 1:1 to MUI Core.
- **AG Grid, recharts, cmdk, embla, react-day-picker, input-otp, react-hook-form + zod are retained** — they are not MUI's domain and are not replaced.
- **Migration is phased and additive**, MUI coexisting with shadcn/Tailwind during transition; auth sign-in/up/reset/MFA UI migrates **last**, only with the full auth regression suite green (per `06-auth-flow-lockdown`). Each shadcn component and its band-aid CSS (e.g. the `.tf-card` global retrofit) is **deleted in the same phase** it is fully replaced.
- **Governance:** an ESLint `no-restricted-imports` rule bans importing `@mui/material` (and `@/components/ui/*`, once retired) outside `src/design-system/`, making "one consistent library" enforceable in CI rather than by discipline.

The system is documented and versioned in this repo as **"TechFleet Design System, built on MUI Core"** — owned API, owned theme, owned custom components — which delivers the owner's intent ("make it our own, in our GitHub, documented, build missing pieces ourselves") **without** the fork's maintenance cost.

## Alternatives considered

- **Literal git fork of `mui/material-ui`.** Rejected: permanent maintenance tax (manual upstream merges for every security/bug fix), directly opposes the speed/consistency goals. Only justified if we needed to modify MUI internals, which we do not — theming covers every brand requirement.
- **Theme-only, import MUI directly across the app.** Rejected: weakest governance, no owned API seam, hardest to evolve or swap later.
- **Keep shadcn/ui and only harden it** (tokens + docs + Storybook). A valid lower-risk option that solves "consistency" and "governance," but does **not** deliver the owner's decision to standardize on MUI or the "missing components / faster building" goals. Recorded as the fallback if Phase 0 shows unacceptable brand-fidelity cost.
- **Big-bang replacement.** Rejected: violates the "smallest change" prime directive on a ~767-user production app and the auth freeze.

## Consequences

- **Cost: $0 recurring.** MUI Core + Emotion are MIT. No MUI X. Existing AG Grid/recharts licenses unchanged.
- **New dependencies:** `@mui/material`, `@emotion/react`, `@emotion/styled`, and **`@mui/icons-material`** (owner-confirmed: adopt out-of-the-box Material icons). `lucide-react` is **replaced** and removed — a migration task, since it is imported directly across many files (map lucide names → MUI icon names). The a11y `<Icon>` wrapper is retained, backed by MUI icons. Icons are used purposefully, not decoratively.
- **Temporary bundle growth** while MUI/Emotion and Tailwind/Radix coexist mid-migration; net size is re-measured at the end when Tailwind + the ~35 Radix packages + shadcn are removed.
- **Two existing toast systems** (sonner + Radix toast) and **three overlapping save-status components** are consolidated to one MUI target during migration — a cleanup win.
- **Provider change in `App.tsx`** (not the frozen `main.tsx` boot block): an MUI `ThemeProvider` (+ `CssBaseline`) bridged to the existing `ThemeProvider`'s `resolvedTheme`. The custom `ThemeProvider` remains the source of light/dark truth.
- **Risk — brand fidelity:** matching the asymmetric radii, custom shadows, and 9 button variants in MUI is real theme engineering, front-loaded into Phase 0/1 and proven on one page before mass migration.
- **Risk — the Tailwind auto-retrofit CSS** must be ported to `MuiPaper`/`MuiCard` `styleOverrides` before it is deleted, or MUI card surfaces render unbranded.
- **Auth UI unchanged until the final phase**, gated on the auth regression suite.
- **Rollback** at any phase: the owned layer is additive; revert imports for a feature area and the shadcn component still exists until its delete step.
- **Not in scope:** MUI X (paid), replacing AG Grid/recharts, changing fonts or the token values themselves, and any auth-UI change ahead of the final gated phase.
