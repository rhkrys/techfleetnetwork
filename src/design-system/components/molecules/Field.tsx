/**
 * Field (molecule) — label + control + error/helper text.
 * Presentational glue used by the RHF adapters and standalone forms.
 * Replaces the shadcn form.tsx FormItem/FormLabel/FormMessage scaffolding.
 * See docs/design/design-system/components/molecules/Field.md
 */
import type { ReactNode } from "react";
import { Label } from "../atoms/Label";
import { Text } from "../atoms/Text";

export interface FieldProps {
  label?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  /** Error message — takes precedence over helperText and colors the message. */
  error?: string;
  helperText?: ReactNode;
  children: ReactNode;
}

export function Field({ label, htmlFor, required, error, helperText, children }: FieldProps) {
  const message = error ?? helperText;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      {label != null && (
        <Label htmlFor={htmlFor}>
          {label}
          {required ? " *" : null}
        </Label>
      )}
      {children}
      {message != null && (
        <Text brand="caption" sx={{ color: error ? "error.main" : "text.secondary" }}>
          {message}
        </Text>
      )}
    </div>
  );
}
