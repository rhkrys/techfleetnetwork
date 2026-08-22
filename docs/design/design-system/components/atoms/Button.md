# Button (atom)

Tech Fleet button, built on MUI `Button`. **Replaces** `src/components/ui/button.tsx`.

- **Layer:** atom · **Status:** WRAP · **Import:** `import { Button } from "@/design-system"`

## API

| Prop                                                    | Type                                                                                                 | Default   | Notes                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------- |
| `variant`                                               | `default \| hero \| success \| destructive \| outline \| secondary \| hero-outline \| ghost \| link` | `default` | 9 Tech Fleet variants (registered via module augmentation).         |
| `size`                                                  | `default \| sm \| lg \| xl \| icon`                                                                  | `default` | All 40px tall; differ by horizontal padding. `icon` = 40×40 square. |
| `disabled`, `startIcon`, `endIcon`, `onClick`, `sx`, …​ | MUI `ButtonProps`                                                                                    | —         | Full MUI Button API (minus MUI's `size`, replaced above).           |

## Deviation from stock MUI

- **9 variants** vs MUI's 3 (`text/outlined/contained`) — the extra `hero`, `hero-outline`, `success`,
  `destructive`, `ghost`, `link` come from `theme/components.ts` `variants[]`.
- **Asymmetric corner radius** (top-left + bottom-right only, `6px 0 6px 0`) — the Tech Fleet signature.
- **`--tf-btn` multi-layer shadows** + hover `translateY(-1px)` on filled variants.
- **Ripple disabled** globally (`MuiButtonBase.disableRipple`) to match the flat, non-Material feel.
- **Poppins 700, 1px tracking, no uppercase.**

## Behavior scenarios (→ tests in `components/__tests__/tfds.test.tsx`)

- Renders its label as a `button`; renders each of the 9 variants.
- Disabled → `onClick` does not fire; enabled → fires once.
- `size="icon"` renders a square icon button.

## Usage

```tsx
import { Button, Icon } from "@/design-system";
import Add from "@mui/icons-material/Add";

<Button variant="hero" onClick={save}>Get started</Button>
<Button variant="outline" size="sm">Cancel</Button>
<Button size="icon" aria-label="Add"><Icon icon={Add} label="Add" /></Button>
```

## Follow-ups (Phase 1)

- `lg`/`xl` responsive full-width behavior (`w-full lg:w-auto`) is not yet ported — currently padding-only.
- Add visual-regression story coverage for all variants × light/dark on the showcase page.
