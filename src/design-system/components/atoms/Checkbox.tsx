/**
 * Checkbox (atom). Replaces src/components/ui/checkbox.tsx.
 * MUI Checkbox themed to the Tech Fleet primary. See components/atoms/Checkbox.md
 */
import { forwardRef } from "react";
import MuiCheckbox, { type CheckboxProps } from "@mui/material/Checkbox";

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  { size = "small", ...props },
  ref
) {
  return <MuiCheckbox ref={ref} size={size} {...props} />;
});

export type { CheckboxProps };
