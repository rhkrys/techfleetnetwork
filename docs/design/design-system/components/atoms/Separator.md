# Separator (atom)

MUI `Divider`. **Replaces** `src/components/ui/separator.tsx`.

- **Layer:** atom · **Status:** WRAP · **Import:** `import { Separator } from "@/design-system"`

## Live demo

<Demo name="Separator" />

## API

Full MUI `DividerProps` — `orientation="horizontal" | "vertical"`, `flexItem`, etc. Color = theme `divider`.

## Behavior (→ tests)

- Renders an element with role `separator`.

## Usage

```tsx
<Separator />
<Separator orientation="vertical" flexItem />
```
