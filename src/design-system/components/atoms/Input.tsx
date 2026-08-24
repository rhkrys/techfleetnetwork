/**
 * Input (atom) — bare text field. Replaces src/components/ui/input.tsx.
 * MUI OutlinedInput (no floating label — pair with <Label>). `error` drives the
 * destructive border. See docs/design/design-system/components/atoms/Input.md
 */
import { forwardRef } from "react";
import OutlinedInput, { type OutlinedInputProps } from "@mui/material/OutlinedInput";

export type InputProps = OutlinedInputProps;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { fullWidth = true, ...props },
  ref
) {
  return <OutlinedInput inputRef={ref} fullWidth={fullWidth} {...props} />;
});
