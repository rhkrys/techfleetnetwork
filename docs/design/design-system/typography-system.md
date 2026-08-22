# Typography System (Atom)

The type scale is a **foundational atom**: every heading and paragraph in the app is one variant of it, so
getting it right in the MUI theme fixes consistency everywhere at once.

**Design decision (owner):** wrap the Tech Fleet sizes / weights / responsive specs **onto MUI's existing
native Typography variant layer** (`h1–h6`, `subtitle1/2`, `body1/2`, `button`, `caption`, `overline`) — do
**not** invent a parallel variant set. Fonts: **Futura PT for headings, Poppins for body text and labels**.
**No Roboto. No monospace face.**

Source of truth for the scale: `docs/brand/typography.md` + the current `src/components/ui/typography.tsx`
(Tech Fleet Brand Visual Guide §3). This system preserves those sizes and re-expresses them as MUI theme
typography.

## Families

| Role              | Family (stack)                                                                   | Weight         | Used for                                                               |
| ----------------- | -------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------- |
| **Headings**      | `"Futura PT","Futura PT Fallback",Jost,Poppins,Inter,system-ui,sans-serif`       | 700 (h5 = 500) | `h1`–`h6`                                                              |
| **Body & labels** | `Poppins,"Poppins Fallback",Inter,system-ui,-apple-system,"Segoe UI",sans-serif` | 400 / 500      | `subtitle1/2`, `body1/2`, `caption`, `button`, `overline`, form labels |

- **Poppins is the theme default `fontFamily`** — it applies to everything unless a heading variant overrides
  it with Futura. This is what replaces MUI's Roboto default (see §"Poppins, not Roboto" below).
- **Futura PT is unlicensed today**; **Jost** is the shipping open-source stand-in (see the licensing gap in
  `docs/brand/typography.md`). When Futura is licensed, only the `@font-face` block changes — not this system.
- Metric-matched fallbacks (`Poppins Fallback`, `Futura PT Fallback`) sit before the system stack to
  eliminate CLS on font swap. These stacks already exist in `tailwind.config.ts` and carry over verbatim.
- **No monospace face.** `JetBrains Mono` is removed — it was a phantom token (referenced in
  `tailwind.config.ts` but never loaded in `main.tsx`, so it already fell back to system monospace). If code
  ever needs a monospaced render, use the CSS system stack `ui-monospace, monospace` locally; we do not ship a
  branded mono font.

## The scale, mapped onto MUI's native variants

Sizes are the **currently-rendered responsive values** from `typography.tsx` (the brand-guide nominal px are
noted for reference). Line-height **1.1** on headings, **1.5** on body. Letter-spacing **0.012em** throughout
(headings), normal on body. Sizes in `rem`, responsive via `clamp()`.

| Brand name (shared vocab)   | **MUI variant** | Font / weight                               | Responsive size (rem)             | Nominal px | Default tag        |
| --------------------------- | --------------- | ------------------------------------------- | --------------------------------- | ---------- | ------------------ |
| **Display / Hero**          | `h1`            | Futura 700, lh 1.0                          | `clamp(1.875rem, 4vw, 3rem)`      | 64         | `<h1>`             |
| **Page Title**              | `h2`            | Futura 700, lh 1.1                          | `clamp(1.5rem, 3vw, 2.25rem)`     | 48         | `<h2>`*            |
| **Section Title**           | `h3`            | Futura 700, lh 1.1                          | `clamp(1.25rem, 2.25vw, 1.75rem)` | 36         | `<h3>`             |
| **Subsection Title**        | `h4`            | Futura 700, lh 1.1                          | `1.25rem → 1.5rem @sm`            | 24         | `<h4>`             |
| **Card Title**              | `h5`            | Futura **500**, lh 1.1                      | `1.125rem → 1.25rem @sm`          | 20         | `<h5>`             |
| **Eyebrow / micro-heading** | `h6`            | Futura 600, lh 1.2, uppercase opt.          | `1rem`                            | 16         | `<h6>`             |
| **Lede / Body Large**       | `subtitle1`     | Poppins 400, lh 1.5                         | `1.125rem`                        | 18         | `<p>`              |
| **Label**                   | `subtitle2`     | Poppins **500**, lh 1.4                     | `0.875rem`                        | 14         | `<label>`/`<span>` |
| **Body Standard**           | `body1`         | Poppins 400, lh 1.5                         | `1rem`                            | 16         | `<p>`              |
| **Body Small**              | `body2`         | Poppins 400, lh 1.5                         | `0.875rem`                        | 14         | `<p>`              |
| **Caption / Micro**         | `caption`       | Poppins 400, lh 1.5, muted                  | `0.75rem`                         | 12         | `<span>`           |
| **Button text**             | `button`        | Poppins 700, tracking 1px, **no uppercase** | `1rem`                            | 16         | (in `Button`)      |
| **Overline**                | `overline`      | Poppins 600, uppercase, tracking 0.08em     | `0.75rem`                         | 12         | `<span>`           |

\* **Semantic tags vs visual variant.** MUI decouples the style variant from the rendered HTML tag. A page's
main heading must be a real `<h1>`, so when a page uses **Page Title** (`variant="h2"`) as its top heading and
has no hero, set `component="h1"` on that instance. Rule: **one `<h1>` per page**; never skip heading levels
for semantics (only for style).

## How it becomes MUI

### 1. Theme typography (Poppins default, Futura headings, no Roboto)

```ts
// src/design-system/theme/typography.ts
const HEADING = '"Futura PT","Futura PT Fallback",Jost,Poppins,Inter,system-ui,sans-serif';
const BODY = 'Poppins,"Poppins Fallback",Inter,system-ui,-apple-system,"Segoe UI",sans-serif';

export const typography = {
  fontFamily: BODY, // <-- default for the whole app = Poppins (replaces Roboto)
  htmlFontSize: 16,

  // Headings — Futura, override fontFamily per variant
  h1: {
    fontFamily: HEADING,
    fontWeight: 700,
    lineHeight: 1.0,
    letterSpacing: "0.012em",
    fontSize: "clamp(1.875rem,4vw,3rem)",
  },
  h2: {
    fontFamily: HEADING,
    fontWeight: 700,
    lineHeight: 1.1,
    letterSpacing: "0.012em",
    fontSize: "clamp(1.5rem,3vw,2.25rem)",
  },
  h3: {
    fontFamily: HEADING,
    fontWeight: 700,
    lineHeight: 1.1,
    letterSpacing: "0.012em",
    fontSize: "clamp(1.25rem,2.25vw,1.75rem)",
  },
  h4: {
    fontFamily: HEADING,
    fontWeight: 700,
    lineHeight: 1.1,
    letterSpacing: "0.012em",
    fontSize: "clamp(1.25rem,2vw,1.5rem)",
  },
  h5: {
    fontFamily: HEADING,
    fontWeight: 500,
    lineHeight: 1.1,
    letterSpacing: "0.012em",
    fontSize: "clamp(1.125rem,1.5vw,1.25rem)",
  },
  h6: {
    fontFamily: HEADING,
    fontWeight: 600,
    lineHeight: 1.2,
    letterSpacing: "0.012em",
    fontSize: "1rem",
  },

  // Body & labels — Poppins (inherit default fontFamily)
  subtitle1: { fontWeight: 400, lineHeight: 1.5, fontSize: "1.125rem" }, // Lede
  subtitle2: { fontWeight: 500, lineHeight: 1.4, fontSize: "0.875rem" }, // Label
  body1: { fontWeight: 400, lineHeight: 1.5, fontSize: "1rem" }, // Body
  body2: { fontWeight: 400, lineHeight: 1.5, fontSize: "0.875rem" }, // Body Small
  caption: { fontWeight: 400, lineHeight: 1.5, fontSize: "0.75rem" }, // Caption
  button: { fontWeight: 700, letterSpacing: "1px", textTransform: "none", fontSize: "1rem" },
  overline: {
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontSize: "0.75rem",
  },
};
```

No custom variants → **no module augmentation needed**; we use MUI's own variant names.

### 2. Poppins, not Roboto (explicit)

MUI's default is Roboto, but **Roboto is not auto-loaded** — MUI only renders it if you install it and set
`fontFamily: 'Roboto'`. So the plan is simply:

- **Set `theme.typography.fontFamily` to the Poppins stack** (above). Every variant that doesn't override
  `fontFamily` (all body/label variants) uses Poppins.
- **Do not install `@fontsource/roboto`** and never reference Roboto in any stack. Poppins is already
  self-hosted via `@fontsource/poppins` (400/500/600) in `main.tsx`; Jost via `@fontsource/jost` (600/700).
- `CssBaseline` inherits `theme.typography.fontFamily`, so the base `<body>` font is Poppins with no extra
  work. This matches the existing `body { font-family: 'Poppins'… }` rule in `index.css`.

### 3. Semantic tags & the optional `<Text>` helper

Consumers can use MUI `Typography` directly (`<Typography variant="h3">`). To keep the readable brand names
as our shared vocabulary and enforce the one-`<h1>` rule, a thin owned helper maps brand name → MUI variant +
semantic tag (no new styling, just naming + `component`):

```tsx
// src/design-system/components/atoms/Text.tsx  (thin wrapper over MUI Typography)
const BRAND_TO_VARIANT = {
  display: "h1",
  pageTitle: "h2",
  sectionTitle: "h3",
  subsectionTitle: "h4",
  cardTitle: "h5",
  eyebrow: "h6",
  lede: "subtitle1",
  label: "subtitle2",
  body: "body1",
  bodySmall: "body2",
  caption: "caption",
} as const;
// <Text as="section" brand="sectionTitle"> → <Typography variant="h3" component="h2">…  (tag overridable)
```

Feature code reads almost identically to today (`<Text brand="sectionTitle">` ≈ `<SectionTitle>`), so
migration stays mechanical and the shared vocabulary is intact — while the **styling lives entirely in MUI's
native variant layer**.

## Rules (governance)

- **One `<h1>` per page** — Display (`h1`) _or_ Page Title with `component="h1"`, never two.
- Feature code never sets raw `font-size`/`font-family` — only a MUI variant (via `Typography`/`Text`) or a
  heading inside an organism that uses them. The ESLint import guard keeps MUI `Typography` inside the DS.
- **Headings = Futura, body + labels = Poppins.** No Roboto, no branded mono.
- Color from tokens (`text.primary` = `--foreground`, `text.secondary` = `--muted-foreground`, primary text =
  `--primary-text`) — never raw hex.
- **Futura PT licensing gap** unchanged: Jost renders until the face is licensed.
