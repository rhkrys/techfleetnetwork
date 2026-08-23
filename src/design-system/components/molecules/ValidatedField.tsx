/**
 * ValidatedField (molecule). Replaces src/components/ui/validated-field.tsx.
 * Thin adapter over the DS `Field` (label + control + error/description with the
 * accessible ARIA wiring). Prefer the `RHF*` adapters for react-hook-form forms.
 * See docs/design/design-system/components/molecules/Field.md
 */
import type { ReactNode } from "react";
import { Field } from "./Field";

export interface ValidatedFieldProps {
  id?: string;
  label?: ReactNode;
  required?: boolean;
  error?: string;
  description?: ReactNode;
  children: ReactNode;
}

export function ValidatedField({
  id,
  label,
  required,
  error,
  description,
  children,
}: ValidatedFieldProps) {
  return (
    <Field label={label} htmlFor={id} required={required} error={error} helperText={description}>
      {children}
    </Field>
  );
}
