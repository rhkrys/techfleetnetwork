/**
 * Textarea (atom) — multiline field. Replaces src/components/ui/textarea.tsx.
 * MUI OutlinedInput multiline; `error` drives the destructive border.
 * See docs/design/design-system/components/atoms/Textarea.md
 */
import { forwardRef } from "react";
import OutlinedInput, { type OutlinedInputProps } from "@mui/material/OutlinedInput";

export type TextareaProps = OutlinedInputProps;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { fullWidth = true, minRows = 3, ...props },
  ref
) {
  return (
    <OutlinedInput multiline minRows={minRows} inputRef={ref} fullWidth={fullWidth} {...props} />
  );
});
