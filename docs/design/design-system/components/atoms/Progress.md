# Progress (atom)

The linear progress bar, built on MUI `LinearProgress`. **Replaces** `src/components/ui/progress.tsx`.

- **Layer:** atom · **Status:** WRAP · **Import:** `import { Progress } from "@/design-system"`

## Live demo

<Demo name="Progress" />

## API

| Prop     | Type                      | Default | Notes                                                                 |
| -------- | ------------------------- | ------- | --------------------------------------------------------------------- |
| `value`  | `number \| null`          | —       | `0`–`100` → determinate bar. Omit / `null` → indeterminate animation. |
| `sx`, …​ | MUI `LinearProgressProps` | —       | Full MUI LinearProgress API (minus `value`/`variant`, handled above). |

## Notes

- For the **circular** spinner variant, use [`CircularProgress`](./CircularProgress) (aliased `Spinner`).
- `value` is clamped to `0–100`, so out-of-range inputs never overflow the track.

## Usage

```tsx
import { Progress } from "@/design-system";

<Progress value={uploadPercent} />   // determinate
<Progress />                          // indeterminate (loading)
```
