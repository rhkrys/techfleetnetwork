# Tooltip (molecule)

MUI `Tooltip`. **Replaces** `src/components/ui/tooltip.tsx`.

- **Layer:** molecule · **Status:** WRAP · **Import:** `import { Tooltip } from "@/design-system"`

## Live demo

<Demo name="Tooltip" />

## API differs from shadcn

shadcn used a Radix compound API (`Tooltip`/`TooltipTrigger`/`TooltipContent`/`TooltipProvider`). MUI's
Tooltip is a **single wrapper** with a `title`:

```tsx
<Tooltip title="Extra context">
  <Button>Hover me</Button>
</Tooltip>
```

No `TooltipProvider` is needed. `arrow` defaults to `true`. MUI sets the child's `aria-label` from `title`.

## Behavior (→ tests)

- Renders the trigger child; the title becomes the child's accessible label.
