# Responsive, Accessible & Cross-Device Standard

How the TechFleet Design System applies the three universal-quality skills —
**universal-browser-device-support**, **universal-accessibility-wcag** (WCAG 2.2 AA), and
**usability-ux-universal-design** — so every DS component renders cleanly and is usable on **any browser,
any device, and any input**, for everyone. This is a build contract, not aspiration: components ship
against it and it's verified in CI.

## 1. The 4px grid + 12-column responsive layout

- **4px spacing grid.** `theme.spacing(1) = 4px` (`createAppTheme`, matching `index.css`'s `--space-*`
  scale). Every padding/margin/gap steps in 4px units via `sx` (`p:2`=8px, `p:6`=24px). No off-grid magic
  numbers.
- **12-column responsive `Grid`.** `import { Grid, Container, Stack } from "@/design-system"`. `Grid`
  (MUI Grid v2) is a 12-column grid; column spans are set per breakpoint via the `size` prop (e.g. `{ xs: 12, sm: 6, md: 4 }`)
  — and gutters use the 4px `spacing`. `Container` caps width responsively; `Stack` does 1-D layout with
  responsive `direction`/`spacing`.
- **Breakpoints** (mobile-first): `xs 0 · sm 600 · md 900 · lg 1200 · xl 1536`. Add complexity upward from
  the **smallest supported width (320–360px)** — no horizontal scroll or clipping there.
- **Fluid, not fixed.** Typography is `rem` + `clamp()` (see typography-system); layout uses `%`/`fr`/Grid,
  never fixed pixel widths that overflow small screens. Content-driven breakpoints, not device magic numbers.

## 2. Cross-browser / cross-device (universal-browser-device-support)

- **Support matrix = `browserslist`** (already in `package.json`: `>0.5%`, `last 2 versions`, Firefox ESR,
  `iOS >= 14.5`, `Safari >= 14.1`) — the single source of truth for **Autoprefixer**, SWC transpile, and the
  `eslint-plugin-compat` lint gate. Covers all three engines: **Blink, WebKit, Gecko**.
- **Feature-detect, never UA-sniff.** No branching on browser brand anywhere in the DS.
- **Input-agnostic.** Every control works by **touch, mouse, and keyboard**; interactive targets meet WCAG
  2.5.8 (≥24px, designed toward ~44px); **no hover-only affordances**. Built on MUI's Pointer-Events base.
- **`100dvh`, safe-area insets, and `env(safe-area-inset-*)`** are handled in `index.css` (carried forward).
- **Verification:** Playwright visual-regression suite runs Chromium/WebKit/Firefox at multiple viewports
  (`e2e/visual`, gated in CI). DS components get showcase stories captured light + dark.

## 3. Accessibility — WCAG 2.2 AA (universal-accessibility-wcag)

Semantic HTML first; ARIA only for genuine gaps; **verified**, not asserted. Concrete DS mechanisms:

| Principle / criterion                            | DS mechanism                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Focus visible (2.4.7)**                        | `MuiButtonBase` `&.Mui-focusVisible` → 2px `ring`-token outline, offset 2px, on every interactive element (Button/IconButton/MenuItem/Tab).                                    |
| **Keyboard operable (2.1.1) / no traps (2.1.2)** | Native MUI controls + APG patterns; Dialog traps focus and returns it on close (MUI built-in).                                                                                 |
| **Name/Role/Value (4.1.2)**                      | Native elements; `Icon` names meaningful icons (`role="img"`+label) and hides decorative ones. Icon-only buttons require a name.                                               |
| **Labels & errors (1.3.1/3.3.1/3.3.3)**          | `Field`/`RHF*` link the message to the control via `aria-describedby`, set `aria-invalid`, render errors in text with `role="alert"`, and mark required with text (not color). |
| **Status messages (4.1.3)**                      | `Alert` = `role="alert"`; live-region announcements without stealing focus.                                                                                                    |
| **Use of color (1.4.1)**                         | Meaning always paired with text/icon/shape (error text + border, not color alone).                                                                                             |
| **Contrast (1.4.3/1.4.11)**                      | Tokens are AA-verified (Tech Fleet Blue on white 7.34:1 AAA; `--muted-foreground` tuned ≥4.5:1). UI borders/rings ≥3:1.                                                        |
| **Resize/reflow (1.4.4/1.4.10)**                 | `rem`+`clamp()` type; fluid layout usable at 200% zoom and 320px width; zoom never disabled.                                                                                   |
| **Reduced motion (2.3.3)**                       | `DesignSystemProvider` `GlobalStyles` honors `prefers-reduced-motion: reduce` (near-instant transitions) — only for users who ask for it.                                      |

**Verification:** `eslint-plugin-jsx-a11y` lint gate (in CI) + `@axe-core/playwright` scans; every DS
component ships with a unit test; keyboard + screen-reader passes on key flows (documented against criteria).

## 4. Usability & universal design (usability-ux-universal-design)

- **One obvious primary action** (Button `default`/`hero` are visually dominant; `ghost`/`link` recede).
- **Recognition over recall & progressive disclosure** — Select/Autocomplete/Accordion present options and
  reveal complexity on demand.
- **Forgiving, safe** — inline validation via the `Field` layer; destructive intent uses the `destructive`
  button variant and (where built) confirm dialogs; errors are plain-language, specific, next to the field.
- **Designed in-between states** — `Skeleton` (loading), `Alert` (error/empty), plus guidance to always
  design empty/loading/success states (never a blank void).
- **Plain-language, action-oriented labels** — enforced by the brand-terms lint rule + content guidance.

## Definition of done (per component, added to the DoD)

- [ ] Renders with no horizontal scroll / clipping at 320–360px; fluid up to desktop.
- [ ] Every control keyboard-operable with a visible focus ring; targets ≥24px.
- [ ] Names/roles/states correct; icon-only controls named; errors linked + announced.
- [ ] Contrast AA in light **and** dark; meaning never by color alone.
- [ ] Honors `prefers-reduced-motion` / `prefers-color-scheme` / 200% zoom.
- [ ] jsx-a11y + axe clean; unit test present; cross-engine visual snapshot (light+dark).
