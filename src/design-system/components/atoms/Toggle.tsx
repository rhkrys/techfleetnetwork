/**
 * Toggle (atom). Replaces src/components/ui/toggle.tsx.
 * MUI ToggleButton. NOTE: shadcn used `pressed`/`onPressedChange`; MUI uses
 * `selected`/`onChange`. See docs/design/design-system/components/atoms/Toggle.md
 */
import { forwardRef } from "react";
import ToggleButton, { type ToggleButtonProps } from "@mui/material/ToggleButton";

export interface ToggleProps extends Omit<ToggleButtonProps, "value"> {
  value?: ToggleButtonProps["value"];
}

export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(function Toggle(
  { value = "on", ...props },
  ref
) {
  return <ToggleButton ref={ref} value={value} {...props} />;
});
