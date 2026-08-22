# Card (molecule)

The Tech Fleet `.tf-card` surface + sub-parts, built on MUI `Card`. **Replaces** `src/components/ui/card.tsx`.

- **Layer:** molecule · **Status:** WRAP · **Import:** `import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/design-system"`

## API

| Export                                      | Notes                                                            |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `Card`                                      | `variant?: "default" \| "muted" \| "compact"` + MUI `CardProps`. |
| `CardHeader` / `CardContent` / `CardFooter` | Layout boxes (padding matches shadcn `p-6`).                     |
| `CardTitle`                                 | `Text brand="cardTitle"` (H4 Futura 500); `as?` to step the tag. |
| `CardDescription`                           | `Text brand="subsectionTitle"` muted.                            |

## Deviation from stock MUI

- **`.tf-card` skin from the theme** (`MuiCard.styleOverrides`): 40px **asymmetric** radius (top-left +
  bottom-right), 3px brand border, inset dual-glow shadow, per-mode surface tint.
- `variant="compact"` → 24px radius; `variant="muted"` → muted surface.
- **Paper is intentionally NOT skinned** as a tf-card (menus/popovers/dialogs use Paper) — mirrors the
  exclusions in the old global Tailwind auto-retrofit, which this override will eventually let us delete.

## Behavior scenarios (→ tests)

- Renders sub-parts and content; title/description render at the right heading levels.

## Usage

```tsx
<Card>
  <CardHeader>
    <CardTitle>Project</CardTitle>
    <CardDescription>Status and details</CardDescription>
  </CardHeader>
  <CardContent>…</CardContent>
  <CardFooter>
    <Button variant="outline" size="sm">
      Open
    </Button>
  </CardFooter>
</Card>
```

## Follow-up

- Once all card surfaces are MUI, delete the `.tf-card` global auto-retrofit block in `src/index.css`
  (band-aid removal per the CLAUDE.md prime directive).
