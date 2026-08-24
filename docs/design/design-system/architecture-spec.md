# TFDS Architecture Spec — owned layer on MUI Core

Companion to [ADR 0015](../../adr/0015-mui-owned-design-system-layer.md), the
[component audit](component-audit.md), and the [typography system](typography-system.md). This is the
_how_: structure, theming, form redesign, rollout, governance, risks.

## 1. Goals → mechanism

| Owner goal                                 | Mechanism in this spec                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Consistent UI** (every element the same) | One MUI theme + one owned layer + an ESLint import guard. Consistency is enforced in CI, not by discipline.   |
| **Missing components**                     | Build them ourselves in the owned layer (MUI primitives inside). Audit shows ~7 composites, **$0**, no MUI X. |
| **Faster building**                        | MUI Core is batteries-included; ~28 primitives are direct MAPs. Less hand-assembly than shadcn.               |
| **Docs / governance**                      | This folder + Storybook + Atomic-Design vocabulary + the import guard.                                        |

## 2. Directory structure (mirrors Atomic Design)

`src/design-system/` is the **only** place the app imports UI from (barrel `@/design-system`):

```
src/design-system/
  theme/
    tokens.ts          // reads the CSS vars from index.css → MUI palette/shape/spacing
    palette.ts         // hsl(var(--…)) references (single source of truth stays index.css)
    typography.ts      // the type scale (see typography-system.md)
    typography.d.ts    // module augmentation: custom Typography variants
    components/         // per-MUI-component styleOverrides + custom variants
      MuiButton.ts      //   asymmetric radius, hero/success variants, --tf-btn shadows, no ripple
      MuiPaper.ts       //   tf-card 40px asymmetric radius + inset glow (replaces the Tailwind retrofit)
      MuiTextField.ts   //   validation colors, radius
      …
    index.ts           // createTheme(...) assembled from the above
  components/
    atoms/             // Button, Text, Badge, Icon(=@mui/icons-material wrapper), Input/Field, Checkbox, Switch, …
    molecules/         // Field (RHF), MultiSelect, Tabs, ResponsiveTabs, ConfirmDialog, SaveStatus, Alert, …
    organisms/         // Dialog, Sheet, Sidebar, CommandPalette(=cmdk), Toaster(=Snackbar), Card, …
  provider/
    DesignSystemProvider.tsx  // MUI ThemeProvider + CssBaseline + Emotion cache, bridged to app theme
  index.ts             // public barrel — the ONLY import surface for the app
```

Templates (`src/layouts/**`) and Pages (`src/pages`, `src/features`) live outside the DS and **compose**
it. The dependency rule (pages→templates→organisms→molecules→atoms→theme) is never inverted.

## 3. Theme-mapping strategy (the crux)

**The Tech Fleet brand is currently expressed as Tailwind utility classes + global attribute-selector CSS
in `index.css`.** MUI expresses styling as a theme object + Emotion. The migration re-expresses the brand
into the theme. Two principles keep it clean:

### 3a. Tokens: concrete per-mode values, mirrored from `index.css`

**Implementation finding (corrects the original plan):** MUI's color manipulation (`alpha()`, `lighten`,
`darken` used internally by Button/Checkbox/etc.) calls `decomposeColor()` on the palette **intention**
colors (primary/secondary/error/success/warning/info) and **cannot parse a CSS `var(...)` reference** — it
throws at render time. So the palette must hold concrete, parseable color strings.

We therefore mirror the token **values** (the same Tech Fleet Brand Visual Guide numbers as `index.css`)
into `src/design-system/theme/tokens.ts` as concrete comma-form `hsl()` per mode, and
`DesignSystemProvider` **rebuilds the theme when the app's `resolvedTheme` flips**:

```ts
// tokens.ts (mirrors index.css; comma-form hsl so MUI can parse it)
export const LIGHT = { primary: { main: 'hsl(209, 100%, 33%)', dark: 'hsl(217, 73%, 48%)', … }, … };
export const DARK  = { primary: { main: 'hsl(217, 73%, 48%)',  dark: 'hsl(217, 91%, 60%)', … }, … };

// createAppTheme(mode) → createTheme({ palette: { mode, primary: TOKENS[mode].primary, … } })
```

**Source-of-truth during coexistence:** `src/index.css` remains the SoT for the Tailwind/shadcn side; the
two are kept in sync until Tailwind is removed, at which point `tokens.ts` becomes the single source. This
is a small, documented, testable mirror of ~8 intention colors + background/text/divider per mode — not a
second styling system. (The alternative — MUI's `cssVariables: true` + `colorSchemes` mode — was rejected
for Phase 0 because it manages its own `data-mui-color-scheme` switching, which would fight the app's
existing `.dark` class provider.)

### 3b. Signature brand traits become `styleOverrides` + custom variants

| Trait (today)                                                                                | Theme mechanism                                                                                                 |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Button **asymmetric radius** (tl+br only), 1px tracking, Poppins, custom shadows, hover-lift | `MuiButton.styleOverrides.root` + `MuiButtonBase.defaultProps.disableRipple`                                    |
| Button variants `hero`, `hero-outline`, `success`, `destructive`                             | `MuiButton.variants[]` + module augmentation of `ButtonPropsVariantOverrides`                                   |
| **`.tf-card`** 40px asymmetric radius + inset glow, `compact`/`muted`                        | `MuiPaper`/`MuiCard.styleOverrides` + card `variants` — **replaces** the global Tailwind auto-retrofit selector |
| Input `aria-invalid`/`data-valid` state colors                                               | `MuiOutlinedInput.styleOverrides` keyed on `error`/`color="success"`                                            |
| Type scale, Futura/Poppins                                                                   | `theme.typography` (see typography-system.md)                                                                   |
| Motion durations (quick/standard/emphasized)                                                 | `theme.transitions.duration`                                                                                    |

The `--tf-btn-*` variables and the `.tf-card` global rule are **deleted** once their components are fully
migrated (band-aid removal, per the CLAUDE.md prime directive).

## 4. Provider wiring (not the frozen boot block)

Add the provider in **`App.tsx`** (the `main.tsx` boot block is auth-frozen):

```tsx
<ThemeProvider>
  {" "}
  {/* existing custom provider — stays the source of light/dark truth */}
  <DesignSystemProvider>
    {" "}
    {/* new: MUI ThemeProvider + CssBaseline + Emotion cache */}
    <App />
  </DesignSystemProvider>
</ThemeProvider>
```

`DesignSystemProvider` reads `useTheme().resolvedTheme` and passes `mode` into the MUI theme. `CssBaseline`
is added with `enableColorScheme`; we scope it so it doesn't fight Tailwind's preflight during coexistence
(documented in the provider). **Emotion + Tailwind coexist** the whole migration — both are class-based and
don't collide at runtime; the only care needed is CSS source order (MUI's injection point set so app
overrides win).

## 5. Form-layer redesign

Today's `form.tsx` uses Radix `Slot` (`asChild`) to inject `aria-*`/`id` into an arbitrary child input —
**0 external importers** (forms wire `react-hook-form` directly). MUI inputs aren't Radix and have their
own `label`/`error`/`helperText` model, so we redesign rather than port:

- Keep **react-hook-form + zod** (unchanged).
- Build owned `RHFTextField`, `RHFSelect`, `RHFCheckbox`, `RHFAutocomplete` molecules using `useController`,
  mapping `fieldState.error` → MUI `error` + `helperText`. This is _less_ code than the Slot dance and
  subsumes `validated-field` and `char-count-textarea`.
- `FormItem/FormLabel/FormControl/FormMessage` are retired (MUI `TextField` composes label+control+helper).

## 6. Coexistence & phased rollout

MUI and shadcn/Tailwind run **side-by-side**; migrate leaf→root; **delete each shadcn component + its
band-aid CSS in the same phase it's fully replaced.**

| Phase                              | Scope                                                                                                                                                                                                                                                                                                                                                                              | Exit criteria                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **0 — Foundation**                 | Install pinned `@mui/material @emotion/react @emotion/styled`. Scaffold `src/design-system/`. Build the theme (palette + typography + `MuiButton`/`MuiPaper` overrides). Wire `DesignSystemProvider` in `App.tsx`. Add ESLint import guard. Stand up a **DS showcase page** (extend `BrandTokensPage`) + optional Storybook. Migrate **one low-risk non-auth leaf page** as proof. | POC page pixel-close in **light + dark**; `npm run test` + typecheck + lint green; bundle delta measured. |
| **1 — Atoms parity**               | Build/wrap the atoms with full brand parity + tests + visual regression: **Button, Text, Badge, Input/Field, Checkbox, Switch, Skeleton, Divider, Icon(keep)**. No consumer migration yet.                                                                                                                                                                                         | Every atom matches its shadcn counterpart in the showcase; a11y checks pass.                              |
| **2 — Molecules & core organisms** | Field/RHF adapters, Multi-Select (Autocomplete), Tabs/ResponsiveTabs, ConfirmDialog, Alert, **Dialog**, SaveStatus (3→1), Toaster (2→1).                                                                                                                                                                                                                                           | Parity + tests; the two toast systems and three save-status impls are unified.                            |
| **3..N — Feature areas**           | Migrate `src/pages`/`src/features` area-by-area (e.g. resources → settings → admin → dashboards). Swap imports to `@/design-system`; delete the replaced shadcn file + its Tailwind band-aid (e.g. `.tf-card` retrofit once all cards are MUI).                                                                                                                                    | Each area's tests green; no `@/components/ui` imports remain in that area.                                |
| **Shells**                         | Templates: Sidebar, nav, app shells.                                                                                                                                                                                                                                                                                                                                               | Shell organisms live in TFDS; layouts compose them.                                                       |
| **Final — Auth + teardown**        | Migrate auth sign-in/up/reset/MFA UI **with the full auth regression suite green** (per `06-auth-flow-lockdown`). Then remove Tailwind + the ~35 Radix packages + shadcn; delete `components.json`, the `.tf-card` retrofit, and `--tf-btn-*` (now in the theme).                                                                                                                  | Auth suite green; Tailwind/Radix removed; final bundle re-measured.                                       |

Rollback at any phase = revert that area's imports; the shadcn component still exists until its delete step.

## 7. Governance

- **ESLint `no-restricted-imports`:** ban `@mui/material*` (and, once retired, `@/components/ui/*`) outside
  `src/design-system/**`. Makes "one consistent library, used correctly" a CI gate.
- **Atomic-Design vocabulary** (README) is the shared language for every change request.
- **Storybook** (optional but recommended) documents each atom/molecule/organism with its variants.
- **CLAUDE.md** updated: "UI is imported only from `@/design-system`."
- Every phase ships an ADR-referenced PR with the diff + test output (Definition of Done).
- **Engineering requirements + Definition of Done** are specified in
  [`engineering-requirements.md`](engineering-requirements.md) (skills-derived, right-sized): unit + visual-
  regression + a11y tests, coverage gate, bundle-size budget, supply-chain audit, backward-compatible
  coexistence, and per-component docs. That doc is the build contract.

### 7a. Documentation is a release deliverable (not optional)

Every component we **build, wrap, or change** is documented as part of the same work — a change isn't "done"
until its docs exist. This is what lets the rest of the team (and future us) see exactly what was done and how
to use it.

- **Per-component doc** in `docs/design/design-system/components/<atom|molecule|organism>/<Name>.md`, written
  when the component is built/wrapped, containing:
  1. **Atomic layer** and one-line purpose.
  2. **Status** — `MAP` / `WRAP` / `BUILD` / `CONSOLIDATE` / `KEEP-LIB` / `DELEGATE` (from the audit).
  3. **API** — props, variants, sizes, default values.
  4. **Deviation from stock MUI** — what the theme/wrapper changes and why (asymmetric radius, extra variants,
     etc.), so the "our-flavor-of-MUI" is explicit.
  5. **Replaces** — the shadcn component(s) it supersedes + any consolidations (e.g. 3 save-status → 1).
  6. **Usage example** + a Storybook story reference.
- **The README is the living "what we did" front door** — a build-log table (see README §"Build log") whose
  status flips from `planned` → `in progress` → `done` per component, each row linking to its component doc.
- **Tokens/theme changes are documented too** — any new token, `styleOverrides`, or custom variant is recorded
  in the theme docs with before/after intent.
- The doc lands **in the same PR** as the component. Reviewer checklist item: "component doc updated?"

## 8. Risks & honest cautions

- **Brand fidelity** is real theme engineering (asymmetric radii, custom shadows, 9 button variants),
  front-loaded into Phase 0/1 and proven on one page before mass migration.
- **The Tailwind auto-retrofit CSS** (`.tf-card` global selector) is a landmine — port it to
  `MuiPaper`/`MuiCard` `styleOverrides` **before** deleting it, or MUI card surfaces render unbranded.
- **Temporary bundle growth** while MUI/Emotion + Tailwind/Radix coexist; net measured after teardown
  (removing Tailwind + ~35 Radix packages should offset much of it). Measure at Phase 0 and Final.
- **Auth freeze** honored — auth UI is the last phase, gated on the regression suite.
- **Accessibility:** Radix is a11y-strong; MUI is too, but re-verify against `docs/accessibility/` + the
  VPAT checklist as organisms migrate.
- **Font licensing** (Futura PT unlicensed, Jost stand-in) is unchanged by this work.
- **Two toast systems / three save-status components** are pre-existing debt; the migration consolidates
  them (a win, but touches their call sites).

## 9. Cost

**$0 recurring.** MUI Core + Emotion are MIT. No MUI X Pro/Premium. AG Grid + recharts licenses unchanged.
New dev deps only: `@mui/material`, `@emotion/react`, `@emotion/styled`.
