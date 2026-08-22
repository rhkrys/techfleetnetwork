# Badge (atom)

Small pill label, built with MUI `styled`. **Replaces** `src/components/ui/badge.tsx`.

- **Layer:** atom · **Status:** WRAP (styled) · **Import:** `import { Badge } from "@/design-system"`

## API

| Prop      | Type                                             | Default   |
| --------- | ------------------------------------------------ | --------- |
| `variant` | `default \| secondary \| destructive \| outline` | `default` |
| …​        | intrinsic `span` props                           | —         |

## Deviation from stock MUI

- Not MUI `Chip` — a lightweight styled `span` matching shadcn's pill (rounded-full, `2px 10px`, 12px/600).
- Colors come from the theme palette (primary/secondary/error/divider); `outline` = bordered, foreground text.

## Usage

```tsx
<Badge>New</Badge>
<Badge variant="destructive">Overdue</Badge>
<Badge variant="outline">Draft</Badge>
```
