# Chip (atom)

A compact element representing an input, attribute, tag, or filter. Built on MUI `Chip`.

- **Layer:** atom · **Status:** NEW (MUI Core catalog) · **Import:** `import { Chip } from "@/design-system"`

## Live demo

<Demo name="Chip" />

## API

| Prop              | Type                                                                     | Default   | Notes                                        |
| ----------------- | ------------------------------------------------------------------------ | --------- | -------------------------------------------- |
| `label`           | `ReactNode`                                                              | —         | The chip's content.                          |
| `color`           | `default \| primary \| secondary \| success \| error \| warning \| info` | `default` | Palette color.                               |
| `variant`         | `filled \| outlined`                                                     | `filled`  | Fill style.                                  |
| `size`            | `small \| medium`                                                        | `medium`  | Density.                                     |
| `onClick`         | `() => void`                                                             | —         | Makes the chip actionable (adds focus ring). |
| `onDelete`        | `() => void`                                                             | —         | Renders a delete affordance.                 |
| `avatar` / `icon` | `ReactElement`                                                           | —         | Leading avatar or icon.                      |

## Brand notes

- Corner radius is brand-normalized to **6px** via the `MuiChip` theme override (MUI defaults to a full pill).
- Deletable / clickable chips inherit the DS focus-visible ring (WCAG 2.4.7).

## Usage

```tsx
import { Chip } from "@/design-system";

<Chip label="Active" color="success" />
<Chip label="Filter: React" variant="outlined" onDelete={clear} />
```
