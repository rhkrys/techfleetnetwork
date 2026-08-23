# TechFleet Design System (TFDS) — built on MUI Core

> Status: **Phase 0 landed** (see [ADR 0015](../../adr/0015-mui-owned-design-system-layer.md)). This folder
> is the spec + audit + build log for migrating the app's UI from shadcn/ui to an **owned design-system
> layer on Material UI Community (MUI Core, MIT)**. The foundation (theme, provider, first atoms +
> Card, import guard, showcase) is built and additive; shadcn/Tailwind remain untouched. See the
> [Build log](#build-log--what-we-did) for exactly what exists today vs what's still planned.

## What this is (and isn't)

- **Is:** one library (**MUI Core**, free/MIT), themed once to look like Tech Fleet today, consumed
  through a single owned layer at `src/design-system/` (import alias `@/design-system`). We own the
  API, the theme, and any custom components — in our repo, documented here.
- **Isn't:** a fork of MUI's source repo, and not MUI X (the paid Pro/Premium tier). AG Grid stays for
  tables; recharts stays for charts. See ADR 0015 for why a literal fork was rejected.

## Shared vocabulary — Atomic Design

We organize and talk about every UI piece using Brad Frost's **Atomic Design** five levels. Use these
words when we discuss changes so we mean the same thing:

| Level         | Definition                                                                        | In this app                                                 | Examples                                                                                                                |
| ------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Atoms**     | Smallest UI elements; can't be broken down and still be useful.                   | Themed MUI primitives.                                      | Button, Input, Label, Badge, Icon, **Typography**, Checkbox, Switch, Skeleton, Spinner.                                 |
| **Molecules** | A few atoms bonded into a small reusable unit with one job.                       | Owned wrappers/composites.                                  | Form Field (label + input + error), Multi-Select, Tabs, Breadcrumb, Alert, Save-Status, Pagination, Tooltip.            |
| **Organisms** | Larger sections composed of molecules + atoms; a distinct region of an interface. | Owned composites + delegated libs.                          | Dialog, Sheet/Drawer, Sidebar, Nav Menu, Command Palette, Toaster, **Data Grid (AG Grid)**, **Chart (recharts)**, Card. |
| **Templates** | Page-level layout skeletons; arrange organisms, no real content.                  | App shells / route layouts (`src/layouts`, page scaffolds). | AppShell, DashboardLayout, AuthLayout, SettingsLayout.                                                                  |
| **Pages**     | A template filled with real content/state; an actual route.                       | `src/pages/**`, `src/features/**`.                          | ProjectFormPage, ResourcesPage, Admin dashboards.                                                                       |

**The dependency rule:** higher levels compose lower levels, never the reverse. Pages use templates;
templates use organisms; organisms use molecules; molecules use atoms; atoms use the **theme + tokens**.
Nothing imports MUI directly except the atoms/molecules inside `src/design-system/` (enforced by an
ESLint rule — see the architecture spec).

## Documents in this folder

| Doc                                                          | What it covers                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`architecture-spec.md`](architecture-spec.md)               | The owned-layer structure, theme-mapping strategy (how the Tech Fleet brand becomes an MUI theme), the form-layer redesign, coexistence + phased rollout, governance, and risks.                                                                 |
| [`component-audit.md`](component-audit.md)                   | Every one of the 62 current `src/components/ui/` components, placed in its atomic layer, mapped to its MUI Core target, with a deviation rating and a per-component action (map / wrap / build / keep-lib / delegate / consolidate).             |
| [`typography-system.md`](typography-system.md)               | The **typography atom** — the full Tech Fleet type scale (Display → Caption), the Futura/Poppins families, and exactly how it becomes MUI theme typography variants + an owned `<Text>` component.                                               |
| [`engineering-requirements.md`](engineering-requirements.md) | The skills-derived engineering requirements (architecture, test strategy, BDD, release safety, OWASP/supply-chain, SRE bundle budget) — right-sized, with N/A justifications — and the **Definition of Done** every component + phase must meet. |

## Documentation is part of the build

Every component we **build, wrap, or change** ships with its docs in the same PR — a change isn't done until
it's documented. Per-component docs live in `components/<layer>/<Name>.md` (API, deviation from stock MUI,
what it replaces, usage). See the [architecture spec §7a](architecture-spec.md) for the exact requirement.
This README's **Build log** below is the running record of what was done.

## Build log — what we did

Status: `planned` → `in progress` → `done`. Rows link to each component's doc as it's written.

| Item                                                                                                                                                                                                         | Layer      | Action  | Status                | Doc                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------- | --------------------- | -------------------------------------------------- |
| Theme: tokens + palette (concrete per-mode, mirrors index.css)                                                                                                                                               | foundation | BUILD   | done                  | [spec §3a](architecture-spec.md)                   |
| Theme: typography (Poppins/Futura, no Roboto/mono)                                                                                                                                                           | foundation | BUILD   | done                  | [typography-system](typography-system.md)          |
| Theme: MuiButton (9 variants, asymmetric radius, no ripple)                                                                                                                                                  | foundation | BUILD   | done                  | [Button](components/atoms/Button.md)               |
| Theme: MuiCard (tf-card) / MuiPaper (excluded)                                                                                                                                                               | foundation | BUILD   | done                  | [Card](components/molecules/Card.md)               |
| DesignSystemProvider (MUI + Emotion injectFirst + mode bridge)                                                                                                                                               | foundation | BUILD   | done                  | [spec §4](architecture-spec.md)                    |
| ESLint import guard (`no-direct-mui`)                                                                                                                                                                        | governance | BUILD   | done                  | [spec §7](architecture-spec.md)                    |
| DS showcase page (`/admin/design-system`)                                                                                                                                                                    | tooling    | BUILD   | done                  | —                                                  |
| Button                                                                                                                                                                                                       | atom       | WRAP    | done                  | [Button](components/atoms/Button.md)               |
| Text (typography)                                                                                                                                                                                            | atom       | WRAP    | done                  | [typography-system](typography-system.md)          |
| Icon (`@mui/icons-material`)                                                                                                                                                                                 | atom       | WRAP    | done                  | [Icon](components/atoms/Icon.md)                   |
| Card (+ sub-parts)                                                                                                                                                                                           | molecule   | WRAP    | done                  | [Card](components/molecules/Card.md)               |
| Badge (Phase 1)                                                                                                                                                                                              | atom       | WRAP    | done                  | [Badge](components/atoms/Badge.md)                 |
| Label (Phase 1)                                                                                                                                                                                              | atom       | WRAP    | done                  | [Label](components/atoms/Label.md)                 |
| Input (Phase 1)                                                                                                                                                                                              | atom       | WRAP    | done                  | [Input](components/atoms/Input.md)                 |
| Textarea (Phase 1)                                                                                                                                                                                           | atom       | WRAP    | done                  | [Textarea](components/atoms/Textarea.md)           |
| Checkbox (Phase 1)                                                                                                                                                                                           | atom       | WRAP    | done                  | [Checkbox](components/atoms/Checkbox.md)           |
| Switch (Phase 1)                                                                                                                                                                                             | atom       | WRAP    | done                  | [Switch](components/atoms/Switch.md)               |
| Skeleton (Phase 1)                                                                                                                                                                                           | atom       | WRAP    | done                  | [Skeleton](components/atoms/Skeleton.md)           |
| Separator (Phase 1)                                                                                                                                                                                          | atom       | WRAP    | done                  | [Separator](components/atoms/Separator.md)         |
| Field (Phase 2)                                                                                                                                                                                              | molecule   | BUILD   | done                  | [Field](components/molecules/Field.md)             |
| RHF form-field layer (TextField/Textarea/Checkbox/Switch) (Phase 2)                                                                                                                                          | molecule   | BUILD   | done                  | [form README](components/molecules/form/README.md) |
| Alert (Phase 2)                                                                                                                                                                                              | molecule   | WRAP    | done                  | [Alert](components/molecules/Alert.md)             |
| Tooltip (Phase 2)                                                                                                                                                                                            | molecule   | WRAP    | done                  | [Tooltip](components/molecules/Tooltip.md)         |
| Dialog (+ sub-parts) (Phase 2)                                                                                                                                                                               | organism   | WRAP    | done                  | [Dialog](components/organisms/Dialog.md)           |
| Unit tests (Phases 0–2)                                                                                                                                                                                      | tests      | BUILD   | done                  | —                                                  |
| Visual-regression stories (light+dark)                                                                                                                                                                       | tests      | —       | planned               | —                                                  |
| First page migration — `NotificationSettingsPage`                                                                                                                                                            | page       | MIGRATE | done                  | —                                                  |
| _…remaining atoms (avatar, progress, slider, radio, toggle, scroll-area), organisms (Tabs, Sheet, Sidebar, Multi-Select→Autocomplete, toast/save-status consolidations) per the [audit](component-audit.md)_ | —          | —       | planned               | —                                                  |
| **Public docs site (GitHub Pages)** — full DS spec, MUI-docs-style, all sections matching; link it from the TF Network root README                                                                           | docs       | —       | planned (post-launch) | —                                                  |

> "done" = code written + verified (typecheck/lint/test/size green). Phase 0 → PR #261 (merged); Phase 1 →
> PR #262 (merged, high-use atoms); Phase 2 → the form-field layer (RHF) + Dialog + Alert + Tooltip;
> then page-by-page migration (first: NotificationSettingsPage).

### Backlog — public documentation site (do NOT start until the migration is launched)

Owner request: publish a **GitHub Pages** site that fully specifies the TechFleet Design System, **matching the
section structure of the [Material UI docs](https://mui.com/material-ui/)** (Getting started, Components — one
page per atom/molecule/organism with props tables + live examples, Customization/Theming, Design tokens,
Typography, etc.). It is generated from these `docs/design/design-system/` sources so there is one source of
truth. **Gate:** build it only once the migration is out and launched. **Deliverable:** the published docs URL
is added to the repository root [`README.md`](../../../README.md).

## Design tokens — the single source of truth

Color, spacing, radius, motion, and font tokens live as CSS variables in
[`src/index.css`](../../../src/index.css) and are surfaced through
[`tailwind.config.ts`](../../../tailwind.config.ts) today. The MUI theme **references those same CSS
variables** (e.g. `palette.primary.main = 'hsl(var(--primary))'`) rather than duplicating values, so
`index.css` stays the one place tokens are defined and light/dark keeps working through the `.dark`
class. The canonical brand reference is [`docs/brand/brand-identity-guide.md`](../../brand/brand-identity-guide.md).
