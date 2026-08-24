# Input (atom)

Bare text field on MUI `OutlinedInput`. **Replaces** `src/components/ui/input.tsx`.

- **Layer:** atom · **Status:** WRAP · **Import:** `import { Input } from "@/design-system"`

## Live demo

<Demo name="Input" />

## API

Full MUI `OutlinedInputProps`. Defaults: `fullWidth` = true. `error` sets the destructive border +
`aria-invalid`. No floating label — pair with `<Label>`.

## Deviation from stock MUI

- `OutlinedInput` (not `TextField`) so there's no notched floating label — matches shadcn's bare box.
- Radius 6px, `divider` border, `ring` focus (2px), `error` → destructive border (theme `MuiOutlinedInput`).

## Behavior (→ tests)

- Renders a textbox reflecting its value; `error` → `aria-invalid="true"`.

## Usage

```tsx
<Label htmlFor="name">Name</Label>
<Input id="name" placeholder="Ada" />
<Input error defaultValue="bad" />
```
