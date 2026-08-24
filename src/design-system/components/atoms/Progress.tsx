/**
 * Progress (atom). Replaces src/components/ui/progress.tsx.
 * MUI LinearProgress. shadcn `value` (0-100) → determinate value.
 * See docs/design/design-system/components/atoms/Progress.md
 */
import LinearProgress, { type LinearProgressProps } from "@mui/material/LinearProgress";

export interface ProgressProps extends Omit<LinearProgressProps, "value" | "variant"> {
  value?: number | null;
}

export function Progress({ value, ...props }: ProgressProps) {
  return value == null ? (
    <LinearProgress {...props} />
  ) : (
    <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, value))} {...props} />
  );
}
