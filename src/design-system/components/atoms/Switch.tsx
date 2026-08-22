/**
 * Switch (atom). Replaces src/components/ui/switch.tsx.
 * MUI Switch themed to the Tech Fleet primary. See components/atoms/Switch.md
 */
import { forwardRef } from "react";
import MuiSwitch, { type SwitchProps } from "@mui/material/Switch";

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(props, ref) {
  return <MuiSwitch ref={ref} {...props} />;
});

export type { SwitchProps };
