# Spec: visible focus ring for interactive components (WCAG 2.4.7)

Owner: design-system. Independent of the email-rearchitecture work (that PR touches none of these
files). Handed off because the a11y e2e began failing once a full e2e run executed against the
design-system buttons.

## Problem

`e2e/a11y/keyboard-walk.e2e.ts` fails on `/login` and `/register`:

```
no visible focus ring: BUTTON#.MuiButtonBase-root MuiButton-root MuiButton-outline
MuiButton-outlinePrimary … Mui-focusVisible
```

MUI's default `.Mui-focusVisible` state changes background/elevation but produces **no `outline` and
no `box-shadow`**, so it fails the check.

## The exact assertion the fix must satisfy

For every keyboard-focused **interactive** element (natively focusable — `A/BUTTON/INPUT/SELECT/
TEXTAREA/SUMMARY` — or with an interactive ARIA role), the computed style on focus must have **either**:

- `outline-width > 0`, **or**
- `box-shadow !== "none"`

(see `e2e/a11y/keyboard-walk.e2e.ts` lines 31–33). A background-color change alone does **not** pass.

## Required change (theme-level, so it's global)

In the MUI theme (`createTheme` → `components.*.styleOverrides.root`), add a focus-visible ring to the
button-like and interactive atoms. Doing it once on **`MuiButtonBase`** covers the failing case and
every button variant (Button, IconButton, Fab, ToggleButton, Tab, clickable Chip, MenuItem). Extend the
same token to `MuiInputBase`/`MuiOutlinedInput`, `MuiSwitch`, `MuiCheckbox`, `MuiRadio`, `MuiLink` for
consistency.

### Recommended style

```ts
"&.Mui-focusVisible": {
  outline: `2px solid ${theme.palette.primary.main}`, // or a dedicated `--focus-ring` token
  outlineOffset: "2px",
},
```

If `outline` clips on rounded/overflow-hidden components, use a box-shadow ring instead (also passes):

```ts
"&.Mui-focusVisible": {
  boxShadow: `0 0 0 2px ${theme.palette.background.paper}, 0 0 0 4px ${theme.palette.primary.main}`,
},
```

### Requirements / acceptance

1. Keyboard focus only (`.Mui-focusVisible` / `:focus-visible`), never bare `:focus` — no ring on mouse click.
2. **≥ 2px** ring, **≥ 2px** offset (or the double box-shadow above). Meets WCAG 2.4.7 + the 2.4.11 intent.
3. Works in **light and dark** (color from a theme token, not a hardcoded hex) and stays visible under
   `@media (forced-colors: active)` (e.g. `outline-color: Highlight`, or don't strip the UA outline there).
4. Single shared focus-ring token/mixin, referenced by every component, for consistency.
5. Additive/focus-only — don't regress hover/active visuals.

### Verify

```bash
npx playwright test e2e/a11y/keyboard-walk.e2e.ts
```

All routes (`/`, `/login`, `/register`, `/forgot-password`, `/accessibility`) must report `0` offenders.
Keep the `phase*` / `responsive-a11y` design-system unit tests green.
