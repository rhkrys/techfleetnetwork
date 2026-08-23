# Icon (atom)

Accessibility wrapper over **`@mui/icons-material`** (Material icons, owner-confirmed). **Replaces** the
`lucide-react`-backed `src/components/ui/icon.tsx`.

- **Layer:** atom · **Status:** WRAP · **Import:** `import { Icon } from "@/design-system"`

## Live demo

<Demo name="Icon" />

## API

| Prop              | Type                        | Default | Notes                                                                           |
| ----------------- | --------------------------- | ------- | ------------------------------------------------------------------------------- |
| `icon`            | `SvgIconComponent`          | —       | A Material icon component, e.g. `import Add from "@mui/icons-material/Add"`.    |
| `size`            | `"ui" \| "micro" \| number` | `ui`    | `ui` = 24px, `micro` = 16px.                                                    |
| `label`           | `string`                    | —       | Omit → decorative (`aria-hidden`). Provide → meaningful (`role="img"` + label). |
| `sx`, `className` | —                           | —       | Styling passthrough.                                                            |

## Deviation / decisions

- Icon **glyphs** are imported per-use from `@mui/icons-material` (tree-shaken named imports) and passed to
  `<Icon>`; the ESLint guard restricts `@mui/material` but **not** `@mui/icons-material`.
- **Restraint rule:** icons are functional affordances (buttons, status, nav) — do **not** decorate every
  heading/label with an icon.
- a11y matches the old wrapper: decorative icons are hidden from AT; meaningful ones get a role + label.

## Usage

```tsx
import { Icon } from "@/design-system";
import Search from "@mui/icons-material/Search";

<Icon icon={Search} label="Search" />       // meaningful
<Icon icon={Search} size="micro" />          // decorative, 16px
```

## Follow-up (migration)

- `lucide-react` is imported directly across many files; map lucide glyph names → MUI icon names, then remove
  `lucide-react`. Tracked in the component audit.
