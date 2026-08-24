# Alert (molecule)

MUI `Alert`. **Replaces** `src/components/ui/alert.tsx`.

- **Layer:** molecule · **Status:** WRAP · **Import:** `import { Alert, AlertTitle, AlertDescription } from "@/design-system"`

## Live demo

<Demo name="Alert" />

## API

| Prop      | Type                                                   | Default   |
| --------- | ------------------------------------------------------ | --------- |
| `variant` | `default \| destructive \| success \| warning \| info` | `default` |

`variant` maps to a MUI `severity` (default→info, destructive→error). Rendered `variant="outlined"` (theme).

## Behavior (→ tests)

- Renders `role="alert"` with title + description text.

## Usage

```tsx
<Alert variant="destructive">
  <AlertTitle>Heads up</AlertTitle>
  <AlertDescription>Something went wrong.</AlertDescription>
</Alert>
```
