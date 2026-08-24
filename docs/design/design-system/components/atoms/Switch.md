# Switch (atom)

MUI `Switch` themed to the Tech Fleet primary. **Replaces** `src/components/ui/switch.tsx`.

- **Layer:** atom · **Status:** WRAP · **Import:** `import { Switch } from "@/design-system"`

## Live demo

<Demo name="Switch" />

## API

Full MUI `SwitchProps`.

## Deviation from stock MUI

- Checked track = `primary`; unchecked track = `divider` (theme `MuiSwitch`). Note: MUI's toggle uses `role="switch"`
  on its input (not `checkbox`) — relevant when querying in tests.

## Behavior (→ tests)

- Renders a toggle input, unchecked by default.

## Usage

```tsx
<Switch id="notify" defaultChecked />
<Label htmlFor="notify">Notifications</Label>
```
