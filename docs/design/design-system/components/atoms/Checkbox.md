# Checkbox (atom)

MUI `Checkbox` themed to the Tech Fleet primary. **Replaces** `src/components/ui/checkbox.tsx`.

- **Layer:** atom · **Status:** WRAP · **Import:** `import { Checkbox } from "@/design-system"`

## Live demo

<Demo name="Checkbox" />

## API

Full MUI `CheckboxProps`. Default `size` = `small`. Ripple disabled (theme).

## Deviation from stock MUI

- Border + fill use `primary` (matches shadcn's primary-bordered box); ripple off for the flat look.

## Behavior (→ tests)

- `defaultChecked` renders a checked checkbox-role control.

## Usage

```tsx
<Checkbox id="agree" defaultChecked />
<Label htmlFor="agree">I agree</Label>
```
